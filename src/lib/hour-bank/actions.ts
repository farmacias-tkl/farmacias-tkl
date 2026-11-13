// =============================================================================
// Banco de horas: acciones contra la base.
//
// Las rutas /api/hour-bank/* y /api/overtime/[id] hacen autenticación, permisos
// por rol y parseo; la lógica y el alcance por sucursal del encargado están acá.
// Todo cambio de estado va con CAS (updateMany con el estado esperado en el
// where) dentro de una transacción, y deja AuditLog.
//
//   createRequest     pedido de día(s) o franja (queda PENDING, no descuenta)
//   decideRequest     supervisión autoriza (descuenta: movimiento TAKEN) o rechaza
//   cancelRequest     cancela; si estaba autorizado devuelve las horas
//   decideOvertime    aprueba una hora extra con destino Pagar o Banco, o la rechaza
//   setOvertimeDestination   destino de una hora extra aprobada: lo define si no tenía,
//                            o lo cambia (Pagar ↔ Banco) ajustando el saldo
//   addMovement       saldo inicial, compensación o ajuste (supervisión)
//   loadBalance       saldo y movimientos de una persona
// =============================================================================

import { Prisma, type HourBankRequest, type OvertimeRecord, type PrismaClient, type UserRole } from "@prisma/client";
import { toISODate, utcDay } from "@/lib/personal/dates";
import { ACTIVE_HOUR_BANK_STATUSES, ACTIVE_VACATION_STATUSES, BUSY_ABSENCE_TYPES, loadSchedules, type Db } from "@/lib/vacations/people";
import { isTimeEventLinkEnabled } from "./config";
import { requestsOverlap, roundHours, scheduleHours, sumHours, toHours, windowError, type DayWindow } from "./hours";

export interface Actor {
  id: string;
  role: UserRole;
  branchId?: string | null;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

/** Máximo de horas por día pedido: evita errores de tipeo (80 en vez de 8). */
const MAX_HOURS_PER_DAY = 24;
/** Tope de un movimiento manual. */
const MAX_MANUAL_HOURS = 2000;

const isManager = (a: Actor) => a.role === "BRANCH_MANAGER";
/** El encargado solo opera sobre su sucursal. */
const outOfScope = (a: Actor, branchId: string | null | undefined) =>
  isManager(a) && (!a.branchId || a.branchId !== branchId);

const period = (r: { startDate: Date; endDate: Date; startMinute: number | null; endMinute: number | null }) => {
  const days = toISODate(r.startDate) === toISODate(r.endDate)
    ? toISODate(r.startDate) : `${toISODate(r.startDate)} → ${toISODate(r.endDate)}`;
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return r.startMinute !== null && r.endMinute !== null ? `${days} ${hm(r.startMinute)}–${hm(r.endMinute)}` : days;
};

// -----------------------------------------------------------------------------
// Saldo
// -----------------------------------------------------------------------------

export async function balanceOf(db: Db, employeeId: string): Promise<number> {
  const agg = await db.hourBankMovement.aggregate({ where: { employeeId }, _sum: { hours: true } });
  return toHours(agg._sum.hours ?? 0);
}

/** Minutos que la persona todavía debe compensar (Asistencia). Solo si está activado. */
async function timeDebt(db: Db, employeeId: string) {
  if (!isTimeEventLinkEnabled()) return { enabled: false, hours: 0, events: [] as Array<{ id: string; date: Date; type: string; minutesRemaining: number }> };
  const events = await db.timeEvent.findMany({
    where: { employeeId, status: { in: ["APPROVED_FOR_COMPENSATION", "PARTIALLY_COMPENSATED"] }, minutesRemaining: { gt: 0 } },
    select: { id: true, date: true, type: true, minutesRemaining: true },
    orderBy: { date: "desc" },
  });
  const minutes = events.reduce((acc, e) => acc + e.minutesRemaining, 0);
  return { enabled: true, hours: roundHours(-minutes / 60), events };
}

export async function loadBalance(db: Db, employeeId: string, opts: { take?: number } = {}) {
  const [movements, total, pending, debt] = await Promise.all([
    db.hourBankMovement.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
      take: opts.take ?? 200,
      include: {
        hourBankRequest: { select: { id: true, startDate: true, endDate: true, startMinute: true, endMinute: true, status: true } },
        overtimeRecord: { select: { id: true, date: true, hours: true } },
      },
    }),
    balanceOf(db, employeeId),
    db.hourBankRequest.findMany({
      where: { employeeId, status: "PENDING" },
      select: { id: true, startDate: true, endDate: true, startMinute: true, endMinute: true, hours: true },
      orderBy: { startDate: "asc" },
    }),
    timeDebt(db, employeeId),
  ]);
  const pendingHours = sumHours(pending);
  return {
    /** Suma de los movimientos. */
    movementsBalance: total,
    /** Saldo que se muestra: movimientos + (si está activado) minutos adeudados. */
    balance: roundHours(total + debt.hours),
    /** Pedidos sin autorizar: todavía no descuentan. */
    pendingHours,
    balanceAfterPending: roundHours(total + debt.hours - pendingHours),
    pending,
    timeDebt: debt,
    movements,
  };
}

