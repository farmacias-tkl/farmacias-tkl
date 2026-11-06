// =============================================================================
// Helpers de feriados.
//
// API estable que el resto del código consume. La implementación interna usa
// las listas hardcodeadas de AR por año; cuando se agreguen más años,
// importarlos acá y unirlos en HOLIDAYS_BY_DATE.
// =============================================================================

import { AR_HOLIDAYS_2026, type Holiday } from "./ar-2026";
import { AR_HOLIDAYS_2027 } from "./ar-2027";

const ALL_HOLIDAYS: readonly Holiday[] = [
  ...AR_HOLIDAYS_2026,
  ...AR_HOLIDAYS_2027,
];

const HOLIDAYS_BY_DATE = new Map<string, Holiday>(
  ALL_HOLIDAYS.map(h => [h.date, h]),
);

/**
 * Convierte un Date a YYYY-MM-DD con componentes UTC. Mismo criterio que
 * src/lib/personal/dates.ts: una fecha de calendario es 00:00 UTC (así llegan
 * "YYYY-MM-DD" parseados y las columnas @db.Date), sin depender de la hora
 * local del proceso.
 */
function toCalendarISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ¿Es feriado fijo? `d` es una fecha de calendario (00:00 UTC). */
export function isHoliday(d: Date): boolean {
  return HOLIDAYS_BY_DATE.has(toCalendarISODate(d));
}

/** Devuelve el feriado si lo es, null si no. */
export function getHoliday(d: Date): Holiday | null {
  return HOLIDAYS_BY_DATE.get(toCalendarISODate(d)) ?? null;
}

export type { Holiday };
