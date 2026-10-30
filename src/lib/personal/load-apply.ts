// =============================================================================
// Carga de personal real: foto de la base y aplicación del plan (Prisma).
//
// applyLoadPlan corre TODO en una transacción, no borra nada y solo escribe lo
// que el plan marca como create/update: con los mismos archivos, la segunda
// corrida no cambia nada. Se niega a escribir si el plan tiene errores.
// =============================================================================

import type { Prisma, PrismaClient } from "@prisma/client";
import { toISODate, utcDay, addDays } from "./dates";
import { LEAVE_ABSENCE_TYPES } from "@/lib/vacations/people";
import type { ScheduleWeekValue } from "./schedule";
import type { DbSnapshot, LoadPlan } from "./load-plan";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

export async function loadSnapshot(db: PrismaClient): Promise<DbSnapshot> {
  const [branches, positions, employees] = await Promise.all([
    db.branch.findMany({ select: { id: true, name: true, code: true } }),
    db.position.findMany({ select: { id: true, name: true } }),
    db.employee.findMany({ where: { nameKey: { not: null }, contractBranchId: { not: null } } }),
  ]);
  const ids = employees.map((e) => e.id);
  const [schedules, balances, consumption, leaves] = await Promise.all([
    db.workSchedule.findMany({ where: { employeeId: { in: ids } }, include: { slots: true } }),
    db.vacationBalance.findMany({ where: { employeeId: { in: ids } } }),
    db.vacationBalanceMovement.findMany({
      where: { employeeId: { in: ids }, type: { in: ["CONSUME", "REFUND"] } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    }),
    db.absenceRecord.findMany({
      where: { employeeId: { in: ids }, absenceType: { in: [...LEAVE_ABSENCE_TYPES] } },
      select: { employeeId: true, absenceType: true, startDate: true, endDate: true },
    }),
  ]);
  return {
    branches,
    positions,
    employees: employees.map((e) => ({
      id: e.id,
      nameKey: e.nameKey!,
      contractBranchId: e.contractBranchId!,
      firstName: e.firstName,
      lastName: e.lastName,
      positionId: e.positionId,
      secondaryPositionId: e.secondaryPositionId,
      isTechnicalDirector: e.isTechnicalDirector,
      isRotating: e.isRotating,
      currentBranchId: e.currentBranchId,
      weeklyHours: e.weeklyHours === null ? null : Number(e.weeklyHours),
      hireDate: e.hireDate ? toISODate(e.hireDate) : null,
      extraTasks: e.extraTasks,
      active: e.active,
    })),
    schedules: schedules.map((s) => ({
      employeeId: s.employeeId,
      validFrom: toISODate(s.validFrom),
      abReferenceDate: s.abReferenceDate ? toISODate(s.abReferenceDate) : null,
      slots: s.slots.map((x) => ({
        week: x.week as ScheduleWeekValue, dayOfWeek: x.dayOfWeek, slot: x.slot,
        startMinute: x.startMinute, endMinute: x.endMinute, branchId: x.branchId, otherPlace: x.otherPlace,
      })),
    })),
    balances: balances.map((b) => ({ employeeId: b.employeeId, year: b.year, days: b.days })),
    employeesWithConsumption: consumption.map((m) => m.employeeId),
    leaves: leaves.map((l) => ({
      employeeId: l.employeeId, absenceType: l.absenceType,
      startDate: toISODate(l.startDate), endDate: toISODate(l.endDate),
    })),
  };
}

export interface ApplyResult {
  positionsCreated: number;
  employeesCreated: number;
  employeesUpdated: number;
  schedulesCreated: number;
  balancesCreated: number;
  balancesUpdated: number;
  /** Saldos que no se recargaron por consumos/devoluciones (sin --force-saldos). */
  balancesBlocked: number;
  leavesCreated: number;
}


export async function applyLoadPlan(
  db: PrismaClient,
  plan: LoadPlan,
  actor: { userId: string },
  opts: { today?: Date; timeoutMs?: number } = {},
): Promise<ApplyResult> {
  if (plan.errors.length > 0) {
    throw new Error(`El plan tiene ${plan.errors.length} error(es): no se escribe nada.`);
  }
  const today = utcDay(opts.today ?? new Date());
  const result: ApplyResult = {
    positionsCreated: 0, employeesCreated: 0, employeesUpdated: 0,
    schedulesCreated: 0, balancesCreated: 0, balancesUpdated: 0, leavesCreated: 0,
    balancesBlocked: plan.balances.filter((b) => b.action === "blocked").length,
  };

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Puestos del catálogo que falten
    for (const name of plan.positionsToCreate) {
      await tx.position.create({ data: { name } });
      result.positionsCreated++;
    }
    const positions = await tx.position.findMany({ select: { id: true, name: true } });
    const posId = (name: string) => positions.find((p) => p.name === name)!.id;

    // 2. Empleados
    const idByKey = new Map<string, string>();
    const existing = await tx.employee.findMany({
      where: { nameKey: { not: null } },
      select: { id: true, nameKey: true, contractBranchId: true, currentBranchId: true },
    });
    for (const e of existing) idByKey.set(`${e.nameKey}|${e.contractBranchId}`, e.id);

    for (const e of plan.employees) {
      const data = {
        firstName: e.data.firstName,
        lastName: e.data.lastName,
        nameKey: e.data.nameKey,
        contractBranchId: e.data.contractBranchId,
        currentBranchId: e.data.currentBranchId,
        positionId: posId(e.data.positionName),
        secondaryPositionId: e.data.secondaryPositionName ? posId(e.data.secondaryPositionName) : null,
        isTechnicalDirector: e.data.isTechnicalDirector,
        isRotating: e.data.isRotating,
        weeklyHours: e.data.weeklyHours,
        hireDate: e.data.hireDate ? d(e.data.hireDate) : null,
        extraTasks: e.data.extraTasks,
        active: true,
      };
      if (e.action === "create") {
        const created = await tx.employee.create({ data });
        idByKey.set(e.personKey, created.id);
        if (data.currentBranchId) {
          await tx.employeeBranchAssignment.create({
            data: {
              employeeId: created.id, branchId: data.currentBranchId, type: "PERMANENT", status: "ACTIVE",
              startDate: data.hireDate ?? today, endDate: null, reason: "Carga de personal real",
              assignedByUserId: actor.userId,
            },
          });
        }
        result.employeesCreated++;
      } else if (e.action === "update") {
        const id = e.existingId!;
        const before = existing.find((x) => x.id === id);
        await tx.employee.update({ where: { id }, data });
        // Cambió la sucursal donde trabaja: se cierra la PERMANENT abierta y se abre otra (como createAssignment).
        if (before && before.currentBranchId !== data.currentBranchId) {
          await tx.employeeBranchAssignment.updateMany({
            where: { employeeId: id, type: "PERMANENT", endDate: null },
            data: { endDate: addDays(today, -1) },
          });
          if (data.currentBranchId) {
            await tx.employeeBranchAssignment.create({
              data: {
                employeeId: id, branchId: data.currentBranchId, type: "PERMANENT", status: "ACTIVE",
                startDate: today, endDate: null, reason: "Carga de personal real (cambio de sucursal)",
                assignedByUserId: actor.userId,
              },
            });
          }
        }
        result.employeesUpdated++;
      }
    }
    const idOf = (key: string) => {
      const id = idByKey.get(key);
      if (!id) throw new Error(`Persona sin id: ${key}`);
      return id;
    };

    // 3. Horarios (solo nuevos; el anterior no se pisa)
    for (const s of plan.schedules.filter((x) => x.action === "create")) {
      await tx.workSchedule.create({
        data: {
          employeeId: idOf(s.personKey),
          validFrom: d(s.validFrom),
          abReferenceDate: s.abReferenceDate ? d(s.abReferenceDate) : null,
          slots: { create: s.slots.map((x) => ({
            week: x.week, dayOfWeek: x.dayOfWeek, slot: x.slot,
            startMinute: x.startMinute, endMinute: x.endMinute,
            branchId: x.branchId, otherPlace: x.otherPlace,
          })) },
        },
      });
      result.schedulesCreated++;
    }

    // 4. Saldos + movimientos. "blocked" (persona con consumos/devoluciones,
    // sin --force-saldos) no se toca; se vuelve a chequear dentro de la
    // transacción por si hubo un consumo entre el dry-run y el apply.
    for (const b of plan.balances.filter((x) => x.action === "create" || x.action === "update")) {
      const employeeId = idOf(b.personKey);
      if (!plan.forceBalances) {
        const consumed = await tx.vacationBalanceMovement.count({
          where: { employeeId, type: { in: ["CONSUME", "REFUND"] } },
        });
        if (consumed > 0) { result.balancesBlocked++; continue; }
      }
      const current = await tx.vacationBalance.findUnique({ where: { employeeId_year: { employeeId, year: b.year } } });
      const delta = b.days - (current?.days ?? 0);
      if (delta === 0 && current) continue;
      await tx.vacationBalance.upsert({
        where: { employeeId_year: { employeeId, year: b.year } },
        create: { employeeId, year: b.year, days: b.days },
        update: { days: b.days },
      });
      await tx.vacationBalanceMovement.create({
        data: {
          employeeId, year: b.year, days: delta,
          type: current ? "LOAD_ADJUST" : "LOAD",
          userId: actor.userId,
          note: current ? `Planilla: ${current.days} → ${b.days}` : "Carga inicial desde planilla",
        },
      });
      if (current) result.balancesUpdated++; else result.balancesCreated++;
    }

    // 5. Licencias (sin reasonDetail: no hay lugar para motivo médico)
    for (const l of plan.leaves.filter((x) => x.action === "create")) {
      const employeeId = idOf(l.personKey);
      const emp = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
        include: { position: { select: { name: true } }, currentBranch: { select: { id: true, name: true } }, contractBranch: { select: { id: true, name: true } } },
      });
      const branch = emp.currentBranch ?? emp.contractBranch!;
      await tx.absenceRecord.create({
        data: {
          employeeId, branchId: branch.id,
          employeeNameSnapshot: `${emp.firstName} ${emp.lastName}`,
          branchNameSnapshot: branch.name,
          positionNameSnapshot: emp.position.name,
          reportedByUserId: actor.userId,
          startDate: d(l.startDate), endDate: d(l.endDate),
          absenceType: l.absenceType,
          notes: "Carga de personal real",
        },
      });
      result.leavesCreated++;
    }

    const wrote = Object.entries(result).some(([k, n]) => k !== "balancesBlocked" && n > 0);
    if (wrote) {
      await tx.auditLog.create({
        data: {
          userId: actor.userId, action: "PERSONAL_LOAD", entity: "Employee",
          detail: result as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }, { timeout: opts.timeoutMs ?? 300_000, maxWait: 30_000 });

  return result;
}
