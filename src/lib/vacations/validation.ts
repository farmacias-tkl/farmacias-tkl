// =============================================================================
// Validación de solicitudes de vacaciones.
//
// Backend manda la verdad final. El frontend puede prevalidar para UX, pero
// el POST/PATCH a la API DEBE volver a correr esto antes de aceptar.
//
// Reglas implementadas:
//   - Inicio debe ser lunes (o martes si el lunes anterior es feriado).
//   - Duración debe ser múltiplo de 7 días.
//   - Conflicto A: dos Encargados en la misma sucursal con vacaciones
//     superpuestas → BLOCKING.
//   - Conflicto B: dos Cadetes globales con vacaciones superpuestas →
//     BLOCKING (porque cubren rotativas entre sucursales).
//   - Conflicto C: mismo puesto + mismo turno + misma sucursal superpuestos
//     → BLOCKING. Si el empleado no tiene turno (shiftLabel == null), no se
//     puede aplicar la regla → WARNING.
//
// Datos faltantes (sin puesto, sin turno) bajan a WARNING, no BLOCKING.
// =============================================================================

import { prisma } from "@/lib/prisma";
import { isHoliday } from "@/lib/holidays";
import type { VacationStatus } from "@prisma/client";

// Estados que ocupan al empleado/puesto para fines de conflicto.
// REJECTED y CANCELLED no cuentan.
export const ACTIVE_VACATION_STATUSES: VacationStatus[] = [
  "PENDING_SUPERVISOR",
  "PENDING_RRHH",
  "APPROVED",
];

export type RuleStatus = "OK" | "WARNING" | "BLOCKING";

export interface RuleResult {
  rule: string;
  status: RuleStatus;
  message: string;
}

export interface ConflictDetail {
  type: "MANAGER_SAME_BRANCH" | "CADET_GLOBAL" | "SAME_POSITION_SAME_SHIFT_SAME_BRANCH";
  message: string;
  conflictingVacationId: string;
  conflictingEmployeeName: string;
  conflictingBranchName: string;
  conflictingDates: { startDate: string; endDate: string };
}

export interface ValidationResult {
  isValid: boolean;
  calculatedDays: number;
  conflictLevel: "NONE" | "WARNING" | "BLOCKING";
  ruleResults: RuleResult[];
  blockingConflicts: ConflictDetail[];
  warnings: ConflictDetail[];
}

export interface ValidationInput {
  employeeId: string;
  startDate: Date;
  endDate: Date;
  /** Si estamos editando, no contar la propia solicitud como conflicto. */
  excludeRequestId?: string;
}

