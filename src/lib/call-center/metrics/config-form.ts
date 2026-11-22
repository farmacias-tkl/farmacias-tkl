/**
 * Ayudas del formulario de configuración de las métricas. PURO (lo usa el cliente y el
 * servidor): pasa los horarios entre el texto que escribe la persona y la forma guardada.
 *
 * Un día se escribe como franjas separadas por coma: "08:00-13:00, 16:00-20:30". Vacío =
 * ese día no hay atención.
 */
import { ISO_WEEKDAYS, type IsoWeekday, type TimeRange, type WeekSchedule } from "./config-schema";

export const WEEKDAY_LABELS: Record<IsoWeekday, string> = {
  "1": "Lunes", "2": "Martes", "3": "Miércoles", "4": "Jueves", "5": "Viernes", "6": "Sábado", "7": "Domingo",
};

const RANGE_RE = /^(\d{1,2}):(\d{2})\s*(?:-|–|a)\s*(\d{1,2}):(\d{2})$/i;
const pad = (h: string) => h.padStart(2, "0");

export type ParseDayResult = { ok: true; ranges: TimeRange[] } | { ok: false; error: string };

/**
 * "9:00-13:00, 16:00 a 20:30" → franjas con hora de dos dígitos. Solo revisa la forma del
 * texto; que las horas existan, que cada franja termine después de empezar y que no se
 * superpongan lo valida el esquema (config-schema.ts) al guardar.
 */
export function parseDayRanges(text: string): ParseDayResult {
  const parts = text.split(/[,;]/).map((p) => p.trim()).filter((p) => p.length > 0);
  const ranges: TimeRange[] = [];
  for (const part of parts) {
    const m = RANGE_RE.exec(part);
    if (!m) return { ok: false, error: `No entiendo "${part}". Escribí las franjas como 09:00-19:00.` };
    ranges.push({ from: `${pad(m[1])}:${m[2]}`, to: `${pad(m[3])}:${m[4]}` });
  }
  return { ok: true, ranges };
}

export function formatDayRanges(ranges: readonly TimeRange[]): string {
  return ranges.map((r) => `${r.from}-${r.to}`).join(", ");
}

/** Texto por día de un horario guardado, para cargar el formulario. */
export function scheduleToText(schedule: WeekSchedule): Record<IsoWeekday, string> {
  return Object.fromEntries(ISO_WEEKDAYS.map((d) => [d, formatDayRanges(schedule[d])])) as Record<IsoWeekday, string>;
}

export type ParseScheduleResult =
  | { ok: true; schedule: WeekSchedule }
  | { ok: false; errors: Partial<Record<IsoWeekday, string>> };

/** Texto por día → horario semanal. Devuelve el error de cada día que no se entiende. */
export function textToSchedule(text: Record<IsoWeekday, string>): ParseScheduleResult {
  const schedule = {} as WeekSchedule;
  const errors: Partial<Record<IsoWeekday, string>> = {};
  for (const d of ISO_WEEKDAYS) {
    const r = parseDayRanges(text[d] ?? "");
    if (r.ok) schedule[d] = r.ranges;
    else errors[d] = r.error;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, schedule };
}

/** Horario sin atención ningún día: punto de partida de un formulario vacío. */
export function emptyScheduleText(): Record<IsoWeekday, string> {
  return Object.fromEntries(ISO_WEEKDAYS.map((d) => [d, ""])) as Record<IsoWeekday, string>;
}

/** "YYYY-MM-DD" que además es una fecha de calendario real. */
export function isValidDayISO(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
