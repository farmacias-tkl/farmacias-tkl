// =============================================================================
// Reglas de una solicitud de vacaciones (adenda C). Lógica pura: recibe el
// contexto ya cargado (validation.ts lo arma desde la base) y devuelve el
// resultado. Fechas de calendario a 00:00 UTC (src/lib/personal/dates.ts).
//
// BLOQUEAN solo los errores de datos:
//   - fecha fin anterior a la de inicio;
//   - empleado inexistente o inactivo;
//   - la misma persona con otra solicitud activa superpuesta.
// ADVIERTEN (WARNING, se puede "Aprobar igual"):
//   - inicio que no es lunes (o martes después de lunes feriado);
//   - duración que no es múltiplo de 7;
//   - A: otro/a Encargado/a de la misma sucursal con vacaciones superpuestas;
//   - cruce por horario real (reemplaza a C): mismo puesto, ausente en fechas
//     superpuestas, misma sucursal y franjas que se pisan al menos un día;
//   - puestos con rotativos en sucursal de zona CABA (reemplaza a B): ningún
//     rotativo libre todo el período;
//   - saldo insuficiente.
// =============================================================================

import { isHoliday } from "@/lib/holidays";
import { addDays, diffDays, isoWeekday } from "@/lib/personal/dates";
import { coveredByRotatives, type PositionKey } from "@/lib/personal/catalog";
import { previewBalance, type BalancePreview, type BalanceYear } from "@/lib/personal/balance";
import {
  ABSENCE_KIND_LABEL, findScheduleOverlaps,
  type OtherPerson, type OverlapDetail, type RotativeAvailability,
} from "@/lib/personal/coverage";
import type { Schedule } from "@/lib/personal/schedule";

export type RuleStatus = "OK" | "WARNING" | "BLOCKING";

export interface RuleResult {
  rule: string;
  status: RuleStatus;
  message: string;
}

export interface ConflictDetail {
  type: "SELF_OVERLAP" | "MANAGER_SAME_BRANCH" | "SCHEDULE_OVERLAP" | "NO_FREE_ROTATIVE" | "BALANCE";
  message: string;
  conflictingVacationId?: string;
  conflictingEmployeeName?: string;
  conflictingBranchName?: string;
  conflictingDates?: { startDate: string; endDate: string };
}

export interface OverlapView extends OverlapDetail {
  branchName: string;
  stateLabel: string;
}

export interface ValidationResult {
  isValid: boolean;
  calculatedDays: number;
  conflictLevel: "NONE" | "WARNING" | "BLOCKING";
  ruleResults: RuleResult[];
  blockingConflicts: ConflictDetail[];
  warnings: ConflictDetail[];
  overlaps: OverlapView[];
  balance: BalancePreview | null;
  rotativos: { applies: boolean; freeAll: number; partial: number } | null;
}

export interface OverlappingVacation {
  id: string;
  employeeId: string;
  employeeName: string;
  positionKey: PositionKey | null;
  branchId: string;
  branchName: string;
  startDate: Date;
  endDate: Date;
}

export interface RuleContext {
  startDate: Date;
  endDate: Date;
  employee: null | {
    id: string;
    active: boolean;
    positionKey: PositionKey | null;
    positionName: string | null;
    branchId: string | null;
    /** Zona de la sucursal donde trabaja (Branch.zone): rotativos solo en CABA. */
    branchZone: string | null;
    schedules: Schedule[];
  };
  /** Solicitudes activas superpuestas de OTRAS personas. */
  otherVacations: OverlappingVacation[];
  /** Solicitud activa superpuesta de la misma persona (la primera), si hay. */
  selfOverlap: { id: string; startDate: Date; endDate: Date; branchName: string } | null;
  /** Personas para el cruce por horario (con sus ausencias y horarios). */
  others: OtherPerson[];
  balances: BalanceYear[];
  /** null si no se calcularon (puesto sin rotativos o sin datos). */
  rotativos: RotativeAvailability[] | null;
  branchNames: Record<string, string>;
}

/** Días incluyendo inicio y fin (corridos). Lunes a domingo = 7. */
export function calculateVacationDays(startDate: Date, endDate: Date): number {
  return diffDays(startDate, endDate) + 1;
}

