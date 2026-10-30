// =============================================================================
// Carga de personal real: foto de la base y aplicación del plan (Prisma).
//
// applyLoadPlan corre TODO en una transacción, no borra nada y solo escribe lo
// que el plan marca como create/update: con los mismos archivos, la segunda
// corrida no cambia nada. Se niega a escribir si el plan tiene errores.
//
// Escribe por lotes (createMany, UPDATE ... FROM VALUES): la carga entera son
// pocas decenas de consultas, para que la transacción no dependa de la
// latencia a la base (cada ida y vuelta a Neon desde Argentina ~0,7 s).
// =============================================================================

import { Prisma, type PrismaClient } from "@prisma/client";
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

/** Filas por sentencia en createMany / UPDATE ... FROM (VALUES ...): lejos del límite de parámetros de Postgres. */
const CHUNK = 1000;

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Fecha de calendario como timestamp sin zona (columnas DateTime de Prisma = timestamp(3)). */
const ts = (iso: string | null) => (iso ? `${iso} 00:00:00` : null);

export async function applyLoadPlan(
  db: PrismaClient,
  plan: LoadPlan,
  actor: { userId: string },
  opts: { today?: Date; timeoutMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<ApplyResult> {
  if (plan.errors.length > 0) {
    throw new Error(`El plan tiene ${plan.errors.length} error(es): no se escribe nada.`);
  }
  const today = utcDay(opts.today ?? new Date());
  const progress = opts.onProgress ?? (() => {});
  const result: ApplyResult = {
    positionsCreated: 0, employeesCreated: 0, employeesUpdated: 0,
    schedulesCreated: 0, balancesCreated: 0, balancesUpdated: 0, leavesCreated: 0,
    balancesBlocked: plan.balances.filter((b) => b.action === "blocked").length,
  };

  // Todo por lotes: cada etapa son unas pocas consultas, sin importar cuántas
  // personas haya (desde Argentina cada ida y vuelta a Neon cuesta ~0,7 s).
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Puestos del catálogo que falten
    if (plan.positionsToCreate.length > 0) {
      await tx.position.createMany({ data: plan.positionsToCreate.map((name) => ({ name })) });
      result.positionsCreated = plan.positionsToCreate.length;
    }
    const positions = await tx.position.findMany({ select: { id: true, name: true } });
    const posByName = new Map(positions.map((p) => [p.name, p.id]));
    const posId = (name: string) => {
      const id = posByName.get(name);
      if (!id) throw new Error(`Puesto inexistente: ${name}`);
      return id;
    };

    // 2. Empleados
    const toCreate = plan.employees.filter((e) => e.action === "create");
    const toUpdate = plan.employees.filter((e) => e.action === "update");
    progress(`empleados: ${toCreate.length} a crear, ${toUpdate.length} a actualizar...`);
    const dataOf = (e: (typeof plan.employees)[number]) => ({
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
    });

    const existing = await tx.employee.findMany({
      where: { nameKey: { not: null } },
      select: { id: true, nameKey: true, contractBranchId: true, currentBranchId: true },
    });
    const beforeById = new Map(existing.map((e) => [e.id, e]));

    for (const part of chunks(toCreate)) {
      await tx.employee.createMany({ data: part.map(dataOf) });
    }
    result.employeesCreated = toCreate.length;

    // Ids por la clave de identidad (nameKey + sucursal de contrato): una lectura.
    const idByKey = new Map<string, string>();
    const withKey = await tx.employee.findMany({
      where: { nameKey: { not: null }, contractBranchId: { not: null } },
      select: { id: true, nameKey: true, contractBranchId: true },
    });
    for (const e of withKey) idByKey.set(`${e.nameKey}|${e.contractBranchId}`, e.id);
    const idOf = (key: string) => {
      const id = idByKey.get(key);
      if (!id) throw new Error(`Persona sin id: ${key}`);
      return id;
    };

    // Asignación PERMANENT de las altas con sucursal donde trabaja.
    const newAssignments = toCreate
      .filter((e) => e.data.currentBranchId)
      .map((e) => ({
        employeeId: idOf(e.personKey), branchId: e.data.currentBranchId!, type: "PERMANENT" as const, status: "ACTIVE" as const,
        startDate: e.data.hireDate ? d(e.data.hireDate) : today, endDate: null, reason: "Carga de personal real",
        assignedByUserId: actor.userId,
      }));

    // Actualizaciones: un UPDATE ... FROM (VALUES ...) por lote.
    if (toUpdate.length > 0) {
      for (const part of chunks(toUpdate, 500)) {
        const rows = part.map((e) => {
          const x = dataOf(e);
          return Prisma.sql`(${e.existingId!}, ${x.firstName}, ${x.lastName}, ${x.currentBranchId}, ${x.positionId},
            ${x.secondaryPositionId}, ${x.isTechnicalDirector}, ${x.isRotating}, ${x.weeklyHours === null ? null : String(x.weeklyHours)},
            ${ts(e.data.hireDate)}, ${x.extraTasks})`;
        });
        await tx.$executeRaw`
          UPDATE "Employee" AS e SET
            "firstName" = v.first_name, "lastName" = v.last_name, "currentBranchId" = v.current_branch_id,
            "positionId" = v.position_id, "secondaryPositionId" = v.secondary_position_id,
            "isTechnicalDirector" = v.is_dt::boolean, "isRotating" = v.is_rotating::boolean,
            "weeklyHours" = v.weekly_hours::numeric(4,1), "hireDate" = v.hire_date::timestamp(3),
            "extraTasks" = v.extra_tasks, active = true, "updatedAt" = now()
          FROM (VALUES ${Prisma.join(rows)}) AS v(id, first_name, last_name, current_branch_id, position_id,
            secondary_position_id, is_dt, is_rotating, weekly_hours, hire_date, extra_tasks)
          WHERE e.id = v.id`;
      }
      result.employeesUpdated = toUpdate.length;

      // Cambió la sucursal donde trabaja: se cierra la PERMANENT abierta y se abre otra (como createAssignment).
      const moved = toUpdate.filter((e) => {
        const before = beforeById.get(e.existingId!);
        return before && before.currentBranchId !== e.data.currentBranchId;
      });
      if (moved.length > 0) {
        await tx.employeeBranchAssignment.updateMany({
          where: { employeeId: { in: moved.map((e) => e.existingId!) }, type: "PERMANENT", endDate: null },
          data: { endDate: addDays(today, -1) },
        });
        for (const e of moved.filter((x) => x.data.currentBranchId)) {
          newAssignments.push({
            employeeId: e.existingId!, branchId: e.data.currentBranchId!, type: "PERMANENT", status: "ACTIVE",
            startDate: today, endDate: null, reason: "Carga de personal real (cambio de sucursal)",
            assignedByUserId: actor.userId,
          });
        }
      }
    }
    for (const part of chunks(newAssignments)) {
      await tx.employeeBranchAssignment.createMany({ data: part });
    }
    progress(`empleados: listo (${result.employeesCreated} creados, ${result.employeesUpdated} actualizados, ${newAssignments.length} asignaciones).`);

    // 3. Horarios (solo nuevos; el anterior no se pisa) y sus tramos
    const newSchedules = plan.schedules.filter((x) => x.action === "create");
    progress(`horarios: ${newSchedules.length} a crear...`);
    if (newSchedules.length > 0) {
      for (const part of chunks(newSchedules)) {
        await tx.workSchedule.createMany({
          data: part.map((s) => ({
            employeeId: idOf(s.personKey),
            validFrom: d(s.validFrom),
            abReferenceDate: s.abReferenceDate ? d(s.abReferenceDate) : null,
          })),
        });
      }
      // Ids por (empleado, vigente desde), que es único.
      const scheduleRows = await tx.workSchedule.findMany({
        where: { employeeId: { in: [...new Set(newSchedules.map((s) => idOf(s.personKey)))] } },
        select: { id: true, employeeId: true, validFrom: true },
      });
      const scheduleId = new Map(scheduleRows.map((r) => [`${r.employeeId}|${toISODate(r.validFrom)}`, r.id]));
      const slots = newSchedules.flatMap((s) => {
        const id = scheduleId.get(`${idOf(s.personKey)}|${s.validFrom}`);
        if (!id) throw new Error(`Horario sin id: ${s.personKey} ${s.validFrom}`);
        return s.slots.map((x) => ({
          scheduleId: id, week: x.week, dayOfWeek: x.dayOfWeek, slot: x.slot,
          startMinute: x.startMinute, endMinute: x.endMinute,
          branchId: x.branchId, otherPlace: x.otherPlace,
        }));
      });
      for (const part of chunks(slots)) {
        await tx.workScheduleSlot.createMany({ data: part });
      }
      result.schedulesCreated = newSchedules.length;
      progress(`horarios: listo (${newSchedules.length} horarios, ${slots.length} tramos).`);
    }

    // 4. Saldos + movimientos. "blocked" (persona con consumos/devoluciones,
    // sin --force-saldos) no se toca; se vuelve a chequear dentro de la
    // transacción por si hubo un consumo entre el dry-run y el apply.
    const pending = plan.balances
      .filter((x) => x.action === "create" || x.action === "update")
      .map((b) => ({ ...b, employeeId: idOf(b.personKey) }));
    progress(`saldos: ${pending.length} a revisar...`);
    if (pending.length > 0) {
      const ids = [...new Set(pending.map((b) => b.employeeId))];
      const consumed = plan.forceBalances ? new Set<string>() : new Set((await tx.vacationBalanceMovement.findMany({
        where: { employeeId: { in: ids }, type: { in: ["CONSUME", "REFUND"] } },
        select: { employeeId: true },
        distinct: ["employeeId"],
      })).map((m) => m.employeeId));
      const currentRows = await tx.vacationBalance.findMany({
        where: { employeeId: { in: ids } },
        select: { employeeId: true, year: true, days: true },
      });
      const current = new Map(currentRows.map((r) => [`${r.employeeId}|${r.year}`, r.days]));

      const creates: Array<{ employeeId: string; year: number; days: number }> = [];
      const updates: Array<{ employeeId: string; year: number; days: number }> = [];
      const movements: Prisma.VacationBalanceMovementCreateManyInput[] = [];
      for (const b of pending) {
        if (consumed.has(b.employeeId)) { result.balancesBlocked++; continue; }
        const now = current.get(`${b.employeeId}|${b.year}`);
        const delta = b.days - (now ?? 0);
        if (now !== undefined && delta === 0) continue;
        (now === undefined ? creates : updates).push({ employeeId: b.employeeId, year: b.year, days: b.days });
        movements.push({
          employeeId: b.employeeId, year: b.year, days: delta,
          type: now === undefined ? "LOAD" : "LOAD_ADJUST",
          userId: actor.userId,
          note: now === undefined ? "Carga inicial desde planilla" : `Planilla: ${now} → ${b.days}`,
        });
      }
      for (const part of chunks(creates)) await tx.vacationBalance.createMany({ data: part });
      for (const part of chunks(updates, 500)) {
        const rows = part.map((u) => Prisma.sql`(${u.employeeId}, ${u.year}, ${u.days})`);
        await tx.$executeRaw`
          UPDATE "VacationBalance" AS b SET days = v.days::integer, "updatedAt" = now()
          FROM (VALUES ${Prisma.join(rows)}) AS v(employee_id, year, days)
          WHERE b."employeeId" = v.employee_id AND b.year = v.year::integer`;
      }
      for (const part of chunks(movements)) await tx.vacationBalanceMovement.createMany({ data: part });
      result.balancesCreated = creates.length;
      result.balancesUpdated = updates.length;
    }
    progress(`saldos: listo (${result.balancesCreated} creados, ${result.balancesUpdated} actualizados, ${result.balancesBlocked} frenados).`);

    // 5. Licencias (sin reasonDetail: no hay lugar para motivo médico)
    const newLeaves = plan.leaves.filter((x) => x.action === "create");
    if (newLeaves.length > 0) {
      const people = await tx.employee.findMany({
        where: { id: { in: [...new Set(newLeaves.map((l) => idOf(l.personKey)))] } },
        include: { position: { select: { name: true } }, currentBranch: { select: { id: true, name: true } }, contractBranch: { select: { id: true, name: true } } },
      });
      const byId = new Map(people.map((p) => [p.id, p]));
      await tx.absenceRecord.createMany({
        data: newLeaves.map((l) => {
          const emp = byId.get(idOf(l.personKey))!;
          const branch = emp.currentBranch ?? emp.contractBranch!;
          return {
            employeeId: emp.id, branchId: branch.id,
            employeeNameSnapshot: `${emp.firstName} ${emp.lastName}`,
            branchNameSnapshot: branch.name,
            positionNameSnapshot: emp.position.name,
            reportedByUserId: actor.userId,
            startDate: d(l.startDate), endDate: d(l.endDate),
            absenceType: l.absenceType,
            notes: "Carga de personal real",
          };
        }),
      });
      result.leavesCreated = newLeaves.length;
      progress(`licencias: listo (${newLeaves.length}).`);
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
