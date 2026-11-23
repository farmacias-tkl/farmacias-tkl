/**
 * Tiempo hábil del Call Center. PURO: sin Prisma, sin red y sin leer el reloj.
 *
 * Los instantes son Date en UTC (así se guardan sentAt, createdAt y changedAt). Los horarios
 * están en hora de Buenos Aires. Argentina no cambia la hora desde 2009 y es UTC−3 fijo: la
 * conversión se hace UNA sola vez, acá, con ese desplazamiento.
 *
 * Reglas de la meta de primera respuesta (decisión de Dirección, 21/11/2026):
 *  - solo cuentan los minutos dentro del horario dado;
 *  - lo que entra fuera de horario empieza a contar cuando abre la atención;
 *  - lo respondido antes de abrir suma 0 minutos; attention.ts lo deja fuera de la meta y lo
 *    informa aparte (decisión del 22/11/2026);
 *  - un feriado nacional no tiene horario: no suma minutos.
 */
import { hhmmToMinutes, type TimeRange, type WeekSchedule, type IsoWeekday } from "./config-schema";
import { configForDay, type ConfigVersion } from "./config";

/** Buenos Aires = UTC−3, sin horario de verano. */
export const AR_UTC_OFFSET_MINUTES = -180;
const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

/** Franja de un día en minutos desde las 00:00 de Buenos Aires: [from, to). */
export interface MinuteRange { from: number; to: number }

/** Franjas hábiles de un día de Buenos Aires ("YYYY-MM-DD"). Lista vacía = sin atención. */
export type DayRanges = (dayISO: string) => readonly MinuteRange[];

/** Desplaza el instante para leer sus componentes de Buenos Aires con los getters UTC. */
function shiftToAR(instant: Date): Date {
  return new Date(instant.getTime() + AR_UTC_OFFSET_MINUTES * MS_MIN);
}

/** Día de Buenos Aires de un instante, "YYYY-MM-DD". */
export function arDayISO(instant: Date): string {
  return shiftToAR(instant).toISOString().slice(0, 10);
}

/** Minutos transcurridos del día de Buenos Aires (0 a 1439). */
export function arMinuteOfDay(instant: Date): number {
  const s = shiftToAR(instant);
  return s.getUTCHours() * 60 + s.getUTCMinutes();
}

/** Hora del día de Buenos Aires (0 a 23), para agrupar por franja horaria. */
export function arHour(instant: Date): number {
  return shiftToAR(instant).getUTCHours();
}

/** Día de la semana ISO de un día de calendario: 1 = lunes … 7 = domingo. */
export function isoWeekdayOf(dayISO: string): IsoWeekday {
  const dow = new Date(`${dayISO}T00:00:00.000Z`).getUTCDay(); // 0 = domingo
  return String(dow === 0 ? 7 : dow) as IsoWeekday;
}

/** Instante UTC de las 00:00 de Buenos Aires de ese día. */
export function arDayStartUTC(dayISO: string): Date {
  return new Date(new Date(`${dayISO}T00:00:00.000Z`).getTime() - AR_UTC_OFFSET_MINUTES * MS_MIN);
}

/**
 * Instante → literal "timestamp" en UTC para una consulta cruda. Las columnas son
 * timestamp SIN zona y guardan UTC; si el parámetro viajara como timestamptz, Postgres lo
 * convertiría con la zona horaria de la sesión y la comparación se correría (en Neon la
 * sesión está en GMT, pero no hay que depender de eso). Usar siempre con ::timestamp.
 */
