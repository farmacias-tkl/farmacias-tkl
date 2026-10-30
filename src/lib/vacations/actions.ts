// =============================================================================
// Acciones del circuito de vacaciones que mueven saldo y cobertura (adenda B y D).
//
// Todas corren en una transacción y cambian el estado con CAS (updateMany con
// el estado esperado en el where): si dos personas aprueban a la vez, solo una
// gana y la otra recibe 409. Las rutas /api/vacations/[id]/* solo hacen
// autenticación, permisos y parseo; la lógica está acá.
//
//   approve        PENDING_SUPERVISOR → APPROVED (o PENDING_RRHH con el paso de
//                  RRHH activo). Con advertencias exige confirmWarnings ("Aprobar
//                  igual") y las registra. Crea la cobertura elegida.
//   rrhhApprove    PENDING_RRHH → APPROVED (solo con el paso de RRHH activo).
//   undoApproval   APPROVED → PENDING_SUPERVISOR, nota obligatoria.
//   changeCoverage cambia o quita el rotativo de una solicitud aprobada.
//   releaseOnExit  al deshacer, cancelar o rechazar: devuelve el saldo
//                  consumido a los mismos años y libera la cobertura.
// =============================================================================

import { Prisma, type PrismaClient, type VacationRequest, type VacationStatus } from "@prisma/client";
import { planConsumption, planRefund } from "@/lib/personal/balance";
import { coveredByRotatives, positionKeyOf } from "@/lib/personal/catalog";
import { toISODate } from "@/lib/personal/dates";
import { isRrhhStepEnabled } from "./config";
import { loadRotativeOptions } from "./coverage-data";
import { validateVacationRequest, type ValidationResult } from "./validation";
import { warningMessages } from "./rules";

type Tx = Prisma.TransactionClient;

export type ActionResult<T = VacationRequest> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string; validation?: ValidationResult };

const fail = (status: number, error: string, extra: { code?: string; validation?: ValidationResult } = {}) =>
  ({ ok: false as const, status, error, ...extra });

// -----------------------------------------------------------------------------
// Saldo
// -----------------------------------------------------------------------------

async function lockBalances(tx: Tx, employeeId: string) {
  await tx.$queryRaw`SELECT id FROM "VacationBalance" WHERE "employeeId" = ${employeeId} FOR UPDATE`;
}

async function addToBalance(tx: Tx, employeeId: string, year: number, delta: number) {
  await tx.vacationBalance.upsert({
    where: { employeeId_year: { employeeId, year } },
    create: { employeeId, year, days: delta },
    update: { days: { increment: delta } },
  });
}

/** Aprobación final: descuenta del año más viejo primero. */
export async function consumeBalance(tx: Tx, v: Pick<VacationRequest, "id" | "employeeId" | "daysCount" | "startDate">, userId: string) {
  await lockBalances(tx, v.employeeId);
  const balances = await tx.vacationBalance.findMany({ where: { employeeId: v.employeeId }, select: { year: true, days: true } });
  const plan = planConsumption(balances, v.daysCount, v.startDate.getUTCFullYear());
  for (const a of plan.allocations) {
    await addToBalance(tx, v.employeeId, a.year, -a.days);
    await tx.vacationBalanceMovement.create({
      data: {
        employeeId: v.employeeId, year: a.year, days: -a.days, type: "CONSUME",
        vacationRequestId: v.id, userId,
        note: plan.shortfall > 0 && a === plan.allocations[plan.allocations.length - 1]
          ? `Supera el saldo en ${plan.shortfall} día(s)` : null,
      },
    });
  }
  return plan;
}

/** Devuelve lo consumido por la solicitud a los mismos años. Sin consumo, no hace nada. */
export async function refundBalance(tx: Tx, v: Pick<VacationRequest, "id" | "employeeId">, userId: string, note: string | null) {
  await lockBalances(tx, v.employeeId);
  const movements = await tx.vacationBalanceMovement.findMany({
    where: { vacationRequestId: v.id },
    select: { year: true, days: true },
  });
  const refunds = planRefund(movements);
  for (const r of refunds) {
    await addToBalance(tx, v.employeeId, r.year, r.days);
    await tx.vacationBalanceMovement.create({
      data: { employeeId: v.employeeId, year: r.year, days: r.days, type: "REFUND", vacationRequestId: v.id, userId, note },
    });
  }
  return refunds;
}

