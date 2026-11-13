// =============================================================================
// Asistencia (TimeEvent): operaciones de servidor.
//
//   loadBalances        total por persona (cuadro "Saldo por empleado")
//   loadPerson          total, deudas y compensaciones de una persona
//   resolveEvents       resuelve una o varias deudas juntas (compensar / descuento / condonar)
//   addCompensation     compensación sobre un registro puntual
//   compensatePerson    compensación por persona: se reparte entre sus deudas, la más vieja primero
//   undoCompensation    deshace una compensación (una fila o toda una carga por persona)
//   previewAbsenceDebt  horas del turno en los días de una ausencia
//   resolveAbsenceDebt  qué se hace con las horas de una ausencia
//
// Todo cambio de estado va con CAS (updateMany con el estado esperado) dentro
// de un $transaction, con TimeEventStateHistory y AuditLog por cada deuda.
// Los minutos se guardan como enteros; nada de esto toca el banco de horas:
// el banco lee lo pendiente "a compensar" al mostrar el saldo.
// =============================================================================

import { randomUUID } from "crypto";
import { Prisma, type PrismaClient, type TimeEvent, type TimeEventStatus, type UserRole } from "@prisma/client";
import { diffDays, toISODate, utcDay } from "@/lib/personal/dates";
import { loadSchedules } from "@/lib/vacations/people";
import { canAcceptCompensation, canTransition, statusAfterCompensation } from "./validation";
import { fmtMinutes } from "./duration";
import {
  absenceCanOweHours, absenceDays, absenceMinutes, allocateCompensation, summarize, summarizeByEmployee,
} from "./summary";

export interface Actor {
  id: string;
  role: UserRole;
  branchId?: string | null;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; max?: number };

const fail = (status: number, error: string, extra: { max?: number } = {}) => ({ ok: false as const, status, error, ...extra });

type Tx = Prisma.TransactionClient;
const TX_OPTS = { maxWait: 10_000, timeout: 30_000 };

/** Para cortar una transacción con un error de negocio (hace rollback). */
class Abort extends Error {
  constructor(public status: number, message: string, public max?: number) { super(message); }
}
async function inTx<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await db.$transaction(fn, TX_OPTS) };
  } catch (e) {
    if (e instanceof Abort) return fail(e.status, e.message, { max: e.max });
    throw e;
  }
}

const OPEN_FOR_COMPENSATION: TimeEventStatus[] = ["APPROVED_FOR_COMPENSATION", "PARTIALLY_COMPENSATED"];
const MAX_BULK = 200;
/** Tope de minutos por día de una ausencia: evita errores de tipeo. */
const MAX_MINUTES_PER_DAY = 24 * 60;

/** Encargado: solo su sucursal. null = sin restricción. undefined = no ve nada. */
function scopeBranch(actor: Actor): string | null | undefined {
  if (actor.role !== "BRANCH_MANAGER") return null;
  return actor.branchId || undefined;
}

// -----------------------------------------------------------------------------
// Lectura: total por persona
// -----------------------------------------------------------------------------

export async function loadBalances(db: PrismaClient, actor: Actor, p: { branchId?: string | null } = {}) {
  const scope = scopeBranch(actor);
  if (scope === undefined) return [];
  const branchId = scope ?? p.branchId ?? null;
  const events = await db.timeEvent.findMany({
    where: { status: { not: "CANCELLED" }, ...(branchId ? { branchId } : {}) },
    select: { employeeId: true, status: true, minutesOwed: true, minutesCompensated: true, minutesRemaining: true },
  });
  const rows = summarizeByEmployee(events);
  if (rows.length === 0) return [];
  const employees = await db.employee.findMany({
    where: { id: { in: rows.map((r) => r.employeeId) } },
    select: {
      id: true, firstName: true, lastName: true,
      currentBranch: { select: { id: true, name: true } },
      position: { select: { name: true } },
    },
  });
  const byId = new Map(employees.map((e) => [e.id, e]));
  return rows.map((r) => {
    const e = byId.get(r.employeeId);
    return {
      employeeId: r.employeeId,
      employeeName: e ? `${e.firstName} ${e.lastName}` : r.employeeId,
      branchName: e?.currentBranch?.name ?? null,
      positionName: e?.position?.name ?? null,
      ...r.totals,
    };
  });
}