export function isMultipleOfSeven(days: number): boolean {
  return days > 0 && days % 7 === 0;
}

/** Lunes, con el día de la fecha de calendario (UTC), no la hora local. */
export function isMonday(date: Date): boolean {
  return isoWeekday(date) === 1;
}

/** Martes después de un lunes feriado. */
export function isTuesdayAfterHoliday(date: Date): boolean {
  return isoWeekday(date) === 2 && isHoliday(addDays(date, -1));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function evaluateVacationRules(ctx: RuleContext): ValidationResult {
  const ruleResults: RuleResult[] = [];
  const blocking: ConflictDetail[] = [];
  const warnings: ConflictDetail[] = [];
  let overlaps: OverlapView[] = [];
  let balance: BalancePreview | null = null;
  let rotativos: ValidationResult["rotativos"] = null;

  const done = (days: number) =>
    finalize(days, ruleResults, blocking, warnings, overlaps, balance, rotativos);

  if (ctx.endDate < ctx.startDate) {
    ruleResults.push({ rule: "rango", status: "BLOCKING", message: "La fecha fin es anterior a la fecha inicio." });
    return done(0);
  }
  const days = calculateVacationDays(ctx.startDate, ctx.endDate);

  ruleResults.push(isMultipleOfSeven(days)
    ? { rule: "duracion", status: "OK", message: `Duración: ${days} días corridos.` }
    : { rule: "duracion", status: "WARNING", message: `Duración de ${days} días: no es múltiplo de 7.` });

  if (isMonday(ctx.startDate)) {
    ruleResults.push({ rule: "inicio", status: "OK", message: "Inicio: lunes." });
  } else if (isTuesdayAfterHoliday(ctx.startDate)) {
    ruleResults.push({ rule: "inicio", status: "OK", message: "Inicio: martes después de lunes feriado." });
  } else {
    ruleResults.push({ rule: "inicio", status: "WARNING", message: "No empieza un lunes (ni un martes después de lunes feriado)." });
  }

  const emp = ctx.employee;
  if (!emp) {
    ruleResults.push({ rule: "empleado", status: "BLOCKING", message: "Empleado no encontrado." });
    return done(days);
  }
  if (!emp.active) {
    ruleResults.push({ rule: "empleado", status: "BLOCKING", message: "El empleado está inactivo." });
    return done(days);
  }

  if (ctx.selfOverlap) {
    const s = ctx.selfOverlap;
    blocking.push({
      type: "SELF_OVERLAP",
      message: `Ya tiene una solicitud activa entre ${fmtDate(s.startDate)} y ${fmtDate(s.endDate)}.`,
      conflictingVacationId: s.id,
      conflictingBranchName: s.branchName,
      conflictingDates: { startDate: fmtDate(s.startDate), endDate: fmtDate(s.endDate) },
    });
  }

  // Saldo (también para personas sin puesto/sucursal configurados)
  balance = previewBalance(ctx.balances, days, ctx.startDate.getUTCFullYear());
  if (balance.insufficient) {
    const msg = balance.byYear.length === 0
      ? `No tiene saldo de vacaciones cargado; pide ${days} días.`
      : `Saldo insuficiente: tiene ${balance.total} días y pide ${days}. Quedaría en ${balance.totalAfter}.`;
    ruleResults.push({ rule: "saldo", status: "WARNING", message: msg });
    warnings.push({ type: "BALANCE", message: msg });
  } else {
    ruleResults.push({ rule: "saldo", status: "OK", message: `Saldo: ${balance.total} días; quedaría en ${balance.totalAfter}.` });
  }

  if (!emp.positionKey) {
    ruleResults.push({
      rule: "puesto", status: "WARNING",
      message: emp.positionName
        ? `El puesto "${emp.positionName}" no es del catálogo: no se comparan conflictos por puesto.`
        : "Empleado sin puesto: no se comparan conflictos por puesto.",
    });
    return done(days);
  }
  if (!emp.branchId) {
    ruleResults.push({ rule: "sucursal", status: "WARNING", message: "Empleado sin sucursal donde trabaja: no se comparan conflictos por sucursal." });
    return done(days);
  }

  // A: dos Encargados/as de la misma sucursal
  if (emp.positionKey === "ENCARGADO") {
    for (const o of ctx.otherVacations) {
      if (o.positionKey !== "ENCARGADO" || o.branchId !== emp.branchId) continue;
      warnings.push({
        type: "MANAGER_SAME_BRANCH",
        message: `${o.employeeName}, también Encargado/a de ${o.branchName}, tiene vacaciones entre ${fmtDate(o.startDate)} y ${fmtDate(o.endDate)}.`,
        conflictingVacationId: o.id,
        conflictingEmployeeName: o.employeeName,
        conflictingBranchName: o.branchName,
        conflictingDates: { startDate: fmtDate(o.startDate), endDate: fmtDate(o.endDate) },
      });
    }
  }

  // Cruce por horario real
  if (emp.schedules.length === 0) {
    ruleResults.push({ rule: "horario", status: "OK", message: "Sin horario cargado: no se comparan franjas." });
  } else {
    const found = findScheduleOverlaps({
      positionKey: emp.positionKey, startDate: ctx.startDate, endDate: ctx.endDate,
      schedules: emp.schedules, others: ctx.others,
    });
    overlaps = found.map((o) => ({
      ...o,
      branchName: ctx.branchNames[o.branchId] ?? o.branchId,
      stateLabel: ABSENCE_KIND_LABEL[o.kind],
    }));
    for (const o of overlaps) {
      warnings.push({
        type: "SCHEDULE_OVERLAP",
        message: `${o.employeeName} (${o.positionName}, ${o.stateLabel}) trabaja en ${o.branchName} en la misma franja: ${o.dates.length} día(s) desde ${o.dates[0]}, ${o.ranges.join(", ")}.`,
        conflictingEmployeeName: o.employeeName,
        conflictingBranchName: o.branchName,
      });
    }
    if (overlaps.length === 0) {
      ruleResults.push({ rule: "horario", status: "OK", message: "Sin cruces de horario con el mismo puesto." });
    }
  }

  // Rotativos (reemplaza a la regla B). Solo zona CABA: en PROVINCIA no se
  // proponen rotativos ni sale la advertencia.
  if (coveredByRotatives(emp.positionKey, emp.branchZone)) {
    const list = ctx.rotativos ?? [];
    const freeAll = list.filter((r) => r.freeAll).length;
    const partial = list.length - freeAll;
    rotativos = { applies: true, freeAll, partial };
    if (freeAll === 0) {
      const msg = partial > 0
        ? `No hay ningún rotativo libre todo el período (${partial} libre(s) algunos días).`
        : "No hay ningún rotativo libre para cubrir.";
      ruleResults.push({ rule: "rotativos", status: "WARNING", message: msg });
      warnings.push({ type: "NO_FREE_ROTATIVE", message: msg });
    } else {
      ruleResults.push({ rule: "rotativos", status: "OK", message: `${freeAll} rotativo(s) libre(s) todo el período.` });
    }
  }

  return done(days);
}

function finalize(
  calculatedDays: number,
  ruleResults: RuleResult[],
  blockingConflicts: ConflictDetail[],
  warnings: ConflictDetail[],
  overlaps: OverlapView[],
  balance: BalancePreview | null,
  rotativos: ValidationResult["rotativos"],
): ValidationResult {
  const hasBlocking = blockingConflicts.length > 0 || ruleResults.some((r) => r.status === "BLOCKING");
  const hasWarning = warnings.length > 0 || ruleResults.some((r) => r.status === "WARNING");
  const conflictLevel = hasBlocking ? "BLOCKING" : hasWarning ? "WARNING" : "NONE";
  return {
    isValid: conflictLevel !== "BLOCKING",
    calculatedDays,
    conflictLevel,
    ruleResults,
    blockingConflicts,
    warnings,
    overlaps,
    balance,
    rotativos,
  };
}

/** Mensajes de advertencia (para "Aprobar igual" y su registro). */
export function warningMessages(v: ValidationResult): string[] {
  const fromRules = v.ruleResults.filter((r) => r.status === "WARNING").map((r) => r.message);
  const fromConflicts = v.warnings.map((w) => w.message);
  return [...new Set([...fromRules, ...fromConflicts])];
}