// -----------------------------------------------------------------------------
// Pedido de día o franja
// -----------------------------------------------------------------------------

export interface RequestInput {
  employeeId: string;
  startDate: Date;
  endDate: Date;
  startMinute?: number | null;
  endMinute?: number | null;
  /** Sin valor: las horas del turno según el horario. */
  hours?: number | null;
  coveredByEmployeeId?: string | null;
  coverageNote?: string | null;
  requesterNote?: string | null;
}

function validDates(startDate: Date, endDate: Date): string | null {
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "Fecha inválida.";
  if (utcDay(endDate) < utcDay(startDate)) return "La fecha \"hasta\" no puede ser anterior a \"desde\".";
  return null;
}

function hoursError(hours: number, startDate: Date, endDate: Date): string | null {
  if (!Number.isFinite(hours) || hours <= 0) return "Las horas a descontar tienen que ser mayores a cero.";
  const days = Math.round((utcDay(endDate).getTime() - utcDay(startDate).getTime()) / 86_400_000) + 1;
  if (hours > days * MAX_HOURS_PER_DAY) return `Las horas a descontar no pueden superar ${days * MAX_HOURS_PER_DAY} (${MAX_HOURS_PER_DAY} por día).`;
  return null;
}

/**
 * Lo que la pantalla muestra antes de pedir: horas del turno según el horario,
 * saldo y cómo quedaría. No escribe.
 */
export async function previewRequest(db: Db, actor: Actor, input: Pick<RequestInput, "employeeId" | "startDate" | "endDate" | "startMinute" | "endMinute">) {
  const dErr = validDates(input.startDate, input.endDate);
  if (dErr) return fail(400, dErr);
  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, currentBranchId: true, active: true } });
  if (!employee) return fail(404, "Empleado no encontrado");
  if (outOfScope(actor, employee.currentBranchId)) return fail(403, "Sin permisos");
  const window = toWindow(input);
  const [schedules, balance] = await Promise.all([loadSchedules(db, employee.id), loadBalance(db, employee.id, { take: 1 })]);
  const fromSchedule = scheduleHours(schedules, utcDay(input.startDate), utcDay(input.endDate), window);
  return {
    ok: true as const,
    data: {
      scheduleHours: fromSchedule,
      hasSchedule: fromSchedule !== null,
      balance: balance.balance,
      pendingHours: balance.pendingHours,
    },
  };
}

function toWindow(i: { startMinute?: number | null; endMinute?: number | null }): DayWindow | null {
  return i.startMinute !== null && i.startMinute !== undefined && i.endMinute !== null && i.endMinute !== undefined
    ? { startMinute: i.startMinute, endMinute: i.endMinute } : null;
}