export async function loadPerson(db: PrismaClient, actor: Actor, employeeId: string) {
  const scope = scopeBranch(actor);
  if (scope === undefined) return fail(403, "Sin permisos");
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true, firstName: true, lastName: true, currentBranchId: true,
      currentBranch: { select: { id: true, name: true } },
      position: { select: { name: true } },
    },
  });
  if (!employee) return fail(404, "Empleado no encontrado");
  // Encargado: las deudas registradas en su sucursal.
  const where: Prisma.TimeEventWhereInput = { employeeId, ...(scope ? { branchId: scope } : {}) };
  const [events, compensations] = await Promise.all([
    db.timeEvent.findMany({
      where,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, date: true, type: true, status: true, createdAt: true,
        minutesOwed: true, minutesCompensated: true, minutesRemaining: true,
        branchNameSnapshot: true, reason: true, reporterNote: true, absenceRecordId: true,
      },
    }),
    db.timeEventCompensation.findMany({
      where: { timeEvent: where },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true, date: true, minutesCompensated: true, note: true, batchId: true, createdAt: true,
        registeredBy: { select: { name: true } },
        timeEvent: { select: { id: true, date: true, type: true } },
      },
    }),
  ]);
  return {
    ok: true as const,
    data: {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        branchName: employee.currentBranch?.name ?? null,
        positionName: employee.position?.name ?? null,
      },
      totals: summarize(events),
      events,
      compensations,
    },
  };
}

// -----------------------------------------------------------------------------
// Resolver una o varias deudas juntas
// -----------------------------------------------------------------------------

export type Resolution = "compensation" | "payroll" | "waive";

const RESOLUTION: Record<Resolution, { to: TimeEventStatus; audit: string; noteRequired: boolean; label: string }> = {
  compensation: { to: "APPROVED_FOR_COMPENSATION", audit: "TIME_EVENT_RESOLUTION_APPROVED", noteRequired: false, label: "aprobar compensación" },
  payroll:      { to: "SENT_TO_PAYROLL_DEDUCTION", audit: "TIME_EVENT_SENT_TO_PAYROLL",     noteRequired: true,  label: "enviar a descuento" },
  waive:        { to: "WAIVED",                    audit: "TIME_EVENT_WAIVED",              noteRequired: true,  label: "condonar" },
};

/**
 * Aplica la misma resolución a todas las deudas indicadas. Todo o nada: si
 * alguna no admite esa resolución (o cambió mientras tanto), no se toca ninguna.
 */
export async function resolveEvents(db: PrismaClient, actor: Actor, p: {
  ids: string[];
  action: Resolution;
  note?: string | null;
}): Promise<Result<{ resolved: number; status: TimeEventStatus; events: TimeEvent[] }>> {
  const cfg = RESOLUTION[p.action];
  if (!cfg) return fail(400, "Acción inválida.");
  const ids = [...new Set(p.ids)];
  if (ids.length === 0) return fail(400, "No se eligió ninguna deuda.");
  if (ids.length > MAX_BULK) return fail(400, `Se pueden resolver hasta ${MAX_BULK} deudas juntas.`);
  const note = p.note?.trim() || null;
  if (cfg.noteRequired && !note) return fail(400, "El motivo es obligatorio.");
  const bulk = ids.length > 1;

  return inTx(db, async (tx) => {
    const events = await tx.timeEvent.findMany({ where: { id: { in: ids } } });
    if (events.length !== ids.length) throw new Abort(404, "Alguna de las deudas ya no existe.");
    const blocked = events.filter((e) => !canTransition(e.status, cfg.to));
    if (blocked.length > 0) {
      throw new Abort(409, bulk
        ? `No se puede ${cfg.label}: ${blocked.length} de las ${events.length} deudas elegidas ya no admiten esa resolución. Actualizá la lista y volvé a elegir.`
        : `No se puede ${cfg.label} desde el estado actual (${blocked[0].status}).`);
    }
    const now = new Date();
    for (const e of events) {
      const cas = await tx.timeEvent.updateMany({
        where: { id: e.id, status: e.status, minutesCompensated: e.minutesCompensated },
        data: {
          status: cfg.to,
          resolvedByUserId: actor.id,
          resolvedAt: now,
          ...(note !== null ? { resolutionNote: note } : {}),
          // Condonar deja el saldo en cero. A descuento conserva el saldo: es lo que se descuenta.
          ...(p.action === "waive" ? { minutesRemaining: 0 } : {}),
        },
      });
      if (cas.count !== 1) throw new Abort(409, "Alguna deuda cambió mientras se resolvía. Actualizá la lista y volvé a intentar.");
    }
    await tx.timeEventStateHistory.createMany({
      data: events.map((e) => ({
        timeEventId: e.id, fromStatus: e.status, toStatus: cfg.to, changedByUserId: actor.id, note: note ?? undefined,
      })),
    });
    await tx.auditLog.createMany({
      data: events.map((e) => ({
        userId: actor.id, action: cfg.audit, entity: "TimeEvent", entityId: e.id,
        detail: { fromStatus: e.status, note, ...(bulk ? { bulk: events.length } : {}) },
      })),
    });
    const updated = await tx.timeEvent.findMany({ where: { id: { in: ids } } });
    return { resolved: updated.length, status: cfg.to, events: updated };
  });
}

