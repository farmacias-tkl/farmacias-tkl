// =============================================================================
// Validación y reglas de transición para TimeEvent.
//
// State machine:
//
//   POST (LATE_ARRIVAL)    → PENDING_REVIEW
//   POST (EARLY_DEPARTURE) → PENDING_AUTHORIZATION
//
//   PENDING_AUTHORIZATION  → PENDING_REVIEW           (authorize)
//                          → CANCELLED                (cancel)
//
//   PENDING_REVIEW         → APPROVED_FOR_COMPENSATION (resolve-compensation)
//                          → SENT_TO_PAYROLL_DEDUCTION (resolve-payroll)
//                          → WAIVED                    (resolve-waive)
//                          → CANCELLED                 (cancel)
//
//   APPROVED_FOR_COMPENSATION → PARTIALLY_COMPENSATED  (compensation < owed)
//                             → COMPENSATED             (compensation == owed)
//                             → SENT_TO_PAYROLL_DEDUCTION (resolve-payroll)  ← permitido
//                             → CANCELLED               (cancel)
//
//   PARTIALLY_COMPENSATED  → PARTIALLY_COMPENSATED      (más compensaciones)
//                          → COMPENSATED                (suma >= owed)
//                          → CANCELLED                  (cancel)
//                          (NO SENT_TO_PAYROLL_DEDUCTION — restricción del spec)
//                          (NO WAIVED — coherente: ya se empezó a compensar)
//
//   COMPENSATED / SENT_TO_PAYROLL_DEDUCTION / WAIVED / CANCELLED → terminales
//
// PAYROLL DEDUCTION restringido a PENDING_REVIEW y APPROVED_FOR_COMPENSATION
// para evitar mezclar parte compensada con parte descontada.
// =============================================================================

import type { TimeEventStatus, TimeEventType } from "@prisma/client";

/** Diferencia en minutos entre dos timestamps, redondeada al entero. */
export function calculateMinutesDelta(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 60_000);
}

/** Para LATE_ARRIVAL: actualTime > expectedTime. Para EARLY_DEPARTURE: actualTime < expectedTime. */
export function calculateMinutesOwed(
  type: TimeEventType,
  expectedTime: Date,
  actualTime:   Date,
): number {
  if (type === "LATE_ARRIVAL") {
    return Math.max(0, Math.round((actualTime.getTime() - expectedTime.getTime()) / 60_000));
  }
  // EARLY_DEPARTURE
  return Math.max(0, Math.round((expectedTime.getTime() - actualTime.getTime()) / 60_000));
}

/** Validación de coherencia de los tiempos para el tipo. */
export function validateTimes(
  type: TimeEventType,
  expectedTime: Date,
  actualTime:   Date,
): { valid: true } | { valid: false; error: string } {
  if (!(expectedTime instanceof Date) || isNaN(expectedTime.getTime())) {
    return { valid: false, error: "expectedTime inválido" };
  }
  if (!(actualTime instanceof Date) || isNaN(actualTime.getTime())) {
    return { valid: false, error: "actualTime inválido" };
  }
  if (type === "LATE_ARRIVAL" && actualTime <= expectedTime) {
    return { valid: false, error: "La hora real de llegada debe ser posterior a la hora esperada" };
  }
  if (type === "EARLY_DEPARTURE" && actualTime >= expectedTime) {
    return { valid: false, error: "La hora real de retiro debe ser anterior a la hora esperada" };
  }
  return { valid: true };
}

/** Estado inicial al crear según tipo. */
export function initialStatus(type: TimeEventType): TimeEventStatus {
  return type === "EARLY_DEPARTURE" ? "PENDING_AUTHORIZATION" : "PENDING_REVIEW";
}

/** ¿La transición es válida según la state machine? */
export function canTransition(
  from: TimeEventStatus,
  to:   TimeEventStatus,
): boolean {
  const allowed: Record<TimeEventStatus, TimeEventStatus[]> = {
    PENDING_AUTHORIZATION: ["PENDING_REVIEW", "CANCELLED"],
    PENDING_REVIEW: [
      "APPROVED_FOR_COMPENSATION",
      "SENT_TO_PAYROLL_DEDUCTION",
      "WAIVED",
      "CANCELLED",
    ],
    APPROVED_FOR_COMPENSATION: [
      "PARTIALLY_COMPENSATED",
      "COMPENSATED",
      "SENT_TO_PAYROLL_DEDUCTION",
      "CANCELLED",
    ],
    PARTIALLY_COMPENSATED: ["PARTIALLY_COMPENSATED", "COMPENSATED", "CANCELLED"],
    COMPENSATED: [],
    SENT_TO_PAYROLL_DEDUCTION: [],
    WAIVED: [],
    CANCELLED: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

/**
 * Después de cargar una compensación, determinar el siguiente status
 * basado en el saldo restante.
 */
export function statusAfterCompensation(
  newTotalCompensated: number,
  minutesOwed:         number,
): TimeEventStatus {
  return newTotalCompensated >= minutesOwed
    ? "COMPENSATED"
    : "PARTIALLY_COMPENSATED";
}

/** ¿Se pueden cargar compensaciones en este estado? */
export function canAcceptCompensation(status: TimeEventStatus): boolean {
  return status === "APPROVED_FOR_COMPENSATION" || status === "PARTIALLY_COMPENSATED";
}

/**
 * minutesRemaining derivado. En estados terminales sin deuda
 * (CANCELLED, WAIVED, COMPENSATED), siempre 0.
 */
export function computeRemaining(
  status: TimeEventStatus,
  owed:   number,
  compensated: number,
): number {
  if (status === "CANCELLED" || status === "WAIVED" || status === "COMPENSATED") {
    return 0;
  }
  return Math.max(0, owed - compensated);
}
