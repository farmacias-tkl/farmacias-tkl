// =============================================================================
// Helpers de feriados.
//
// API estable que el resto del código consume. La implementación interna usa
// la lista hardcodeada de AR 2026; cuando se agreguen más años, importarlos
// acá y unirlos en HOLIDAYS_BY_DATE.
// =============================================================================

import { AR_HOLIDAYS_2026, type Holiday } from "./ar-2026";

const ALL_HOLIDAYS: readonly Holiday[] = [
  ...AR_HOLIDAYS_2026,
];

const HOLIDAYS_BY_DATE = new Map<string, Holiday>(
  ALL_HOLIDAYS.map(h => [h.date, h]),
);

/** Convierte un Date a YYYY-MM-DD usando componentes locales (no UTC). */
function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ¿Es feriado fijo? Usa fecha local del Date. */
export function isHoliday(d: Date): boolean {
  return HOLIDAYS_BY_DATE.has(toLocalISODate(d));
}

/** Devuelve el feriado si lo es, null si no. */
export function getHoliday(d: Date): Holiday | null {
  return HOLIDAYS_BY_DATE.get(toLocalISODate(d)) ?? null;
}

export type { Holiday };