// -----------------------------------------------------------------------------
// Cobertura
// -----------------------------------------------------------------------------

/** Pasa a CANCELLED las coberturas activas vinculadas a la solicitud. */
export async function releaseCoverage(tx: Tx, vacationId: string): Promise<number> {
  const r = await tx.employeeBranchAssignment.updateMany({
    where: { vacationRequestId: vacationId, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });
  return r.count;
}

type CoverageTarget = Pick<VacationRequest, "id" | "employeeId" | "branchId" | "positionId" | "startDate" | "endDate" | "employeeNameSnapshot">;

/**
 * Deja la solicitud con ese rotativo (o sin ninguno). Libera la cobertura
 * anterior. El rotativo tiene que estar libre al menos un día del período.
 * Devuelve el valor de withoutCoverage que corresponde.
 */
export async function setCoverage(
  tx: Tx,
  v: CoverageTarget,
  rotativeEmployeeId: string | null,
  userId: string,
): Promise<{ ok: true; withoutCoverage: boolean; assignmentId: string | null } | { ok: false; error: string }> {
  await releaseCoverage(tx, v.id);
  const [position, branch] = await Promise.all([
    tx.position.findUnique({ where: { id: v.positionId }, select: { name: true } }),
    tx.branch.findUnique({ where: { id: v.branchId }, select: { zone: true } }),
  ]);
  const key = positionKeyOf(position?.name);
  // "Sin cobertura" solo donde se cubre con rotativos (puesto de cobertura en zona CABA).
  const usesRotatives = coveredByRotatives(key, branch?.zone);
  if (!rotativeEmployeeId) return { ok: true, withoutCoverage: usesRotatives, assignmentId: null };
  if (!key) return { ok: false, error: "El puesto de la solicitud no es del catálogo: no se puede elegir rotativo." };
  if (!usesRotatives) return { ok: false, error: "Esta solicitud no se cubre con rotativos (puesto o zona de la sucursal)." };

  const options = await loadRotativeOptions(tx, {
    employeeId: v.employeeId, positionKey: key, branchId: v.branchId,
    startDate: v.startDate, endDate: v.endDate, excludeRequestId: v.id,
  });
  const chosen = options.availability.find((r) => r.employeeId === rotativeEmployeeId);
  if (!chosen) return { ok: false, error: "Ese rotativo no está libre ningún día del período o no tiene el puesto." };

  const a = await tx.employeeBranchAssignment.create({
    data: {
      employeeId: rotativeEmployeeId,
      branchId: v.branchId,
      positionId: v.positionId,
      type: "TEMPORARY_COVERAGE",
      status: "ACTIVE",
      startDate: v.startDate,
      endDate: v.endDate,
      vacationRequestId: v.id,
      coverageSlots: options.needed.length > 0 ? (options.needed as unknown as Prisma.InputJsonValue) : undefined,
      reason: `Cobertura de vacaciones de ${v.employeeNameSnapshot}`,
      notes: chosen.freeAll ? null : `Libre ${chosen.freeDays.length} de ${chosen.freeDays.length + chosen.busyDays.length} día(s)`,
      assignedByUserId: userId,
    },
  });
  return { ok: true, withoutCoverage: false, assignmentId: a.id };
}

/** Al salir de un estado activo (deshacer, cancelar, rechazar): saldo y cobertura. */
export async function releaseOnExit(tx: Tx, v: Pick<VacationRequest, "id" | "employeeId">, userId: string, note: string | null) {
  const refunds = await refundBalance(tx, v, userId, note);
  const released = await releaseCoverage(tx, v.id);
  return { refunds, released };
}

// -----------------------------------------------------------------------------
// Aprobación de supervisión
// -----------------------------------------------------------------------------

export async function approveVacation(db: PrismaClient, p: {
  id: string;
  userId: string;
  note?: string;
  /** "Aprobar igual": confirma las advertencias. */
  confirmWarnings?: boolean;
  /** Rotativo elegido; null/undefined = ninguno. */
  rotativeEmployeeId?: string | null;
}): Promise<ActionResult> {
  const v = await db.vacationRequest.findUnique({ where: { id: p.id } });
  if (!v) return fail(404, "No encontrada");
  if (v.status !== "PENDING_SUPERVISOR") {
    return fail(409, `Solo se puede aprobar desde PENDING_SUPERVISOR (estado actual: ${v.status})`);
  }

  const validation = await validateVacationRequest(
    { employeeId: v.employeeId, startDate: v.startDate, endDate: v.endDate, excludeRequestId: v.id }, db);
  if (!validation.isValid) {
    return fail(409, "La solicitud tiene errores que bloquean la aprobación", { validation });
  }
  const warnings = warningMessages(validation);
  if (warnings.length > 0 && !p.confirmWarnings) {
    return fail(409, "La solicitud tiene advertencias: hay que confirmar con \"Aprobar igual\"", {
      code: "WARNINGS_REQUIRE_CONFIRMATION", validation,
    });
  }

  const rrhh = isRrhhStepEnabled();
  const toStatus: VacationStatus = rrhh ? "PENDING_RRHH" : "APPROVED";
  const now = new Date();

  return db.$transaction(async (tx) => {
    const cas = await tx.vacationRequest.updateMany({
      where: { id: v.id, status: "PENDING_SUPERVISOR" },
      data: { status: toStatus },
    });
    if (cas.count !== 1) return fail(409, "La solicitud cambió de estado mientras se aprobaba");

    const coverage = await setCoverage(tx, v, p.rotativeEmployeeId ?? null, p.userId);
    if (!coverage.ok) throw new CoverageError(coverage.error);

    const consumed = rrhh ? null : await consumeBalance(tx, v, p.userId);
    const approvalWarnings = warnings.length > 0
      ? { warnings, confirmedByUserId: p.userId, confirmedAt: now.toISOString() }
      : undefined;

    const u = await tx.vacationRequest.update({
      where: { id: v.id },
      data: {
        supervisorActionByUserId: p.userId,
        supervisorActionAt: now,
        ...(p.note !== undefined && { supervisorNote: p.note }),
        conflictLevel: validation.conflictLevel,
        conflictReasons: { warnings: validation.warnings, ruleResults: validation.ruleResults } as unknown as Prisma.InputJsonValue,
        approvedWithWarnings: warnings.length > 0,
        approvalWarnings: approvalWarnings as Prisma.InputJsonValue | undefined,
        withoutCoverage: coverage.withoutCoverage,
      },
    });
    await tx.vacationStateHistory.create({
      data: {
        vacationId: v.id, fromStatus: "PENDING_SUPERVISOR", toStatus,
        changedByUserId: p.userId,
        note: [p.note, warnings.length > 0 ? `Aprobada igual con ${warnings.length} advertencia(s)` : null]
          .filter(Boolean).join(" · ") || null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: p.userId,
        action: "VACATION_SUPERVISOR_APPROVED",
        entity: "VacationRequest",
        entityId: v.id,
        detail: {
          note: p.note ?? null,
          toStatus,
          approvedWithWarnings: warnings.length > 0,
          warnings,
          coverageAssignmentId: coverage.assignmentId,
          withoutCoverage: coverage.withoutCoverage,
          balance: consumed ? consumed.allocations : null,
        } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const, data: u };
  }).catch((e) => {
    if (e instanceof CoverageError) return fail(409, e.message);
    throw e;
  });
}

class CoverageError extends Error {}

/** Paso de RRHH (solo si está activo): PENDING_RRHH → APPROVED, descuenta saldo. */
export async function rrhhApproveVacation(db: PrismaClient, p: { id: string; userId: string; note?: string }): Promise<ActionResult> {
  const v = await db.vacationRequest.findUnique({ where: { id: p.id } });
  if (!v) return fail(404, "No encontrada");
  if (v.status !== "PENDING_RRHH") {
    return fail(409, `Solo se puede confirmar desde PENDING_RRHH (estado actual: ${v.status})`);
  }
  return db.$transaction(async (tx) => {
    const cas = await tx.vacationRequest.updateMany({ where: { id: v.id, status: "PENDING_RRHH" }, data: { status: "APPROVED" } });
    if (cas.count !== 1) return fail(409, "La solicitud cambió de estado mientras se confirmaba");
    const consumed = await consumeBalance(tx, v, p.userId);
    const u = await tx.vacationRequest.update({
      where: { id: v.id },
      data: { rrhhActionByUserId: p.userId, rrhhActionAt: new Date(), ...(p.note !== undefined && { rrhhNote: p.note }) },
    });
    await tx.vacationStateHistory.create({
      data: { vacationId: v.id, fromStatus: "PENDING_RRHH", toStatus: "APPROVED", changedByUserId: p.userId, note: p.note },
    });
    await tx.auditLog.create({
      data: {
        userId: p.userId, action: "VACATION_RRHH_APPROVED", entity: "VacationRequest", entityId: v.id,
        detail: { note: p.note ?? null, balance: consumed.allocations } as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const, data: u };
  });
}

// -----------------------------------------------------------------------------
// Deshacer aprobación
// -----------------------------------------------------------------------------

export async function undoApproval(db: PrismaClient, p: { id: string; userId: string; note: string }): Promise<ActionResult> {
  const note = p.note?.trim();
  if (!note) return fail(400, "La nota es obligatoria para deshacer una aprobación");
  const v = await db.vacationRequest.findUnique({ where: { id: p.id } });
  if (!v) return fail(404, "No encontrada");
  if (v.status !== "APPROVED") {
    return fail(409, `Solo se puede deshacer una solicitud APPROVED (estado actual: ${v.status})`);
  }
  return db.$transaction(async (tx) => {
    const cas = await tx.vacationRequest.updateMany({
      where: { id: v.id, status: "APPROVED" },
      data: { status: "PENDING_SUPERVISOR", approvedWithWarnings: false, approvalWarnings: Prisma.DbNull, withoutCoverage: false },
    });
    if (cas.count !== 1) return fail(409, "La solicitud cambió de estado mientras se deshacía");
    const exit = await releaseOnExit(tx, v, p.userId, `Deshacer aprobación: ${note}`);
    await tx.vacationStateHistory.create({
      data: { vacationId: v.id, fromStatus: "APPROVED", toStatus: "PENDING_SUPERVISOR", changedByUserId: p.userId, note },
    });
    await tx.auditLog.create({
      data: {
        userId: p.userId, action: "VACATION_APPROVAL_UNDONE", entity: "VacationRequest", entityId: v.id,
        detail: { note, refunds: exit.refunds, coveragesReleased: exit.released } as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const, data: await tx.vacationRequest.findUniqueOrThrow({ where: { id: v.id } }) };
  });
}

// -----------------------------------------------------------------------------
// Cambiar o quitar cobertura
// -----------------------------------------------------------------------------

export async function changeCoverage(db: PrismaClient, p: {
  id: string;
  userId: string;
  rotativeEmployeeId: string | null;
}): Promise<ActionResult> {
  const v = await db.vacationRequest.findUnique({ where: { id: p.id } });
  if (!v) return fail(404, "No encontrada");
  if (v.status !== "APPROVED" && v.status !== "PENDING_RRHH") {
    return fail(409, `La cobertura se cambia en solicitudes aprobadas (estado actual: ${v.status})`);
  }
  return db.$transaction(async (tx) => {
    const before = await tx.employeeBranchAssignment.findFirst({
      where: { vacationRequestId: v.id, status: "ACTIVE" }, select: { employeeId: true },
    });
    const coverage = await setCoverage(tx, v, p.rotativeEmployeeId, p.userId);
    if (!coverage.ok) throw new CoverageError(coverage.error);
    const u = await tx.vacationRequest.update({ where: { id: v.id }, data: { withoutCoverage: coverage.withoutCoverage } });
    await tx.auditLog.create({
      data: {
        userId: p.userId, action: "VACATION_COVERAGE_CHANGED", entity: "VacationRequest", entityId: v.id,
        detail: {
          from: before?.employeeId ?? null,
          to: p.rotativeEmployeeId,
          assignmentId: coverage.assignmentId,
          period: `${toISODate(v.startDate)} → ${toISODate(v.endDate)}`,
        },
      },
    });
    return { ok: true as const, data: u };
  }).catch((e) => {
    if (e instanceof CoverageError) return fail(409, e.message);
    throw e;
  });
}
