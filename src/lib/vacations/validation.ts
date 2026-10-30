// =============================================================================
// Validación de solicitudes de vacaciones.
//
// Backend manda la verdad final. El frontend puede prevalidar para UX, pero
// el POST/PATCH/aprobación DEBE volver a correr esto antes de aceptar.
//
// Las reglas están en rules.ts (lógica pura). Acá se arma el contexto desde la
// base: empleado, horarios reales, solicitudes y licencias superpuestas,
// saldo y rotativos libres.
// =============================================================================

import { prisma } from "@/lib/prisma";
import { coveredByRotatives, positionKeyOf } from "@/lib/personal/catalog";
import type { OtherPerson } from "@/lib/personal/coverage";
import { evaluateVacationRules, type ValidationResult } from "./rules";
import { loadRotativeOptions } from "./coverage-data";
import {
  ACTIVE_VACATION_STATUSES, BUSY_ABSENCE_TYPES, employeePositionKeys, loadAbsences,
  scheduleInclude, toSchedule, type Db,
} from "./people";

export {
  calculateVacationDays, isMultipleOfSeven, isMonday, isTuesdayAfterHoliday,
  type RuleStatus, type RuleResult, type ConflictDetail, type ValidationResult,
} from "./rules";
export { ACTIVE_VACATION_STATUSES, BUSY_ABSENCE_TYPES, LEAVE_ABSENCE_TYPES, type Db } from "./people";

export interface ValidationInput {
  employeeId: string;
  startDate: Date;
  endDate: Date;
  /** Si estamos editando o aprobando, no contar la propia solicitud como conflicto. */
  excludeRequestId?: string;
}

export async function validateVacationRequest(
  input: ValidationInput,
  db: Db = prisma,
): Promise<ValidationResult> {
  const { startDate, endDate, excludeRequestId } = input;
  if (endDate < startDate) {
    return evaluateVacationRules({
      startDate, endDate, employee: null, otherVacations: [], selfOverlap: null,
      others: [], balances: [], rotativos: null, branchNames: {},
    });
  }

  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    include: {
      position: true,
      secondaryPosition: true,
      currentBranch: { select: { zone: true } },
      workSchedules: scheduleInclude,
      vacationBalances: { select: { year: true, days: true } },
    },
  });

  const branches = await db.branch.findMany({ select: { id: true, name: true } });
  const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.name]));

  if (!employee) {
    return evaluateVacationRules({
      startDate, endDate, employee: null, otherVacations: [], selfOverlap: null,
      others: [], balances: [], rotativos: null, branchNames,
    });
  }

  const positionKey = positionKeyOf(employee.position?.name);

  // Solicitudes activas superpuestas (todas las personas)
  const overlapping = await db.vacationRequest.findMany({
    where: {
      id: excludeRequestId ? { not: excludeRequestId } : undefined,
      status: { in: ACTIVE_VACATION_STATUSES },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    include: { employee: { include: { position: true } }, branch: true },
    orderBy: { startDate: "asc" },
  });
  const self = overlapping.find((v) => v.employeeId === employee.id) ?? null;
  const otherVacations = overlapping
    .filter((v) => v.employeeId !== employee.id)
    .map((v) => ({
      id: v.id,
      employeeId: v.employeeId,
      employeeName: v.employeeNameSnapshot,
      positionKey: positionKeyOf(v.employee.position?.name),
      branchId: v.branchId,
      branchName: v.branch.name,
      startDate: v.startDate,
      endDate: v.endDate,
    }));

  // Personas para el cruce por horario: mismo puesto (principal o secundario),
  // con vacaciones activas, licencia o ausencia por enfermedad superpuestas.
  let others: OtherPerson[] = [];
  if (positionKey) {
    const leaveIds = (await db.absenceRecord.findMany({
      where: {
        absenceType: { in: [...BUSY_ABSENCE_TYPES] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        employeeId: { not: employee.id },
      },
      select: { employeeId: true },
    })).map((a) => a.employeeId);
    const ids = [...new Set([...otherVacations.map((v) => v.employeeId), ...leaveIds])];
    if (ids.length > 0) {
      const people = await db.employee.findMany({
        where: { id: { in: ids } },
        include: { position: true, secondaryPosition: true, workSchedules: scheduleInclude },
      });
      const absences = await loadAbsences(db, ids, startDate, endDate, excludeRequestId);
      others = people
        .map((p) => ({
          employeeId: p.id,
          name: `${p.firstName} ${p.lastName}`,
          positionName: p.position?.name ?? "",
          positionKeys: employeePositionKeys(p),
          absences: absences.get(p.id) ?? [],
          schedules: p.workSchedules.map(toSchedule),
        }))
        .filter((p) => p.positionKeys.includes(positionKey));
    }
  }

  // Rotativos: solo puestos de cobertura en sucursales de zona CABA.
  const branchZone = employee.currentBranch?.zone ?? null;
  const rotativos = positionKey && employee.currentBranchId && coveredByRotatives(positionKey, branchZone)
    ? (await loadRotativeOptions(db, {
        employeeId: employee.id,
        positionKey,
        branchId: employee.currentBranchId,
        startDate,
        endDate,
        excludeRequestId,
      })).availability
    : null;

  return evaluateVacationRules({
    startDate,
    endDate,
    employee: {
      id: employee.id,
      active: employee.active,
      positionKey,
      positionName: employee.position?.name ?? null,
      branchId: employee.currentBranchId,
      branchZone,
      schedules: employee.workSchedules.map(toSchedule),
    },
    otherVacations,
    selfOverlap: self
      ? { id: self.id, startDate: self.startDate, endDate: self.endDate, branchName: self.branch.name }
      : null,
    others,
    balances: employee.vacationBalances,
    rotativos,
    branchNames,
  });
}