async function coverError(db: Db, employeeId: string, coveredByEmployeeId: string | null | undefined): Promise<string | null> {
  if (!coveredByEmployeeId) return null;
  if (coveredByEmployeeId === employeeId) return "Quien cubre no puede ser la misma persona.";
  const cover = await db.employee.findUnique({ where: { id: coveredByEmployeeId }, select: { active: true } });
  if (!cover) return "La persona que cubre no existe.";
  if (!cover.active) return "La persona que cubre está dada de baja.";
  return null;
}

export async function createRequest(db: PrismaClient, actor: Actor, input: RequestInput): Promise<Result<HourBankRequest>> {
  const startDate = utcDay(input.startDate);
  const endDate = utcDay(input.endDate);
  const dErr = validDates(input.startDate, input.endDate);
  if (dErr) return fail(400, dErr);
  const wErr = windowError(input.startMinute, input.endMinute);
  if (wErr) return fail(400, wErr);
  const window = toWindow(input);
  if (window && startDate.getTime() !== endDate.getTime()) {
    return fail(400, "Una franja horaria es para un solo día. Para varios días, pedí días completos.");
  }

  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    include: { position: { select: { name: true } }, currentBranch: { select: { id: true, name: true } } },
  });
  if (!employee) return fail(404, "Empleado no encontrado");
  if (!employee.active) return fail(409, "La persona está dada de baja.");
  if (outOfScope(actor, employee.currentBranchId)) return fail(403, "Solo podés pedir para personas de tu sucursal.");
  if (!employee.currentBranch) return fail(409, "La persona no tiene sucursal donde trabaja.");

  const fromSchedule = scheduleHours(await loadSchedules(db, employee.id), startDate, endDate, window);
  const hours = input.hours !== null && input.hours !== undefined ? roundHours(input.hours) : fromSchedule;
  if (hours === null) return fail(400, "La persona no tiene horario cargado: indicá cuántas horas descuenta.");
  const hErr = hoursError(hours, startDate, endDate);
  if (hErr) {
    return fail(400, input.hours === null || input.hours === undefined
      ? "Según su horario la persona no trabaja en ese día o franja: indicá cuántas horas descuenta."
      : hErr);
  }
  const cErr = await coverError(db, employee.id, input.coveredByEmployeeId);
  if (cErr) return fail(400, cErr);

  // No se pisa con otro pedido propio, con vacaciones ni con una licencia.
  const [others, vacation, leave] = await Promise.all([
    db.hourBankRequest.findMany({
      where: { employeeId: employee.id, status: { in: [...ACTIVE_HOUR_BANK_STATUSES] }, startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { startDate: true, endDate: true, startMinute: true, endMinute: true },
    }),
    db.vacationRequest.findFirst({
      where: { employeeId: employee.id, status: { in: ACTIVE_VACATION_STATUSES }, startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { startDate: true, endDate: true },
    }),
    db.absenceRecord.findFirst({
      where: { employeeId: employee.id, absenceType: { in: [...BUSY_ABSENCE_TYPES] }, startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { startDate: true, endDate: true },
    }),
  ]);
  const mine = { startDate, endDate, startMinute: window?.startMinute ?? null, endMinute: window?.endMinute ?? null };
  const clash = others.find((o) => requestsOverlap(mine, o));
  if (clash) return fail(409, `Ya tiene un pedido de banco de horas en esas fechas (${period(clash)}).`);
  if (vacation) return fail(409, `Tiene vacaciones entre el ${toISODate(vacation.startDate)} y el ${toISODate(vacation.endDate)}.`);
  if (leave) return fail(409, `Tiene una licencia o ausencia por enfermedad entre el ${toISODate(leave.startDate)} y el ${toISODate(leave.endDate)}.`);

  const created = await db.$transaction(async (tx) => {
    const r = await tx.hourBankRequest.create({
      data: {
        employeeId: employee.id,
        branchId: employee.currentBranch!.id,
        employeeNameSnapshot: `${employee.firstName} ${employee.lastName}`,
        branchNameSnapshot: employee.currentBranch!.name,
        positionNameSnapshot: employee.position.name,
        startDate, endDate,
        startMinute: window?.startMinute ?? null,
        endMinute: window?.endMinute ?? null,
        hours, scheduleHours: fromSchedule,
        coveredByEmployeeId: input.coveredByEmployeeId || null,
        coverageNote: input.coverageNote?.trim() || null,
        requesterNote: input.requesterNote?.trim() || null,
        requestedByUserId: actor.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "HOUR_BANK_REQUESTED", entity: "HourBankRequest", entityId: r.id,
        detail: { period: period(r), hours, scheduleHours: fromSchedule, coveredByEmployeeId: r.coveredByEmployeeId },
      },
    });
    return r;
  });
  return { ok: true, data: created };
}

export async function decideRequest(db: PrismaClient, actor: Actor, p: {
  id: string;
  action: "approve" | "reject";
  /** Al autorizar, supervisión puede corregir las horas y quién cubre. */
  hours?: number | null;
  coveredByEmployeeId?: string | null;
  coverageNote?: string | null;
  note?: string | null;
}): Promise<Result<HourBankRequest>> {
  const r = await db.hourBankRequest.findUnique({ where: { id: p.id } });
  if (!r) return fail(404, "No encontrado");
  if (r.status !== "PENDING") return fail(409, `El pedido ya no está pendiente (estado actual: ${r.status}).`);
  const note = p.note?.trim() || null;

  if (p.action === "reject") {
    if (!note) return fail(400, "El motivo del rechazo es obligatorio.");
    return db.$transaction(async (tx) => {
      const cas = await tx.hourBankRequest.updateMany({
        where: { id: r.id, status: "PENDING" },
        data: { status: "REJECTED", decidedByUserId: actor.id, decidedAt: new Date(), decisionNote: note },
      });
      if (cas.count !== 1) return fail(409, "El pedido cambió mientras se rechazaba.");
      await tx.auditLog.create({
        data: { userId: actor.id, action: "HOUR_BANK_REJECTED", entity: "HourBankRequest", entityId: r.id, detail: { note, period: period(r) } },
      });
      return { ok: true as const, data: await tx.hourBankRequest.findUniqueOrThrow({ where: { id: r.id } }) };
    });
  }

  const hours = p.hours !== null && p.hours !== undefined ? roundHours(p.hours) : toHours(r.hours);
  const hErr = hoursError(hours, r.startDate, r.endDate);
  if (hErr) return fail(400, hErr);
  const coveredBy = p.coveredByEmployeeId !== undefined ? (p.coveredByEmployeeId || null) : r.coveredByEmployeeId;
  const cErr = await coverError(db, r.employeeId, coveredBy);
  if (cErr) return fail(400, cErr);
  const coverageNote = p.coverageNote !== undefined ? (p.coverageNote?.trim() || null) : r.coverageNote;

  return db.$transaction(async (tx) => {
    const cas = await tx.hourBankRequest.updateMany({
      where: { id: r.id, status: "PENDING" },
      data: {
        status: "APPROVED", hours, coveredByEmployeeId: coveredBy, coverageNote,
        decidedByUserId: actor.id, decidedAt: new Date(), decisionNote: note,
      },
    });
    if (cas.count !== 1) return fail(409, "El pedido cambió mientras se autorizaba.");
    const before = await balanceOf(tx, r.employeeId);
    await tx.hourBankMovement.create({
      data: {
        employeeId: r.employeeId, hours: -hours, type: "TAKEN", hourBankRequestId: r.id, userId: actor.id,
        note: `Banco de horas: ${period(r)}`,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "HOUR_BANK_APPROVED", entity: "HourBankRequest", entityId: r.id,
        detail: {
          period: period(r), hours, requestedHours: toHours(r.hours), coveredByEmployeeId: coveredBy,
          balanceBefore: before, balanceAfter: roundHours(before - hours), note,
        },
      },
    });
    return { ok: true as const, data: await tx.hourBankRequest.findUniqueOrThrow({ where: { id: r.id } }) };
  });
}

/**
 * Cancela un pedido. Pendiente: quien puede pedir (el encargado, los de su
 * sucursal). Autorizado: solo supervisión, con motivo; vuelven las horas.
 */
export async function cancelRequest(db: PrismaClient, actor: Actor, p: { id: string; note?: string | null; canAuthorize: boolean }): Promise<Result<HourBankRequest>> {
  const r = await db.hourBankRequest.findUnique({ where: { id: p.id } });
  if (!r) return fail(404, "No encontrado");
  if (outOfScope(actor, r.branchId)) return fail(403, "Sin permisos");
  if (r.status !== "PENDING" && r.status !== "APPROVED") return fail(409, `El pedido ya está ${r.status === "REJECTED" ? "rechazado" : "cancelado"}.`);
  const note = p.note?.trim() || null;
  if (r.status === "APPROVED") {
    if (!p.canAuthorize) return fail(403, "Un pedido ya autorizado lo cancela supervisión.");
    if (!note) return fail(400, "El motivo es obligatorio para cancelar un pedido ya autorizado.");
  }
  return db.$transaction(async (tx) => {
    const cas = await tx.hourBankRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "CANCELLED", decisionNote: note ?? r.decisionNote },
    });
    if (cas.count !== 1) return fail(409, "El pedido cambió mientras se cancelaba.");
    let refunded = 0;
    if (r.status === "APPROVED") {
      // Devuelve exactamente lo descontado por este pedido.
      const taken = await tx.hourBankMovement.findMany({ where: { hourBankRequestId: r.id }, select: { hours: true } });
      refunded = roundHours(-sumHours(taken));
      if (refunded !== 0) {
        await tx.hourBankMovement.create({
          data: {
            employeeId: r.employeeId, hours: refunded, type: "TAKEN_REVERSAL", hourBankRequestId: r.id, userId: actor.id,
            note: `Cancelado: ${note}`,
          },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "HOUR_BANK_CANCELLED", entity: "HourBankRequest", entityId: r.id,
        detail: { fromStatus: r.status, period: period(r), refundedHours: refunded, note },
      },
    });
    return { ok: true as const, data: await tx.hourBankRequest.findUniqueOrThrow({ where: { id: r.id } }) };
  });
}

