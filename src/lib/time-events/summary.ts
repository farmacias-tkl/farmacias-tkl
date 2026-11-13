// =============================================================================
// Asistencia: total por persona, reparto de una compensación y horas de una
// ausencia. Lógica pura (sin Prisma), usable en cliente y servidor.
// =============================================================================

import { eachDay, toISODate } from "@/lib/personal/dates";
import { scheduleAt, slotsOn, type Schedule } from "@/lib/personal/schedule";

export interface DebtEvent {
  status: string;
  minutesOwed: number;
  minutesCompensated: number;
  minutesRemaining: number;
}

/**
 * Total de una persona, en minutos.
 *
 *   adeudado  = compensado + en revisión + a compensar + enviado a descuento
 *   pendiente = en revisión + a compensar
 *
 * Lo cancelado no cuenta. Lo condonado se informa aparte y no entra en "adeudado".
 */
export interface DebtTotals {
  /** Todo lo que la persona debió, salvo lo cancelado y lo condonado. */
  owed: number;
  /** Lo que ya devolvió trabajando. */
  compensated: number;
  /** Lo que sigue abierto: en revisión + a compensar. */
  pending: number;
  /** Todavía sin resolver (pendiente de autorización o de revisión). */
  inReview: number;
  /** Aprobado para compensar y todavía no compensado. Es lo que resta del banco de horas. */
  toCompensate: number;
  /** Enviado a descuento de sueldo. */
  payroll: number;
  /** Condonado. */
  waived: number;
  /** Cantidad de registros que cuentan (no cancelados). */
  events: number;
}

export function emptyTotals(): DebtTotals {
  return { owed: 0, compensated: 0, pending: 0, inReview: 0, toCompensate: 0, payroll: 0, waived: 0, events: 0 };
}

export function addToTotals(t: DebtTotals, e: DebtEvent): DebtTotals {
  const owed = Math.max(0, e.minutesOwed);
  const comp = Math.max(0, e.minutesCompensated);
  switch (e.status) {
    case "CANCELLED":
      return t;
    case "WAIVED":
      t.waived += Math.max(0, owed - comp);
      t.compensated += comp;
      t.owed += comp;
      break;
    case "PENDING_AUTHORIZATION":
    case "PENDING_REVIEW":
      t.owed += owed;
      t.inReview += owed;
      break;
    case "APPROVED_FOR_COMPENSATION":
    case "PARTIALLY_COMPENSATED":
      // minutesRemaining es el mismo campo que usa el banco de horas.
      t.owed += comp + e.minutesRemaining;
      t.compensated += comp;
      t.toCompensate += e.minutesRemaining;
      break;
    case "COMPENSATED":
      t.owed += comp;
      t.compensated += comp;
      break;
    case "SENT_TO_PAYROLL_DEDUCTION":
      t.owed += owed;
      t.compensated += comp;
      t.payroll += Math.max(0, owed - comp);
      break;
    default:
      return t;
  }
  t.events += 1;
  t.pending = t.inReview + t.toCompensate;
  return t;
}

export function summarize(events: DebtEvent[]): DebtTotals {
  return events.reduce(addToTotals, emptyTotals());
}

/** Agrupa por persona. Orden: mayor pendiente primero; a igual pendiente, mayor adeudado. */
export function summarizeByEmployee<T extends DebtEvent & { employeeId: string }>(events: T[]): Array<{ employeeId: string; totals: DebtTotals }> {
  const map = new Map<string, DebtTotals>();
  for (const e of events) {
    const t = map.get(e.employeeId) ?? emptyTotals();
    map.set(e.employeeId, addToTotals(t, e));
  }
  return [...map.entries()]
    .map(([employeeId, totals]) => ({ employeeId, totals }))
    .filter((r) => r.totals.events > 0)
    .sort((a, b) => b.totals.pending - a.totals.pending || b.totals.owed - a.totals.owed || a.employeeId.localeCompare(b.employeeId));
}