// -----------------------------------------------------------------------------
// Compensaciones
// -----------------------------------------------------------------------------

/** Aplica una compensación a UNA deuda, dentro de una transacción. */
async function applyCompensation(tx: Tx, ev: TimeEvent, p: {
  minutes: number; date: Date; note: string | null; batchId: string | null; actorId: string;
}) {
  const newCompensated = ev.minutesCompensated + p.minutes;
  const newRemaining = Math.max(0, ev.minutesOwed - newCompensated);
  const newStatus = statusAfterCompensation(newCompensated, ev.minutesOwed);
  const cas = await tx.timeEvent.updateMany({
    where: { id: ev.id, status: ev.status, minutesCompensated: ev.minutesCompensated },
    data: { minutesCompensated: newCompensated, minutesRemaining: newRemaining, status: newStatus },
  });
  if (cas.count !== 1) throw new Abort(409, "La deuda cambió mientras se cargaba la compensación. Actualizá y volvé a intentar.");
  const comp = await tx.timeEventCompensation.create({
    data: {
      timeEventId: ev.id, date: p.date, minutesCompensated: p.minutes,
      registeredByUserId: p.actorId,
      // Quién había autorizado la resolución que habilita esta compensación.
      authorizedByUserId: ev.resolvedByUserId,
      note: p.note, batchId: p.batchId,
    },
  });
  if (newStatus !== ev.status) {
    await tx.timeEventStateHistory.create({
      data: {
        timeEventId: ev.id, fromStatus: ev.status, toStatus: newStatus, changedByUserId: p.actorId,
        note: `Compensación de ${fmtMinutes(p.minutes)} (saldo restante: ${fmtMinutes(newRemaining)})`,
      },
    });
  }
  await tx.auditLog.create({
    data: {
      userId: p.actorId, action: "TIME_EVENT_COMPENSATION_ADDED", entity: "TimeEvent", entityId: ev.id,
      detail: {
        compensationId: comp.id, minutes: p.minutes, date: toISODate(p.date),
        newCompensated, newRemaining, newStatus, ...(p.batchId ? { batchId: p.batchId } : {}),
      },
    },
  });
  return { compensation: comp, newStatus, newRemaining };
}

function compensationInput(p: { minutes: number; date: Date; note?: string | null }) {
  if (!Number.isInteger(p.minutes) || p.minutes <= 0) return "La compensación tiene que ser de al menos 1 minuto.";
  if (!(p.date instanceof Date) || isNaN(p.date.getTime())) return "Fecha inválida.";
  return null;
}

/** Compensación sobre un registro puntual (la que ya existía). */
export async function addCompensation(db: PrismaClient, actor: Actor, p: {
  eventId: string; minutes: number; date: Date; note?: string | null;
}) {
  const err = compensationInput(p);
  if (err) return fail(400, err);
  return inTx(db, async (tx) => {
    const ev = await tx.timeEvent.findUnique({ where: { id: p.eventId } });
    if (!ev) throw new Abort(404, "No encontrado");
    if (!canAcceptCompensation(ev.status)) throw new Abort(409, `No se pueden cargar compensaciones en estado ${ev.status}`);
    if (p.minutes > ev.minutesRemaining) {
      throw new Abort(400, `La compensación (${fmtMinutes(p.minutes)}) supera el saldo pendiente (${fmtMinutes(ev.minutesRemaining)}).`, ev.minutesRemaining);
    }
    const r = await applyCompensation(tx, ev, { minutes: p.minutes, date: utcDay(p.date), note: p.note?.trim() || null, batchId: null, actorId: actor.id });
    return { event: await tx.timeEvent.findUniqueOrThrow({ where: { id: ev.id } }), compensation: r.compensation };
  });
}