// -----------------------------------------------------------------------------
// Horas extra: aprobación con destino
// -----------------------------------------------------------------------------

async function creditOvertime(tx: Prisma.TransactionClient, o: OvertimeRecord, userId: string) {
  await tx.hourBankMovement.create({
    data: {
      employeeId: o.employeeId, hours: toHours(o.hours), type: "OVERTIME", overtimeRecordId: o.id, userId,
      note: `Horas extra del ${toISODate(o.date)}`,
    },
  });
}

export async function decideOvertime(db: PrismaClient, actor: Actor, p: {
  id: string;
  action: "approve" | "reject";
  destination?: "PAY" | "BANK" | null;
  rejectionReason?: string | null;
}): Promise<Result<OvertimeRecord>> {
  const o = await db.overtimeRecord.findUnique({ where: { id: p.id } });
  if (!o) return fail(404, "No encontrado");
  if (o.status !== "REPORTED") return fail(409, `Solo se resuelve una hora extra reportada (estado actual: ${o.status}).`);

  if (p.action === "reject") {
    const reason = p.rejectionReason?.trim();
    if (!reason) return fail(400, "El motivo del rechazo es obligatorio.");
    return db.$transaction(async (tx) => {
      const cas = await tx.overtimeRecord.updateMany({
        where: { id: o.id, status: "REPORTED" },
        data: { status: "REJECTED", rejectionReason: reason },
      });
      if (cas.count !== 1) return fail(409, "El registro cambió mientras se rechazaba.");
      await tx.auditLog.create({
        data: { userId: actor.id, action: "OVERTIME_REJECTED", entity: "OvertimeRecord", entityId: o.id, detail: { reason } },
      });
      return { ok: true as const, data: await tx.overtimeRecord.findUniqueOrThrow({ where: { id: o.id } }) };
    });
  }

  if (p.destination !== "PAY" && p.destination !== "BANK") {
    return fail(400, "Para aprobar hay que elegir el destino: Pagar o Banco de horas.");
  }
  const destination = p.destination;
  return db.$transaction(async (tx) => {
    const cas = await tx.overtimeRecord.updateMany({
      where: { id: o.id, status: "REPORTED" },
      data: { status: "APPROVED", destination, approvedByUserId: actor.id, approvedAt: new Date() },
    });
    if (cas.count !== 1) return fail(409, "El registro cambió mientras se aprobaba.");
    if (destination === "BANK") await creditOvertime(tx, o, actor.id);
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "OVERTIME_APPROVED", entity: "OvertimeRecord", entityId: o.id,
        detail: { destination, hours: toHours(o.hours), date: toISODate(o.date) },
      },
    });
    return { ok: true as const, data: await tx.overtimeRecord.findUniqueOrThrow({ where: { id: o.id } }) };
  });
}

