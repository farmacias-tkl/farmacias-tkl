// =============================================================================
// Vista "Agenda" del calendario de vacaciones: los 7 días de una semana (lunes a
// domingo) con las personas de cada día. Fechas de solo día, en hora local, como
// el resto del calendario.
// =============================================================================

import { addDays, mondayBasedDay, parseCalendarDate, startOfDay, toLocalISODate } from "@/lib/dates/calendar";

export interface AgendaEvent {
  id: string;
  employeeNameSnapshot: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface AgendaDay<E extends AgendaEvent = AgendaEvent> {
  iso: string;
  date: Date;
  events: E[];
}

/** Lunes y domingo de la semana de una fecha. */
export function weekRange(date: Date): { from: Date; to: Date } {
  const from = addDays(startOfDay(date), -mondayBasedDay(date));
  return { from, to: addDays(from, 6) };
}

/** Los 7 días de la semana de `date`, cada uno con sus solicitudes, por nombre. */
export function buildAgendaWeek<E extends AgendaEvent>(events: E[], date: Date): AgendaDay<E>[] {
  const { from } = weekRange(date);
  const parsed = events.map((e) => ({
    e, start: parseCalendarDate(e.startDate).getTime(), end: parseCalendarDate(e.endDate).getTime(),
  }));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(from, i);
    const t = day.getTime();
    return {
      iso: toLocalISODate(day),
      date: day,
      events: parsed
        .filter((p) => t >= p.start && t <= p.end)
        .map((p) => p.e)
        .sort((a, b) => a.employeeNameSnapshot.localeCompare(b.employeeNameSnapshot, "es")),
    };
  });
}
