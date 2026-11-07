"use client";
import { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronRight as Go } from "lucide-react";
import { addDays, isSameDay, startOfDay } from "@/lib/dates/calendar";
import { getHolidayByISO, holidayFullName } from "@/lib/holidays";
import { buildAgendaWeek, weekRange, type AgendaEvent } from "@/lib/vacations/agenda";
import { cn } from "@/lib/utils";
import { STATUS_META } from "./VacationCard";

interface Event extends AgendaEvent {
  positionNameSnapshot?: string;
  branchNameSnapshot?: string;
}

interface Props {
  events: Event[];
  /** Cualquier día de la semana visible. */
  date: Date;
  loading: boolean;
  onDateChange: (d: Date) => void;
  onEventClick: (id: string) => void;
  /** Abre el panel del día, el mismo del calendario. */
  onDayClick: (iso: string) => void;
}

const fmtDay = (d: Date) => d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short" });
const fmtShort = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });

/** Vista de celular: lista de los días de una semana con las personas de cada día. */
export default function VacationAgenda({ events, date, loading, onDateChange, onEventClick, onDayClick }: Props) {
  const week = useMemo(() => buildAgendaWeek(events, date), [events, date]);
  const { from, to } = weekRange(date);
  const today = startOfDay(new Date());

  return (
    <div className="space-y-2">
      <div className="card flex items-center justify-between gap-2 px-3 py-2">
        <button onClick={() => onDateChange(addDays(date, -7))} className="btn-secondary justify-center p-1.5" aria-label="Semana anterior">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button onClick={() => onDateChange(new Date())} className="flex-1 text-center text-sm font-semibold text-gray-900">
          {fmtShort(from)} – {fmtShort(to)}
        </button>
        <button onClick={() => onDateChange(addDays(date, 7))} className="btn-secondary justify-center p-1.5" aria-label="Semana siguiente">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {loading && <p className="text-center text-sm text-gray-400">Cargando...</p>}

      {week.map((d) => {
        const holiday = getHolidayByISO(d.iso);
        const isToday = isSameDay(d.date, today);
        return (
          <section key={d.iso} className={cn("card overflow-hidden", holiday && "border-violet-200")} aria-label={fmtDay(d.date)}>
            <button type="button" onClick={() => onDayClick(d.iso)}
              className={cn("flex w-full items-center gap-2 px-4 py-2 text-left", holiday ? "bg-violet-50" : "bg-gray-50")}>
              <span className={cn("flex-1 text-sm font-semibold capitalize", isToday ? "text-blue-700" : "text-gray-900")}>
                {fmtDay(d.date)}{isToday && " · hoy"}
              </span>
              <span className="text-sm text-gray-500">{d.events.length}</span>
              <Go className="w-4 h-4 text-gray-400" />
            </button>
            {holiday && <p className="px-4 pb-2 pt-1 text-sm text-violet-700">{holidayFullName(holiday)}</p>}
            {d.events.length === 0 ? (
              <p className="px-4 py-2 text-sm text-gray-400">Sin solicitudes</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {d.events.map((e) => {
                  const meta = STATUS_META[e.status] ?? STATUS_META.PENDING_SUPERVISOR;
                  return (
                    <li key={e.id}>
                      <button type="button" onClick={() => onEventClick(e.id)} className="w-full px-4 py-2 text-left">
                        <span className="block break-words text-sm font-medium text-gray-900">{e.employeeNameSnapshot}</span>
                        <span className="block break-words text-sm text-gray-500">
                          {[e.positionNameSnapshot, e.branchNameSnapshot].filter(Boolean).join(" · ")}
                        </span>
                        <span className={cn("mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", meta.color)}>
                          {meta.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
