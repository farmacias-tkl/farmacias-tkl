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

/** Feriado de un día "YYYY-MM-DD". Sin datos de ese año: null, sin error. */
export function getHolidayByISO(iso: string): Holiday | null {
  return HOLIDAYS_BY_DATE.get(iso) ?? null;
}

const SHORT_NAMES: Record<string, string> = {
  "Año Nuevo": "Año Nuevo",
  "Carnaval": "Carnaval",
  "Día no laborable con fines turísticos": "Puente turístico",
  "Día Nacional de la Memoria por la Verdad y la Justicia": "Memoria",
  "Día del Veterano y de los Caídos en la Guerra de Malvinas": "Malvinas",
  "Viernes Santo": "Viernes Santo",
  "Día del Trabajador": "Trabajador",
  "Día de la Revolución de Mayo": "25 de Mayo",
  "Paso a la Inmortalidad del Gral. Martín Miguel de Güemes": "Güemes",
  "Paso a la Inmortalidad del Gral. Manuel Belgrano": "Belgrano",
  "Día de la Independencia": "Independencia",
  "Paso a la Inmortalidad del Gral. José de San Martín": "San Martín",
  "Día del Respeto a la Diversidad Cultural": "Diversidad Cultural",
  "Día de la Soberanía Nacional": "Soberanía",
  "Día de la Inmaculada Concepción de María": "Inmaculada",
  "Navidad": "Navidad",
};

/** Nombre corto para la celda del calendario. */
export function holidayShortName(h: Holiday): string {
  return SHORT_NAMES[h.name] ?? h.name;
}

/** Nombre completo, aclarando si la fecha todavía no está confirmada. */
export function holidayFullName(h: Holiday): string {
  return h.unconfirmed ? `${h.name} (fecha a confirmar)` : h.name;
}

export type { Holiday };