/** Días incluyendo inicio y fin. lunes a domingo = 7. */
export function calculateVacationDays(startDate: Date, endDate: Date): number {
  const a = startOfDay(startDate);
  const b = startOfDay(endDate);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function isMultipleOfSeven(days: number): boolean {
  return days > 0 && days % 7 === 0;
}

/** Day-of-week local: 1 = lunes. */
export function isMonday(date: Date): boolean {
  return date.getDay() === 1;
}

/** Martes después de un lunes feriado. */
export function isTuesdayAfterHoliday(date: Date): boolean {
  if (date.getDay() !== 2) return false;
  const prevMonday = new Date(date);
  prevMonday.setDate(prevMonday.getDate() - 1);
  return isHoliday(prevMonday);
}

/** Dos rangos se solapan si cada uno empieza antes (o cuando) termina el otro. */
export function rangesOverlap(
  aStart: Date, aEnd: Date,
  bStart: Date, bEnd: Date,
): boolean {
  return startOfDay(aStart).getTime() <= startOfDay(bEnd).getTime() &&
         startOfDay(aEnd).getTime()   >= startOfDay(bStart).getTime();
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// =============================================================================
// Validación principal
// =============================================================================

export async function validateVacationRequest(
  input: ValidationInput,
): Promise<ValidationResult> {
  const ruleResults: RuleResult[] = [];
  const blockingConflicts: ConflictDetail[] = [];
  const warnings: ConflictDetail[] = [];

  // 0. Datos básicos
  if (input.endDate < input.startDate) {
    ruleResults.push({
      rule: "rango",
      status: "BLOCKING",
      message: "La fecha fin es anterior a la fecha inicio.",
    });
    return finalize(0, ruleResults, blockingConflicts, warnings);
  }

  const calculatedDays = calculateVacationDays(input.startDate, input.endDate);

  // 1. Duración múltiplo de 7
  if (isMultipleOfSeven(calculatedDays)) {
    ruleResults.push({
      rule: "duracion",
      status: "OK",
      message: `Duración válida: ${calculatedDays} días`,
    });
  } else {
    ruleResults.push({
      rule: "duracion",
      status: "BLOCKING",
      message: `Duración inválida: ${calculatedDays} días. Debe ser múltiplo de 7.`,
    });
  }

  // 2. Inicio lunes (o martes post-feriado)
  if (isMonday(input.startDate)) {
    ruleResults.push({
      rule: "inicio",
      status: "OK",
      message: "Inicio válido: lunes",
    });
  } else if (isTuesdayAfterHoliday(input.startDate)) {
    ruleResults.push({
      rule: "inicio",
      status: "OK",
      message: "Inicio válido: martes después de lunes feriado",
    });
  } else {
    ruleResults.push({
      rule: "inicio",
      status: "BLOCKING",
      message: "Las vacaciones deben iniciar lunes (o martes si el lunes anterior es feriado).",
    });
  }

  // 3. Cargar empleado + puesto + sucursal
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: {
      position: true,
      currentBranch: true,
    },
  });

  if (!employee) {
    ruleResults.push({
      rule: "empleado",
      status: "BLOCKING",
      message: "Empleado no encontrado.",
    });
    return finalize(calculatedDays, ruleResults, blockingConflicts, warnings);
  }

  if (!employee.positionId || !employee.position) {
    ruleResults.push({
      rule: "puesto",
      status: "WARNING",
      message: "Empleado sin puesto configurado. No se pueden validar conflictos por puesto.",
    });
    return finalize(calculatedDays, ruleResults, blockingConflicts, warnings);
  }

  if (!employee.currentBranchId) {
    ruleResults.push({
      rule: "sucursal",
      status: "WARNING",
      message: "Empleado sin sucursal asignada. No se pueden validar conflictos por sucursal.",
    });
    return finalize(calculatedDays, ruleResults, blockingConflicts, warnings);
  }

  const positionName = employee.position.name.trim().toLowerCase();
  const isManager = positionName === "encargado";
  const isCadet   = positionName === "cadete";
  // Por ahora Employee no tiene campo de turno estructurado.
  // workScheduleNotes es texto libre, no apto para comparación. Cuando exista
  // Employee.shiftLabel (o tabla Shift), reemplazar acá.
  const employeeShift: string | null = null;

  // 4. Cargar candidatos a conflicto: solicitudes activas que se solapen
  const overlapping = await prisma.vacationRequest.findMany({
    where: {
      id: input.excludeRequestId ? { not: input.excludeRequestId } : undefined,
      status: { in: ACTIVE_VACATION_STATUSES },
      startDate: { lte: input.endDate },
      endDate:   { gte: input.startDate },
      employeeId: { not: input.employeeId }, // mismo empleado no es conflicto, es duplicado (lo bloqueamos aparte)
    },
    include: {
      employee: { include: { position: true } },
      branch: true,
    },
  });

  // 4.b Misma persona ya tiene solicitud activa solapada
  const selfOverlap = await prisma.vacationRequest.findFirst({
    where: {
      id: input.excludeRequestId ? { not: input.excludeRequestId } : undefined,
      employeeId: input.employeeId,
      status: { in: ACTIVE_VACATION_STATUSES },
      startDate: { lte: input.endDate },
      endDate:   { gte: input.startDate },
    },
    include: { branch: true },
  });
  if (selfOverlap) {
    blockingConflicts.push({
      type: "SAME_POSITION_SAME_SHIFT_SAME_BRANCH",
      message: `Este empleado ya tiene una solicitud activa entre ${fmtDate(selfOverlap.startDate)} y ${fmtDate(selfOverlap.endDate)}.`,
      conflictingVacationId:    selfOverlap.id,
      conflictingEmployeeName:  selfOverlap.employeeNameSnapshot,
      conflictingBranchName:    selfOverlap.branch.name,
      conflictingDates: {
        startDate: fmtDate(selfOverlap.startDate),
        endDate:   fmtDate(selfOverlap.endDate),
      },
    });
  }

  // 5. Regla A: dos Encargados en la misma sucursal
  if (isManager) {
    for (const other of overlapping) {
      if (!other.employee.position) continue;
      const otherIsManager = other.employee.position.name.trim().toLowerCase() === "encargado";
      if (otherIsManager && other.branchId === employee.currentBranchId) {
        blockingConflicts.push({
          type: "MANAGER_SAME_BRANCH",
          message: `Ya hay otro Encargado de ${other.branch.name} con vacaciones entre ${fmtDate(other.startDate)} y ${fmtDate(other.endDate)}.`,
          conflictingVacationId:   other.id,
          conflictingEmployeeName: other.employeeNameSnapshot,
          conflictingBranchName:   other.branch.name,
          conflictingDates: {
            startDate: fmtDate(other.startDate),
            endDate:   fmtDate(other.endDate),
          },
        });
      }
    }
  }

  // 6. Regla B: dos Cadetes globalmente
  if (isCadet) {
    for (const other of overlapping) {
      if (!other.employee.position) continue;
      const otherIsCadet = other.employee.position.name.trim().toLowerCase() === "cadete";
      if (otherIsCadet) {
        blockingConflicts.push({
          type: "CADET_GLOBAL",
          message: `Ya hay otro Cadete (${other.employeeNameSnapshot}, ${other.branch.name}) con vacaciones entre ${fmtDate(other.startDate)} y ${fmtDate(other.endDate)}.`,
          conflictingVacationId:   other.id,
          conflictingEmployeeName: other.employeeNameSnapshot,
          conflictingBranchName:   other.branch.name,
          conflictingDates: {
            startDate: fmtDate(other.startDate),
            endDate:   fmtDate(other.endDate),
          },
        });
      }
    }
  }

  // 7. Regla C: mismo puesto + mismo turno + misma sucursal
  // Si el empleado no tiene turno, no podemos aplicar la regla con certeza.
  if (employeeShift === null) {
    ruleResults.push({
      rule: "turno",
      status: "WARNING",
      message: "Empleado sin turno configurado. No se puede validar conflicto por turno (regla C).",
    });
  } else {
    for (const other of overlapping) {
      if (!other.employee.position) continue;
      const samePosition = other.employee.position.id === employee.positionId;
      const sameBranch   = other.branchId === employee.currentBranchId;
      const sameShift    = other.shiftLabel === employeeShift;
      if (samePosition && sameBranch && sameShift) {
        blockingConflicts.push({
          type: "SAME_POSITION_SAME_SHIFT_SAME_BRANCH",
          message: `Ya hay otro ${other.positionNameSnapshot} del mismo turno en ${other.branch.name} con vacaciones entre ${fmtDate(other.startDate)} y ${fmtDate(other.endDate)}.`,
          conflictingVacationId:   other.id,
          conflictingEmployeeName: other.employeeNameSnapshot,
          conflictingBranchName:   other.branch.name,
          conflictingDates: {
            startDate: fmtDate(other.startDate),
            endDate:   fmtDate(other.endDate),
          },
        });
      }
    }
  }

  return finalize(calculatedDays, ruleResults, blockingConflicts, warnings);
}

// =============================================================================

function finalize(
  calculatedDays: number,
  ruleResults: RuleResult[],
  blockingConflicts: ConflictDetail[],
  warnings: ConflictDetail[],
): ValidationResult {
  const hasBlockingRule = ruleResults.some(r => r.status === "BLOCKING");
  const hasWarningRule  = ruleResults.some(r => r.status === "WARNING");
  const conflictLevel: "NONE" | "WARNING" | "BLOCKING" =
    blockingConflicts.length > 0 || hasBlockingRule ? "BLOCKING" :
    warnings.length > 0 || hasWarningRule           ? "WARNING" :
    "NONE";
  const isValid = conflictLevel !== "BLOCKING";
  return {
    isValid,
    calculatedDays,
    conflictLevel,
    ruleResults,
    blockingConflicts,
    warnings,
  };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