/**
 * Compensación por persona. Se aplica a sus deudas "a compensar" empezando por
 * la más vieja y se parte entre varias si hace falta. Cada deuda tocada guarda
 * su propia fila (qué día y cuántos minutos); todas comparten `batchId`.
 */
export async function compensatePerson(db: PrismaClient, actor: Actor, p: {
  employeeId: string; minutes: number; date: Date; note?: string | null;
}) {
  const err = compensationInput(p);
  if (err) return fail(400, err);
  const note = p.note?.trim() || null;
  return inTx(db, async (tx) => {
    // Serializa dos cargas simultáneas para la misma persona.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Employee" WHERE id = ${p.employeeId} FOR UPDATE`;
    if (locked.length === 0) throw new Abort(404, "Empleado no encontrado");
    const debts = await tx.timeEvent.findMany({
      where: { employeeId: p.employeeId, status: { in: OPEN_FOR_COMPENSATION }, minutesRemaining: { gt: 0 } },
    });
    const alloc = allocateCompensation(debts, p.minutes);
    if (!alloc.ok) {
      throw new Abort(400, alloc.max > 0
        ? `La compensación (${fmtMinutes(p.minutes)}) supera lo pendiente a compensar. El máximo es ${fmtMinutes(alloc.max)}.`
        : alloc.error, alloc.max);
    }
    const batchId = randomUUID();
    const byId = new Map(debts.map((d) => [d.id, d]));
    const applied: Array<{ eventId: string; date: Date; type: string; minutes: number; newStatus: TimeEventStatus; newRemaining: number }> = [];
    for (const part of alloc.parts) {
      const ev = byId.get(part.id)!;
      const r = await applyCompensation(tx, ev, { minutes: part.minutes, date: utcDay(p.date), note, batchId, actorId: actor.id });
      applied.push({ eventId: ev.id, date: ev.date, type: ev.type, minutes: part.minutes, newStatus: r.newStatus, newRemaining: r.newRemaining });
    }
    const max = debts.reduce((acc, d) => acc + d.minutesRemaining, 0);
    return { batchId, minutes: p.minutes, applied, remainingToCompensate: max - p.minutes };
  });
}

/**
 * Deshace una compensación mal cargada: una fila puntual (`compensationId`) o
 * toda una carga por persona (`batchId`). La deuda recupera esos minutos y
 * vuelve a "a compensar" o "compensación parcial". La fila se borra; el detalle
 * completo queda en AuditLog.
 */