export function utcTimestampParam(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/** Día siguiente de calendario. */
export function nextDayISO(dayISO: string): string {
  return new Date(new Date(`${dayISO}T00:00:00.000Z`).getTime() + MS_DAY).toISOString().slice(0, 10);
}

export function toMinuteRanges(ranges: readonly TimeRange[]): MinuteRange[] {
  return ranges.map((r) => ({ from: hhmmToMinutes(r.from), to: hhmmToMinutes(r.to) }));
}

/**
 * Franjas por día a partir de las versiones de configuración: usa el horario vigente CADA
 * día (un cambio de horario no recalcula el pasado) y deja sin franjas los feriados.
 * Un día anterior a la primera versión no tiene horario.
 */
export function dayRangesFromConfig(
  versions: readonly ConfigVersion[],
  pick: (data: ConfigVersion["data"]) => WeekSchedule,
  isHolidayISO: (dayISO: string) => boolean,
): DayRanges {
  const cache = new Map<string, readonly MinuteRange[]>();
  return (dayISO) => {
    const hit = cache.get(dayISO);
    if (hit) return hit;
    const version = configForDay(versions, dayISO);
    const ranges = !version || isHolidayISO(dayISO)
      ? []
      : toMinuteRanges(pick(version.data)[isoWeekdayOf(dayISO)]);
    cache.set(dayISO, ranges);
    return ranges;
  };
}

/** ¿El instante cae dentro de alguna franja de su día? */
export function isWithinHours(instant: Date, dayRanges: DayRanges): boolean {
  const minute = arMinuteOfDay(instant);
  return dayRanges(arDayISO(instant)).some((r) => minute >= r.from && minute < r.to);
}

/** Tope de días que se recorren entre dos instantes. Más allá, el resultado se corta. */
export const MAX_DAYS_SPAN = 400;

/**
 * Minutos hábiles entre dos instantes: la parte de [start, end) que cae dentro de las
 * franjas de cada día. Con fracción (no redondea). Si end <= start devuelve 0.
 *
 * Cubre solas las tres reglas: entrar fuera de horario no suma hasta que abre; responder
 * antes de abrir da 0; un día sin franjas (domingo, feriado) no suma.
 */
export function businessMinutesBetween(start: Date, end: Date, dayRanges: DayRanges): number {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!(endMs > startMs)) return 0;

  let total = 0;
  let day = arDayISO(start);
  const lastDay = arDayISO(end);
  for (let i = 0; i <= MAX_DAYS_SPAN; i++) {
    const dayStartMs = arDayStartUTC(day).getTime();
    for (const r of dayRanges(day)) {
      const from = Math.max(startMs, dayStartMs + r.from * MS_MIN);
      const to = Math.min(endMs, dayStartMs + r.to * MS_MIN);
      if (to > from) total += (to - from) / MS_MIN;
    }
    if (day === lastDay) break;
    day = nextDayISO(day);
  }
  return total;
}

/**
 * Instante en que se cumplen `minutes` minutos hábiles contados desde `start`: el
 * vencimiento de una meta. null si no se alcanza dentro de MAX_DAYS_SPAN días (por ejemplo,
 * sin horario configurado).
 */
export function addBusinessMinutes(start: Date, minutes: number, dayRanges: DayRanges): Date | null {
  const startMs = start.getTime();
  let remaining = minutes;
  let day = arDayISO(start);
  for (let i = 0; i <= MAX_DAYS_SPAN; i++) {
    const dayStartMs = arDayStartUTC(day).getTime();
    for (const r of dayRanges(day)) {
      const from = Math.max(startMs, dayStartMs + r.from * MS_MIN);
      const to = dayStartMs + r.to * MS_MIN;
      if (to <= from) continue;
      const available = (to - from) / MS_MIN;
      if (available >= remaining) return new Date(from + remaining * MS_MIN);
      remaining -= available;
    }
    day = nextDayISO(day);
  }
  return null;
}

/** Los cuatro grupos de la meta de primera respuesta. */
export type GoalGroup =
  | "ANSWERED_WITHIN_GOAL"  // respondida dentro de la meta
  | "ANSWERED_LATE"         // respondida fuera de la meta
  | "PENDING_OVERDUE"       // sin respuesta y la meta ya venció
  | "PENDING_WITHIN_GOAL";  // sin respuesta y todavía dentro del plazo

export interface GoalResult {
  group: GoalGroup;
  /** Minutos hábiles hasta la respuesta, o transcurridos hasta `now` si sigue pendiente. */
  businessMinutes: number;
}

/**
 * Clasifica una conversación contra la meta. `start` es desde cuándo corre el reloj (la
 * salida del bot), `answeredAt` la primera respuesta humana (null si no hubo) y `now` el
 * momento del corte. Un pendiente incumple recién cuando vence su plazo, no cuando entra.
 * El cumplimiento se calcula como WITHIN / (WITHIN + LATE + OVERDUE): los pendientes dentro
 * del plazo todavía no entran en el denominador.
 */
export function classifyAgainstGoal(
  start: Date,
  answeredAt: Date | null,
  now: Date,
  goalMinutes: number,
  dayRanges: DayRanges,
): GoalResult {
  if (answeredAt) {
    const businessMinutes = businessMinutesBetween(start, answeredAt, dayRanges);
    return { group: businessMinutes <= goalMinutes ? "ANSWERED_WITHIN_GOAL" : "ANSWERED_LATE", businessMinutes };
  }
  const businessMinutes = businessMinutesBetween(start, now, dayRanges);
  return { group: businessMinutes > goalMinutes ? "PENDING_OVERDUE" : "PENDING_WITHIN_GOAL", businessMinutes };
}
