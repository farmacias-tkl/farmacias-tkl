// =============================================================================
// Banco de horas: cuentas. Lógica pura (sin Prisma), usable en cliente y servidor.
//
// El banco se lleva en horas, con hasta dos decimales (15 minutos = 0,25).
// El saldo es la suma de los movimientos y puede quedar en negativo.
// =============================================================================

import { eachDay } from "@/lib/personal/dates";
import { scheduleAt, slotsOn, type Schedule } from "@/lib/personal/schedule";

export interface DayWindow {
  startMinute: number;
  endMinute: number;
}

/** Redondeo a centésimas de hora, sin los errores de coma flotante. */
export function roundHours(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Decimal de Prisma, string o número → número de horas. */
export function toHours(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? roundHours(n) : 0;
}

/** Saldo = suma de los movimientos (hours con signo). */
export function sumHours(movements: Array<{ hours: unknown }>): number {
  return roundHours(movements.reduce((acc, m) => acc + toHours(m.hours), 0));
}

/** "7,5 h" · "-3 h" · "0 h". */
export function fmtHours(h: number): string {
  const n = roundHours(h);
  return `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })} h`;
}

/** Problema de la franja, o null si está bien. Los dos null = día completo. */
export function windowError(startMinute: number | null | undefined, endMinute: number | null | undefined): string | null {
  const hasStart = startMinute !== null && startMinute !== undefined;
  const hasEnd = endMinute !== null && endMinute !== undefined;
  if (!hasStart && !hasEnd) return null;
  if (hasStart !== hasEnd) return "La franja necesita hora de inicio y de fin.";
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) return "Hora de la franja inválida.";
  if (startMinute! < 0 || endMinute! > 24 * 60) return "La franja tiene que estar dentro del día.";
  if (startMinute! >= endMinute!) return "La franja tiene que terminar después de empezar.";
  return null;
}

/**
 * Horas del turno de la persona en [start, end] según su horario (vigencia y
 * semanas A/B), recortadas a la franja si la hay. Es lo que descuenta un
 * pedido por defecto.
 *
 * null = no hay horario vigente en ninguna de esas fechas (no se puede
 * calcular: hay que escribir las horas a mano). 0 = tiene horario y no trabaja.
 */
export function scheduleHours(schedules: Schedule[], start: Date, end: Date, window?: DayWindow | null): number | null {
  let minutes = 0;
  let anySchedule = false;
  for (const day of eachDay(start, end)) {
    const sch = scheduleAt(schedules, day);
    if (!sch) continue;
    anySchedule = true;
    for (const s of slotsOn(sch, day)) {
      const from = window ? Math.max(s.startMinute, window.startMinute) : s.startMinute;
      const to = window ? Math.min(s.endMinute, window.endMinute) : s.endMinute;
      if (to > from) minutes += to - from;
    }
  }
  return anySchedule ? roundHours(minutes / 60) : null;
}

/** Dos pedidos de la misma persona se pisan: mismas fechas y, si los dos son franja, franjas superpuestas. */
export function requestsOverlap(
  a: { startDate: Date; endDate: Date; startMinute: number | null; endMinute: number | null },
  b: { startDate: Date; endDate: Date; startMinute: number | null; endMinute: number | null },
): boolean {
  if (a.startDate.getTime() > b.endDate.getTime() || b.startDate.getTime() > a.endDate.getTime()) return false;
  const aw = a.startMinute !== null && a.endMinute !== null;
  const bw = b.startMinute !== null && b.endMinute !== null;
  if (!aw || !bw) return true;
  return a.startMinute! < b.endMinute! && b.startMinute! < a.endMinute!;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  INITIAL: "Saldo inicial",
  OVERTIME: "Horas extra al banco",
  COMPENSATION: "Compensación",
  TAKEN: "Día o franja tomada",
  TAKEN_REVERSAL: "Pedido cancelado: vuelven las horas",
  ADJUST: "Ajuste",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pedido",
  APPROVED: "Autorizado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};
