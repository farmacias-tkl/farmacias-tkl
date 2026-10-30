// =============================================================================
// Limpieza de los datos ficticios de la parte operativa (encargo r1 §4.3).
//
// Ficticio = empleado SIN nameKey (todo lo anterior a scripts/load-personal.ts,
// que siempre lo completa) y puesto que no es del catálogo de 11
// (src/lib/personal/catalog.ts). Así la limpieza nunca toca personal real,
// aunque se corra después de la carga.
//
// Borra, en este orden y en una transacción: ActionPlanForm, ActionPlan,
// AbsenceStateHistory, AbsenceRecord, OvertimeRecord, TimeEventCompensation,
// TimeEventStateHistory, TimeEvent, VacationBalanceMovement, VacationStateHistory,
// EmployeeBranchAssignment, VacationRequest, VacationBalance, WorkSchedule(+Slot),
// Employee, PositionBranchScope y Position — siempre filtrando por empleados o
// puestos ficticios.
//
// NO toca: User, UserPermission, Permission, Account, Session, Branch, ventas
// (SalesSnapshot), coseguros, saldos bancarios, Call Center, SyncLog, AuditLog
// ni SecurityEvent.
//
// FRENA (no borra nada) si:
//   - algún User apunta a un empleado ficticio (User.employeeId o Employee.userId);
//   - hay PositionPermission en un puesto ficticio;
//   - personal real (nameKey) usa un puesto ficticio (empleado, asignación o solicitud).
// =============================================================================

import type { PrismaClient } from "@prisma/client";
import { POSITION_CATALOG } from "./catalog";

export interface CleanupPlan {
  employeeIds: string[];
  positionIds: string[];
  positionNames: string[];
  counts: Record<string, number>;
  blockers: string[];
}

const CATALOG_NAMES = POSITION_CATALOG.map((p) => p.name);

export async function planCleanup(db: PrismaClient): Promise<CleanupPlan> {
  const employees = await db.employee.findMany({ where: { nameKey: null }, select: { id: true, userId: true } });
  const employeeIds = employees.map((e) => e.id);
  const positions = await db.position.findMany({ where: { name: { notIn: CATALOG_NAMES } }, select: { id: true, name: true } });
  const positionIds = positions.map((p) => p.id);
  const E = { in: employeeIds };
  const P = { in: positionIds };

  const blockers: string[] = [];
  const usersLinked = await db.user.findMany({
    where: { OR: [{ employeeId: E }, { id: { in: employees.flatMap((e) => (e.userId ? [e.userId] : [])) } }] },
    select: { email: true, employeeId: true },
  });
  if (usersLinked.length > 0) {
    blockers.push(`${usersLinked.length} usuario(s) apuntan a empleados ficticios: ${usersLinked.map((u) => u.email).join(", ")}.`);
  }
  const posPerms = await db.positionPermission.count({ where: { positionId: P } });
  if (posPerms > 0) blockers.push(`${posPerms} PositionPermission en puestos ficticios.`);
  const realOnFake = await db.employee.count({
    where: { nameKey: { not: null }, OR: [{ positionId: P }, { secondaryPositionId: P }] },
  });
  if (realOnFake > 0) blockers.push(`${realOnFake} empleado(s) real(es) con un puesto ficticio.`);
  const realAssignOnFake = await db.employeeBranchAssignment.count({ where: { positionId: P, employeeId: { notIn: employeeIds } } });
  if (realAssignOnFake > 0) blockers.push(`${realAssignOnFake} asignación(es) de personal real con un puesto ficticio.`);
  const realVacOnFake = await db.vacationRequest.count({ where: { positionId: P, employeeId: { notIn: employeeIds } } });
  if (realVacOnFake > 0) blockers.push(`${realVacOnFake} solicitud(es) de vacaciones de personal real con un puesto ficticio.`);

  const counts: Record<string, number> = {
    ActionPlanForm: await db.actionPlanForm.count({ where: { actionPlan: { employeeId: E } } }),
    ActionPlan: await db.actionPlan.count({ where: { employeeId: E } }),
    AbsenceStateHistory: await db.absenceStateHistory.count({ where: { absence: { employeeId: E } } }),
    AbsenceRecord: await db.absenceRecord.count({ where: { employeeId: E } }),
    OvertimeRecord: await db.overtimeRecord.count({ where: { employeeId: E } }),
    TimeEventCompensation: await db.timeEventCompensation.count({ where: { timeEvent: { employeeId: E } } }),
    TimeEventStateHistory: await db.timeEventStateHistory.count({ where: { timeEvent: { employeeId: E } } }),
    TimeEvent: await db.timeEvent.count({ where: { employeeId: E } }),
    VacationBalanceMovement: await db.vacationBalanceMovement.count({
      where: { OR: [{ employeeId: E }, { vacationRequest: { employeeId: E } }] },
    }),
    VacationStateHistory: await db.vacationStateHistory.count({ where: { vacation: { employeeId: E } } }),
    EmployeeBranchAssignment: await db.employeeBranchAssignment.count({ where: { employeeId: E } }),
    VacationRequest: await db.vacationRequest.count({ where: { employeeId: E } }),
    VacationBalance: await db.vacationBalance.count({ where: { employeeId: E } }),
    WorkSchedule: await db.workSchedule.count({ where: { employeeId: E } }),
    Employee: employeeIds.length,
    PositionBranchScope: await db.positionBranchScope.count({ where: { positionId: P } }),
    Position: positionIds.length,
  };

  return { employeeIds, positionIds, positionNames: positions.map((p) => p.name), counts, blockers };
}

