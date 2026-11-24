/**
 * Período de consulta de los bloques con filtro de fechas. PURO.
 *
 * Los días son de Buenos Aires, "YYYY-MM-DD", ambos inclusive. Sin parámetros se toman los
 * últimos PERIOD_DEFAULT_DAYS días terminando hoy. Un período mal formado se rechaza con un
 * mensaje: no se corrige en silencio, para que la pantalla no muestre otro rango que el pedido.
 */
export const PERIOD_DEFAULT_DAYS = 7;
/** Tope del rango: las consultas recorren los mensajes de todas las conversaciones del período. */
export const PERIOD_MAX_DAYS = 92;

const DAY_MS = 86_400_000;
const toMs = (dayISO: string) => new Date(`${dayISO}T00:00:00.000Z`).getTime();

/** Fecha real con formato "YYYY-MM-DD" (rechaza 2026-02-30). */
export function isDayISO(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = toMs(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Suma (o resta) días a un día ISO. */
export function addDaysISO(dayISO: string, days: number): string {
  return new Date(toMs(dayISO) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Caché de un informe cuyo período incluye el día de hoy: entran mensajes todo el tiempo. */
export const PERIOD_CACHE_TODAY_MS = 60_000;
/** Caché de un período que terminó antes de hoy: cambia poco (alguna respuesta o cierre tardío). */
export const PERIOD_CACHE_PAST_MS = 5 * 60_000;

/** Cuánto vale la caché de un informe: corta si el período llega a hoy, larga si terminó antes. `today`: día de Buenos Aires. */
export function periodCacheMs(to: string, today: string): number {
  return to >= today ? PERIOD_CACHE_TODAY_MS : PERIOD_CACHE_PAST_MS;
}

/** Cantidad de días del rango, contando los dos extremos. */
export function periodLength(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

export type PeriodResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string };

/** Resuelve el período pedido. `today` es el día de Buenos Aires. */
export function resolvePeriod(input: { from?: string | null; to?: string | null }, today: string): PeriodResult {
  const hasFrom = input.from != null && input.from !== "";
  const hasTo = input.to != null && input.to !== "";
  if (hasFrom && !isDayISO(input.from)) return { ok: false, error: "La fecha desde no es válida." };
  if (hasTo && !isDayISO(input.to)) return { ok: false, error: "La fecha hasta no es válida." };

  const to = hasTo ? (input.to as string) : today;
  const from = hasFrom ? (input.from as string) : addDaysISO(to, -(PERIOD_DEFAULT_DAYS - 1));
  if (to > today) return { ok: false, error: "La fecha hasta no puede ser posterior a hoy." };
  if (from > to) return { ok: false, error: "La fecha desde no puede ser posterior a la fecha hasta." };
  if (periodLength(from, to) > PERIOD_MAX_DAYS) return { ok: false, error: `El período no puede superar los ${PERIOD_MAX_DAYS} días.` };
  return { ok: true, from, to };
}