/**
 * Destino de una hora extra aprobada.
 *
 *  - Sin destino (aprobada antes del banco de horas): lo define.
 *  - Con destino: lo cambia, Pagar ↔ Banco.
 *      Pagar → Banco: suma las horas al banco, como al aprobar.
 *      Banco → Pagar: resta lo que había sumado. El movimiento original no se
 *      borra: queda en el historial, suelto de la hora extra (así, si después
 *      vuelve a Banco, el nuevo movimiento puede apuntarla: `overtimeRecordId`
 *      es único), y se agrega un movimiento de ajuste por el mismo importe en
 *      negativo. El saldo puede quedar en negativo si esas horas ya se usaron.
 */
export async function setOvertimeDestination(db: PrismaClient, actor: Actor, p: { id: string; destination: "PAY" | "BANK" }): Promise<Result<OvertimeRecord>> {
  if (p.destination !== "PAY" && p.destination !== "BANK") return fail(400, "Destino inválido.");
  const o = await db.overtimeRecord.findUnique({ where: { id: p.id } });
  if (!o) return fail(404, "No encontrado");
  if (o.status !== "APPROVED") return fail(409, "El destino se define en horas extra aprobadas.");
  if (o.destination === p.destination) return fail(409, "Esta hora extra ya tiene ese destino.");
  if (o.destination) return changeOvertimeDestination(db, actor, o, p.destination);
  return db.$transaction(async (tx) => {
    const cas = await tx.overtimeRecord.updateMany({
      where: { id: o.id, status: "APPROVED", destination: null },
      data: { destination: p.destination },
    });
    if (cas.count !== 1) return fail(409, "El registro cambió mientras se guardaba el destino.");
    if (p.destination === "BANK") await creditOvertime(tx, o, actor.id);
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "OVERTIME_DESTINATION_SET", entity: "OvertimeRecord", entityId: o.id,
        detail: { destination: p.destination, hours: toHours(o.hours), date: toISODate(o.date) },
      },
    });
    return { ok: true as const, data: await tx.overtimeRecord.findUniqueOrThrow({ where: { id: o.id } }) };
  });
}