export async function applyCleanup(db: PrismaClient, plan: CleanupPlan): Promise<Record<string, number>> {
  if (plan.blockers.length > 0) throw new Error(`La limpieza está frenada: ${plan.blockers.join(" ")}`);
  const E = { in: plan.employeeIds };
  const P = { in: plan.positionIds };
  const deleted: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    const run = async (name: string, p: Promise<{ count: number }>) => { deleted[name] = (await p).count; };
    await run("ActionPlanForm", tx.actionPlanForm.deleteMany({ where: { actionPlan: { employeeId: E } } }));
    await run("ActionPlan", tx.actionPlan.deleteMany({ where: { employeeId: E } }));
    await run("AbsenceStateHistory", tx.absenceStateHistory.deleteMany({ where: { absence: { employeeId: E } } }));
    await run("AbsenceRecord", tx.absenceRecord.deleteMany({ where: { employeeId: E } }));
    await run("OvertimeRecord", tx.overtimeRecord.deleteMany({ where: { employeeId: E } }));
    await run("TimeEventCompensation", tx.timeEventCompensation.deleteMany({ where: { timeEvent: { employeeId: E } } }));
    await run("TimeEventStateHistory", tx.timeEventStateHistory.deleteMany({ where: { timeEvent: { employeeId: E } } }));
    await run("TimeEvent", tx.timeEvent.deleteMany({ where: { employeeId: E } }));
    await run("VacationBalanceMovement", tx.vacationBalanceMovement.deleteMany({
      where: { OR: [{ employeeId: E }, { vacationRequest: { employeeId: E } }] },
    }));
    await run("VacationStateHistory", tx.vacationStateHistory.deleteMany({ where: { vacation: { employeeId: E } } }));
    await run("EmployeeBranchAssignment", tx.employeeBranchAssignment.deleteMany({ where: { employeeId: E } }));
    await run("VacationRequest", tx.vacationRequest.deleteMany({ where: { employeeId: E } }));
    await run("VacationBalance", tx.vacationBalance.deleteMany({ where: { employeeId: E } }));
    await run("WorkSchedule", tx.workSchedule.deleteMany({ where: { employeeId: E } }));
    await run("Employee", tx.employee.deleteMany({ where: { id: E } }));
    await run("PositionBranchScope", tx.positionBranchScope.deleteMany({ where: { positionId: P } }));
    await run("Position", tx.position.deleteMany({ where: { id: P } }));
  }, { timeout: 120_000, maxWait: 30_000 });
  return deleted;
}

export function formatCleanupReport(plan: CleanupPlan): string {
  const out = ["== Datos ficticios a borrar =="];
  for (const [k, n] of Object.entries(plan.counts)) out.push(`  ${k.padEnd(26)} ${n}`);
  if (plan.positionNames.length) out.push(`  Puestos: ${plan.positionNames.join(" · ")}`);
  out.push("\n== Frenos ==");
  if (plan.blockers.length === 0) out.push("  (ninguno)");
  for (const b of plan.blockers) out.push(`  FRENA: ${b}`);
  return out.join("\n");
}
