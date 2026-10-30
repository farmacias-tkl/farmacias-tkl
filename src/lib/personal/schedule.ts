// =============================================================================
// Horario semanal: tramos, semanas A/B, vigencia y horas semanales.
// Lógica pura (sin Prisma). Modelo: WorkSchedule / WorkScheduleSlot.
// =============================================================================

import { diffDays, isoWeekday, mondayOf, utcDay } from "./dates";

export type ScheduleWeekValue = "ALL" | "A" | "B";

export interface ScheduleSlot {
  week: ScheduleWeekValue;
  dayOfWeek: number;   // 1 = lunes … 7 = domingo
  slot: number;        // 1 | 2
  startMinute: number;
  endMinute: number;
  branchId: string | null;
  otherPlace: string | null;
}

export interface Schedule {
  validFrom: Date;
  abReferenceDate: Date | null;
  slots: ScheduleSlot[];
}

/** Tope informativo de horas semanales: se avisa, no se bloquea. */
export const WEEKLY_HOURS_WARNING = 48;

export const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** "8:30" / "08:30" → 510. "24:00" se acepta como fin de día. null si no es hora válida. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function fmtMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function timesOverlap(a: { startMinute: number; endMinute: number }, b: { startMinute: number; endMinute: number }): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** "A" si la semana de `date` está a un número par de semanas de la de referencia. */
export function weekLetter(date: Date, abReferenceDate: Date): "A" | "B" {
  const weeks = Math.round(diffDays(mondayOf(abReferenceDate), mondayOf(date)) / 7);
  return Math.abs(weeks) % 2 === 0 ? "A" : "B";
}

/** Tramos que rigen en una semana dada ("A"/"B"), o en todas si no hay alternancia. */
function slotsForWeek(slots: ScheduleSlot[], week: "A" | "B" | null): ScheduleSlot[] {
  return slots.filter((s) => s.week === "ALL" || (week !== null && s.week === week));
}

export function hasAlternation(slots: ScheduleSlot[]): boolean {
  return slots.some((s) => s.week !== "ALL");
}

/** Tramos efectivos en una fecha concreta. */
export function slotsOn(schedule: Schedule, date: Date): ScheduleSlot[] {
  const day = isoWeekday(date);
  const letter = schedule.abReferenceDate ? weekLetter(date, schedule.abReferenceDate) : null;
  return slotsForWeek(schedule.slots, letter).filter((s) => s.dayOfWeek === day);
}

/** Horario vigente en una fecha: el de validFrom más reciente que no la supere. */
export function scheduleAt<T extends { validFrom: Date }>(schedules: T[], date: Date): T | null {
  const t = utcDay(date).getTime();
  let best: T | null = null;
  for (const s of schedules) {
    if (utcDay(s.validFrom).getTime() <= t && (!best || s.validFrom > best.validFrom)) best = s;
  }
  return best;
}

/** Horas semanales. Con semanas A/B devuelve las dos; sin alternancia, A = B. */
export function weeklyHours(slots: ScheduleSlot[]): { A: number; B: number; alternating: boolean } {
  const sum = (ss: ScheduleSlot[]) => ss.reduce((acc, s) => acc + (s.endMinute - s.startMinute), 0) / 60;
  return { A: sum(slotsForWeek(slots, "A")), B: sum(slotsForWeek(slots, "B")), alternating: hasAlternation(slots) };
}

/** Aviso (no bloqueo) si alguna semana supera WEEKLY_HOURS_WARNING. */
export function weeklyHoursWarning(slots: ScheduleSlot[]): string | null {
  const h = weeklyHours(slots);
  const max = Math.max(h.A, h.B);
  if (max <= WEEKLY_HOURS_WARNING) return null;
  return h.alternating && h.A !== h.B
    ? `Horas semanales: semana A ${h.A} h, semana B ${h.B} h (más de ${WEEKLY_HOURS_WARNING}).`
    : `Horas semanales: ${max} h (más de ${WEEKLY_HOURS_WARNING}).`;
}

/**
 * Errores de forma de un horario. Lista vacía = válido.
 * - día 1..7, tramo 1|2, entrada < salida;
 * - cada tramo en una sucursal o en otro lugar, no ambos;
 * - sin tramos repetidos (semana + día + tramo);
 * - semanas A/B solo con fecha de referencia;
 * - por día, como mucho 2 tramos efectivos y sin superposición (para cada semana).
 */
export function validateSchedule(schedule: Pick<Schedule, "abReferenceDate" | "slots">): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of schedule.slots) {
    const where = `${DAY_NAMES[s.dayOfWeek] ?? `día ${s.dayOfWeek}`} tramo ${s.slot}${s.week !== "ALL" ? ` (semana ${s.week})` : ""}`;
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > 7) errors.push(`Día inválido: ${s.dayOfWeek} (1 a 7).`);
    if (s.slot !== 1 && s.slot !== 2) errors.push(`${where}: el tramo tiene que ser 1 o 2.`);
    if (!(s.startMinute < s.endMinute)) errors.push(`${where}: la entrada (${fmtMinutes(s.startMinute)}) tiene que ser anterior a la salida (${fmtMinutes(s.endMinute)}).`);
    if (s.branchId && s.otherPlace) errors.push(`${where}: va en una sucursal o en otro lugar, no en los dos.`);
    const key = `${s.week}|${s.dayOfWeek}|${s.slot}`;
    if (seen.has(key)) errors.push(`${where}: tramo duplicado.`);
    seen.add(key);
  }
  const alternating = hasAlternation(schedule.slots);
  if (alternating && !schedule.abReferenceDate) errors.push("Hay tramos de semana A/B sin fecha de referencia.");

  for (const week of alternating ? (["A", "B"] as const) : ([null] as const)) {
    for (let day = 1; day <= 7; day++) {
      const ss = slotsForWeek(schedule.slots, week).filter((s) => s.dayOfWeek === day);
      const label = `${DAY_NAMES[day]}${week ? ` (semana ${week})` : ""}`;
      if (ss.length > 2) errors.push(`${label}: más de 2 tramos.`);
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          if (timesOverlap(ss[i], ss[j])) {
            errors.push(`${label}: tramos superpuestos (${fmtMinutes(ss[i].startMinute)}–${fmtMinutes(ss[i].endMinute)} y ${fmtMinutes(ss[j].startMinute)}–${fmtMinutes(ss[j].endMinute)}).`);
          }
        }
      }
    }
  }
  return errors;
}