async function changeOvertimeDestination(db: PrismaClient, actor: Actor, o: OvertimeRecord, to: "PAY" | "BANK"): Promise<Result<OvertimeRecord>> {
  const from = o.destination!;
  const day = toISODate(o.date);
  return db.$transaction(async (tx) => {
    // CAS sobre el destino anterior: dos cambios simultáneos no ajustan dos veces.
    const cas = await tx.overtimeRecord.updateMany({
      where: { id: o.id, status: "APPROVED", destination: from },
      data: { destination: to },
    });
    if (cas.count !== 1) return fail(409, "El registro cambió mientras se guardaba el destino.");
    const before = await balanceOf(tx, o.employeeId);
    let delta = 0;
    if (to === "BANK") {
      await creditOvertime(tx, o, actor.id);
      delta = toHours(o.hours);
    } else {
      const credited = await tx.hourBankMovement.findUnique({ where: { overtimeRecordId: o.id } });
      if (credited) {
        delta = -toHours(credited.hours);
        await tx.hourBankMovement.update({
          where: { id: credited.id },
          data: { overtimeRecordId: null, note: `Horas extra del ${day} (después pasaron a Pagar)` },
        });
        await tx.hourBankMovement.create({
          data: {
            employeeId: o.employeeId, hours: delta, type: "ADJUST", userId: actor.id,
            note: `Horas extra del ${day}: pasaron de Banco a Pagar`,
          },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "OVERTIME_DESTINATION_CHANGED", entity: "OvertimeRecord", entityId: o.id,
        detail: {
          from, to, hours: toHours(o.hours), date: day, employeeId: o.employeeId,
          bankDelta: delta, balanceBefore: before, balanceAfter: roundHours(before + delta),
        },
      },
    });
    return { ok: true as const, data: await tx.overtimeRecord.findUniqueOrThrow({ where: { id: o.id } }) };
  });
}

// -----------------------------------------------------------------------------
// Movimientos manuales: saldo inicial, compensación, ajuste
// -----------------------------------------------------------------------------

export type ManualMovementType = "INITIAL" | "COMPENSATION" | "ADJUST";

export async function addMovement(db: PrismaClient, actor: Actor, p: {
  employeeId: string;
  type: ManualMovementType;
  hours: number;
  note?: string | null;
}) {
  const hours = roundHours(p.hours);
  const note = p.note?.trim() || null;
  if (!Number.isFinite(hours) || hours === 0) return fail(400, "Las horas no pueden ser cero.");
  if (Math.abs(hours) > MAX_MANUAL_HOURS) return fail(400, `Las horas no pueden superar ${MAX_MANUAL_HOURS}.`);
  if (p.type === "COMPENSATION" && hours < 0) return fail(400, "Una compensación suma horas: tiene que ser positiva. Para restar, usá Ajuste.");
  if ((p.type === "COMPENSATION" || p.type === "ADJUST") && !note) return fail(400, "El motivo es obligatorio.");

  const employee = await db.employee.findUnique({ where: { id: p.employeeId }, select: { id: true } });
  if (!employee) return fail(404, "Empleado no encontrado");

  return db.$transaction(async (tx) => {
    if (p.type === "INITIAL") {
      // Serializa dos cargas simultáneas del saldo inicial de la misma persona.
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id} FOR UPDATE`;
      const existing = await tx.hourBankMovement.findFirst({ where: { employeeId: employee.id, type: "INITIAL" }, select: { id: true } });
      if (existing) return fail(409, "Esta persona ya tiene saldo inicial cargado. Para corregirlo, usá Ajuste.");
    }
    const before = await balanceOf(tx, employee.id);
    const m = await tx.hourBankMovement.create({
      data: { employeeId: employee.id, hours, type: p.type, userId: actor.id, note },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id, action: "HOUR_BANK_MOVEMENT", entity: "HourBankMovement", entityId: m.id,
        detail: { employeeId: employee.id, type: p.type, hours, balanceBefore: before, balanceAfter: roundHours(before + hours), note },
      },
    });
    return { ok: true as const, data: m };
  });
}