export async function undoCompensation(db: PrismaClient, actor: Actor, p: { compensationId?: string; batchId?: string }) {
  if (!p.compensationId && !p.batchId) return fail(400, "Falta indicar qué compensación deshacer.");
  return inTx(db, async (tx) => {
    const comps = await tx.timeEventCompensation.findMany({
      where: p.batchId ? { batchId: p.batchId } : { id: p.compensationId },
      orderBy: { createdAt: "asc" },
    });
    if (comps.length === 0) throw new Abort(404, "Esa compensación ya no existe (puede que ya se haya deshecho).");
    let minutes = 0;
    const events: string[] = [];
    for (const c of comps) {
      const ev = await tx.timeEvent.findUniqueOrThrow({ where: { id: c.timeEventId } });
      if (ev.status !== "PARTIALLY_COMPENSATED" && ev.status !== "COMPENSATED") {
        throw new Abort(409, `No se puede deshacer: la deuda del ${toISODate(ev.date)} está en estado ${ev.status}.`);
      }
      const newCompensated = ev.minutesCompensated - c.minutesCompensated;
      if (newCompensated < 0) throw new Abort(409, "No se puede deshacer: los minutos compensados de la deuda no coinciden.");
      const newRemaining = Math.max(0, ev.minutesOwed - newCompensated);
      const newStatus: TimeEventStatus = newCompensated === 0 ? "APPROVED_FOR_COMPENSATION" : "PARTIALLY_COMPENSATED";
      const cas = await tx.timeEvent.updateMany({
        where: { id: ev.id, status: ev.status, minutesCompensated: ev.minutesCompensated },
        data: { minutesCompensated: newCompensated, minutesRemaining: newRemaining, status: newStatus },
      });
      if (cas.count !== 1) throw new Abort(409, "La deuda cambió mientras se deshacía la compensación. Actualizá y volvé a intentar.");
      await tx.timeEventCompensation.delete({ where: { id: c.id } });
      if (newStatus !== ev.status) {
        await tx.timeEventStateHistory.create({
          data: {
            timeEventId: ev.id, fromStatus: ev.status, toStatus: newStatus, changedByUserId: actor.id,
            note: `Se deshizo la compensación de ${fmtMinutes(c.minutesCompensated)} del ${toISODate(c.date)}`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: actor.id, action: "TIME_EVENT_COMPENSATION_UNDONE", entity: "TimeEvent", entityId: ev.id,
          detail: {
            compensationId: c.id, minutes: c.minutesCompensated, date: toISODate(c.date), note: c.note,
            registeredByUserId: c.registeredByUserId, registeredAt: c.createdAt.toISOString(), batchId: c.batchId,
            fromStatus: ev.status, newStatus, newCompensated, newRemaining,
          },
        },
      });
      minutes += c.minutesCompensated;
      events.push(ev.id);
    }
    return { undone: comps.length, minutes, events };
  });
}

// -----------------------------------------------------------------------------
// Ausencias que generan deuda
// -----------------------------------------------------------------------------

export type AbsenceResolution = "compensation" | "payroll" | "waive";

const absenceDayCount = (a: { startDate: Date; endDate: Date }) => diffDays(utcDay(a.startDate), utcDay(a.endDate)) + 1;

/** Horas del turno en cada día de la ausencia y, si ya se resolvió, su deuda. */
export async function previewAbsenceDebt(db: PrismaClient, actor: Actor, absenceId: string) {
  const absence = await db.absenceRecord.findUnique({
    where: { id: absenceId },
    include: { timeEvent: { select: { id: true, status: true, minutesOwed: true, minutesCompensated: true, minutesRemaining: true } } },
  });
  if (!absence) return fail(404, "Ausencia no encontrada");
  const scope = scopeBranch(actor);
  if (scope === undefined || (scope && absence.branchId !== scope)) return fail(403, "Sin permisos");
  const days = absenceDays(await loadSchedules(db, absence.employeeId), utcDay(absence.startDate), utcDay(absence.endDate));
  return {
    ok: true as const,
    data: {
      eligible: absenceCanOweHours(absence),
      days,
      totalDays: days.length,
      /** null = sin horario en esas fechas: hay que indicar las horas a mano. */
      scheduleMinutes: absenceMinutes(days),
      debt: absence.timeEvent && absence.timeEvent.status !== "CANCELLED" ? absence.timeEvent : null,
    },
  };
}

/**
 * Resuelve qué se hace con las horas de una ausencia. Crea su deuda (TimeEvent
 * de tipo ABSENCE, vinculado a la ausencia) ya resuelta:
 *
 *   compensation → "a compensar": se compensa igual que una llegada tarde,
 *                  suma al total de la persona y resta del banco de horas.
 *   payroll      → enviada a descuento de sueldo, con la cantidad de días.
 *   waive        → condonada.
 *
 * `minutes`: por defecto, las horas del turno en esos días según el horario.
 */
export async function resolveAbsenceDebt(db: PrismaClient, actor: Actor, p: {
  absenceId: string; resolution: AbsenceResolution; minutes?: number | null; note?: string | null;
}) {
  if (!["compensation", "payroll", "waive"].includes(p.resolution)) return fail(400, "Resolución inválida.");
  const note = p.note?.trim() || null;
  if (p.resolution === "waive" && !note) return fail(400, "El motivo de la condonación es obligatorio.");

  const absence = await db.absenceRecord.findUnique({
    where: { id: p.absenceId },
    include: {
      timeEvent: { select: { id: true, status: true } },
      employee: { select: { firstName: true, lastName: true, position: { select: { name: true } } } },
      branch: { select: { name: true } },
    },
  });
  if (!absence) return fail(404, "Ausencia no encontrada");
  if (!absenceCanOweHours(absence)) {
    return fail(409, "Solo se resuelven las horas de una ausencia injustificada (o de tipo \"No se presentó\" o \"Razón personal\" que no esté justificada).");
  }
  if (absence.timeEvent && absence.timeEvent.status !== "CANCELLED") {
    return fail(409, "Esta ausencia ya tiene resueltas sus horas. Para cambiarlo, cancelá esa deuda desde Asistencia.");
  }

  const start = utcDay(absence.startDate);
  const totalDays = absenceDayCount(absence);
  const fromSchedule = absenceMinutes(absenceDays(await loadSchedules(db, absence.employeeId), start, utcDay(absence.endDate)));
  const minutes = p.minutes !== null && p.minutes !== undefined ? p.minutes : fromSchedule;
  if (minutes === null) return fail(400, "La persona no tiene horario cargado en esas fechas: indicá cuántas horas son.");
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return fail(400, fromSchedule === 0 && (p.minutes === null || p.minutes === undefined)
      ? "Según su horario, la persona no trabajaba esos días: indicá cuántas horas son."
      : "Las horas tienen que ser más de cero.");
  }
  if (minutes > MAX_MINUTES_PER_DAY * totalDays) return fail(400, "Las horas superan las 24 por día de ausencia.");

  const status: TimeEventStatus = RESOLUTION[p.resolution].to;
  const period = totalDays === 1 ? toISODate(start) : `${toISODate(start)} al ${toISODate(utcDay(absence.endDate))}`;
  const daysLabel = `${totalDays} día${totalDays === 1 ? "" : "s"}`;
  const resolutionNote = p.resolution === "payroll"
    ? [`Descuento de ${daysLabel}`, note].filter(Boolean).join(". ")
    : note;

  return inTx(db, async (tx) => {
    // Una deuda cancelada deja libre la ausencia para volver a resolverla.
    if (absence.timeEvent) {
      await tx.timeEvent.update({ where: { id: absence.timeEvent.id }, data: { absenceRecordId: null } });
    }
    const now = new Date();
    let ev: TimeEvent;
    try {
      ev = await tx.timeEvent.create({
        data: {
          employeeId: absence.employeeId,
          branchId: absence.branchId,
          employeeNameSnapshot: absence.employeeNameSnapshot ?? `${absence.employee.firstName} ${absence.employee.lastName}`,
          branchNameSnapshot: absence.branchNameSnapshot ?? absence.branch.name,
          positionNameSnapshot: absence.positionNameSnapshot ?? absence.employee.position?.name ?? "",
          date: start,
          type: "ABSENCE",
          status,
          // Una ausencia no tiene hora esperada y real: se guarda el día y su duración.
          expectedTime: start,
          actualTime: new Date(start.getTime() + minutes * 60_000),
          minutesOwed: minutes,
          minutesCompensated: 0,
          minutesRemaining: p.resolution === "waive" ? 0 : minutes,
          reporterNote: `Ausencia del ${period} (${daysLabel})`,
          reportedByUserId: actor.id,
          resolvedByUserId: actor.id,
          resolvedAt: now,
          resolutionNote,
          absenceRecordId: absence.id,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new Abort(409, "Esta ausencia ya tiene resueltas sus horas.");
      }
      throw e;
    }
    await tx.timeEventStateHistory.create({
      data: { timeEventId: ev.id, fromStatus: "PENDING_REVIEW", toStatus: status, changedByUserId: actor.id, note: resolutionNote ?? undefined },
    });
    await tx.auditLog.createMany({
      data: [
        {
          userId: actor.id, action: "TIME_EVENT_CREATED", entity: "TimeEvent", entityId: ev.id,
          detail: { type: "ABSENCE", absenceRecordId: absence.id, date: toISODate(start), minutesOwed: minutes, status },
        },
        {
          userId: actor.id, action: "ABSENCE_DEBT_RESOLVED", entity: "AbsenceRecord", entityId: absence.id,
          detail: { resolution: p.resolution, status, minutes, scheduleMinutes: fromSchedule, days: totalDays, timeEventId: ev.id, note },
        },
      ],
    });
    return ev;
  });
}
