// =============================================================================
// "Hoy" en el servidor: la fecha de calendario de Argentina.
//
// El servidor corre en UTC, así que new Date() + setHours() da "mañana" entre
// las 21 y las 24 h de Argentina. Las fechas de solo día se guardan a las
// 00:00 UTC (las coberturas terminan a las 23:59:59.999 UTC), así que hoy se
// expresa igual: el día de Argentina a las 00:00 UTC.
// =============================================================================

import { endOfUtcDay } from "@/lib/personal/dates";

export const TZ_AR = "America/Argentina/Buenos_Aires";

export function arParts(instant: Date): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ_AR, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second };
}

/** Hoy (fecha de calendario en Argentina) como 00:00 UTC. */
export function todayAR(now: Date = new Date()): Date {
  const p = arParts(now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

/** Hoy como rango, para filtrar: startDate <= todayEnd y endDate >= today. */
export function todayRangeAR(now: Date = new Date()): { today: Date; todayEnd: Date } {
  const today = todayAR(now);
  return { today, todayEnd: endOfUtcDay(today) };
}
