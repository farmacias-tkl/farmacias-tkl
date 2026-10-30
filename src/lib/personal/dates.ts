// =============================================================================
// Fechas "de calendario" para personal y vacaciones.
//
// Criterio único: una fecha de calendario es un Date a las 00:00 UTC (así llegan
// "YYYY-MM-DD" parseados con new Date() y así devuelve Prisma las columnas
// @db.Date). Todo se calcula con getters UTC, nunca con la hora local del
// proceso: así un lunes es lunes tanto en un servidor UTC como en una PC con
// hora de Argentina.
// =============================================================================

const DAY_MS = 86_400_000;

/** Normaliza a 00:00 UTC del mismo día UTC. */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** "YYYY-MM-DD" → Date 00:00 UTC. null si no es una fecha válida. */
export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

export function toISODate(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(utcDay(d).getTime() + n * DAY_MS);
}

/** Días entre dos fechas de calendario (b - a). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((utcDay(b).getTime() - utcDay(a).getTime()) / DAY_MS);
}

/** 1 = lunes … 7 = domingo. */
export function isoWeekday(d: Date): number {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

/** Lunes de la semana (lunes a domingo) que contiene d. */
export function mondayOf(d: Date): Date {
  return addDays(d, 1 - isoWeekday(d));
}

/** Todas las fechas de [start, end], inclusive. */
export function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let d = utcDay(start); d.getTime() <= utcDay(end).getTime(); d = addDays(d, 1)) out.push(d);
  return out;
}

/** Rangos de fechas con fin inclusivo. */
export function dateRangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return utcDay(aStart).getTime() <= utcDay(bEnd).getTime() &&
         utcDay(bStart).getTime() <= utcDay(aEnd).getTime();
}