// -----------------------------------------------------------------------------
// Reparto de una compensación entre las deudas de la persona
// -----------------------------------------------------------------------------

export interface OpenDebt {
  id: string;
  date: Date;
  createdAt: Date;
  minutesRemaining: number;
}

/** De la más vieja a la más nueva (por fecha de la deuda; a igual fecha, la que se cargó antes). */
export function oldestFirst<T extends OpenDebt>(debts: T[]): T[] {
  return [...debts].sort((a, b) =>
    a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

export type Allocation =
  | { ok: true; parts: Array<{ id: string; minutes: number }> }
  | { ok: false; max: number; error: string };

/**
 * Reparte `minutes` entre las deudas "a compensar", empezando por la más vieja
 * y partiendo entre varias si hace falta. Si supera el total pendiente no se
 * acepta: se informa el máximo.
 */
export function allocateCompensation(debts: OpenDebt[], minutes: number): Allocation {
  const open = oldestFirst(debts.filter((d) => d.minutesRemaining > 0));
  const max = open.reduce((acc, d) => acc + d.minutesRemaining, 0);
  if (!Number.isInteger(minutes) || minutes <= 0) return { ok: false, max, error: "La compensación tiene que ser de al menos 1 minuto." };
  if (max === 0) return { ok: false, max, error: "Esta persona no tiene deudas aprobadas para compensar." };
  if (minutes > max) return { ok: false, max, error: "La compensación supera lo pendiente a compensar." };
  const parts: Array<{ id: string; minutes: number }> = [];
  let left = minutes;
  for (const d of open) {
    if (left === 0) break;
    const take = Math.min(left, d.minutesRemaining);
    parts.push({ id: d.id, minutes: take });
    left -= take;
  }
  return { ok: true, parts };
}

// -----------------------------------------------------------------------------
// Horas de una ausencia según el horario
// -----------------------------------------------------------------------------

export interface AbsenceDay {
  /** YYYY-MM-DD */
  date: string;
  /** Minutos del turno ese día (suma de los tramos: cuenta el turno partido). null = sin horario vigente ese día. */
  minutes: number | null;
}

/**
 * Minutos del turno de la persona en cada día de la ausencia, según el horario
 * vigente en esa fecha (y la semana A/B si alterna).
 */
export function absenceDays(schedules: Schedule[], start: Date, end: Date): AbsenceDay[] {
  return eachDay(start, end).map((day) => {
    const sch = scheduleAt(schedules, day);
    if (!sch) return { date: toISODate(day), minutes: null };
    const minutes = slotsOn(sch, day).reduce((acc, s) => acc + Math.max(0, s.endMinute - s.startMinute), 0);
    return { date: toISODate(day), minutes };
  });
}

/** Total de la ausencia. null = ningún día tiene horario: hay que escribir las horas a mano. */
export function absenceMinutes(days: AbsenceDay[]): number | null {
  if (days.every((d) => d.minutes === null)) return null;
  return days.reduce((acc, d) => acc + (d.minutes ?? 0), 0);
}

/** Tipos de ausencia que generan deuda aunque no estén marcadas como injustificadas. */
export const DEBT_ABSENCE_TYPES = ["NO_SHOW", "PERSONAL_REASON"] as const;

/** ¿Esta ausencia admite resolver qué se hace con las horas? */
export function absenceCanOweHours(a: { status: string; absenceType: string }): boolean {
  if (a.status === "UNJUSTIFIED") return true;
  if (a.status === "JUSTIFIED") return false;
  return (DEBT_ABSENCE_TYPES as readonly string[]).includes(a.absenceType);
}

export const TIME_EVENT_TYPE_LABEL: Record<string, string> = {
  LATE_ARRIVAL: "Llegada tarde",
  EARLY_DEPARTURE: "Retiro anticipado",
  ABSENCE: "Ausencia",
};
