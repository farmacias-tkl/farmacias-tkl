"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addMonths, formatMonthLong, getMonthGrid, isSameDay,
  startOfDay, WEEKDAY_LABELS_SHORT,
} from "@/lib/dates/calendar";
import { STATUS_META } from "./VacationCard";

interface VacationEvent {
  id:                   string;
  employeeNameSnapshot: string;
  branchNameSnapshot:   string;
  positionNameSnapshot: string;
  status:               string;
  conflictLevel:        string;
  startDate:            string;
  endDate:              string;
}

interface Props {
  events:           VacationEvent[];
  /** Mes inicial. Default: hoy. */
  initialDate?:     Date;
  onMonthChange?:   (newDate: Date) => void;
  onEventClick:     (eventId: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  PENDING_SUPERVISOR: "bg-yellow-400",
  PENDING_RRHH:       "bg-blue-400",
  APPROVED:           "bg-green-500",
  REJECTED:           "bg-red-400",
  CANCELLED:          "bg-gray-400",
};

const STATUS_CHIP: Record<string, string> = {
  PENDING_SUPERVISOR: "bg-yellow-50 text-yellow-800 border-yellow-200",
  PENDING_RRHH:       "bg-blue-50 text-blue-800 border-blue-200",
  APPROVED:           "bg-green-50 text-green-800 border-green-200",
  REJECTED:           "bg-red-50 text-red-700 border-red-200",
  CANCELLED:          "bg-gray-50 text-gray-500 border-gray-200",
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export default function VacationCalendar({
  events, initialDate, onMonthChange, onEventClick,
}: Props) {
  const [current, setCurrent] = useState<Date>(initialDate ?? new Date());

  const grid = useMemo(
    () => getMonthGrid(current.getFullYear(), current.getMonth()),
    [current],
  );

  // Pre-procesar eventos parseando fechas
  const parsedEvents = useMemo(() => events.map(e => ({
    ...e,
    _start: startOfDay(new Date(e.startDate)),
    _end:   startOfDay(new Date(e.endDate)),
  })), [events]);

  const changeMonth = (delta: number) => {
    const next = addMonths(current, delta);
    setCurrent(next);
    onMonthChange?.(next);
  };
  const goToday = () => {
    const t = new Date();
    setCurrent(t);
    onMonthChange?.(t);
  };

  const today = startOfDay(new Date());

  return (
    <div className="card overflow-hidden">
      {/* Header navegación */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <h3 className="text-sm font-semibold text-gray-900 capitalize">
          {formatMonthLong(current)}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => changeMonth(-1)} className="btn-secondary p-1.5" aria-label="Mes anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={goToday} className="btn-secondary text-xs px-2.5">Hoy</button>
          <button onClick={() => changeMonth(1)} className="btn-secondary p-1.5" aria-label="Mes siguiente">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Encabezado días */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60 text-[10px] uppercase font-medium text-gray-500">
        {WEEKDAY_LABELS_SHORT.map((d) => (
          <div key={d} className="px-1.5 py-1.5 text-center">{d}</div>
        ))}
      </div>

      {/* Grid de días */}
      <div className="grid grid-cols-7">
        {grid.flat().map((day, idx) => {
          const inMonth = day.getMonth() === current.getMonth();
          const isToday = isSameDay(day, today);
          const dayEvents = parsedEvents.filter(e =>
            day.getTime() >= e._start.getTime() && day.getTime() <= e._end.getTime()
          );
          // Cobertura: cuántos APPROVED + pendientes activos
          const coverage = dayEvents.filter(e =>
            e.status === "APPROVED" || e.status === "PENDING_SUPERVISOR" || e.status === "PENDING_RRHH"
          ).length;
          const hasBlocking = dayEvents.some(e => e.conflictLevel === "BLOCKING");

          // En desktop mostramos hasta 2 chips por celda, en mobile reducimos a dots.
          const maxChipsDesktop = 2;

          return (
            <div
              key={idx}
              className={cn(
                "min-h-[58px] sm:min-h-[110px] border-r border-b border-gray-100 p-1 sm:p-1.5 relative",
                !inMonth && "bg-gray-50/60",
                idx % 7 === 6 && "border-r-0",
              )}
            >
              {/* Número del día + indicadores */}
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  "text-[11px] sm:text-xs font-medium",
                  inMonth ? "text-gray-800" : "text-gray-400",
                  isToday && "inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white",
                )}>
                  {day.getDate()}
                </span>
                <div className="flex items-center gap-1">
                  {hasBlocking && (
                    <AlertTriangle className="w-3 h-3 text-red-500" aria-label="Conflicto bloqueante" />
                  )}
                  {coverage > 0 && (
                    <span className="text-[9px] font-semibold text-gray-500 bg-gray-100 rounded px-1 py-px hidden sm:inline">
                      {coverage}
                    </span>
                  )}
                </div>
              </div>

              {/* Eventos: chips en desktop, dots en mobile */}
              <div className="space-y-0.5">
                {/* Mobile: dots agrupados */}
                <div className="flex sm:hidden flex-wrap gap-0.5">
                  {dayEvents.slice(0, 6).map(e => (
                    <button
                      key={e.id}
                      onClick={() => onEventClick(e.id)}
                      className={cn("w-2 h-2 rounded-full", STATUS_DOT[e.status] ?? "bg-gray-400")}
                      aria-label={`${e.employeeNameSnapshot} — abrir detalle`}
                    />
                  ))}
                  {dayEvents.length > 6 && (
                    <span className="text-[9px] text-gray-500">+{dayEvents.length - 6}</span>
                  )}
                </div>

                {/* Desktop: chips */}
                <div className="hidden sm:block space-y-0.5">
                  {dayEvents.slice(0, maxChipsDesktop).map(e => (
                    <button
                      key={e.id}
                      onClick={() => onEventClick(e.id)}
                      className={cn(
                        "w-full text-left truncate text-[10px] px-1.5 py-0.5 rounded border leading-tight",
                        STATUS_CHIP[e.status] ?? "bg-gray-50 text-gray-700 border-gray-200",
                        e.conflictLevel === "BLOCKING" && "ring-1 ring-red-300",
                      )}
                      title={`${e.employeeNameSnapshot} — ${e.branchNameSnapshot} — ${e.positionNameSnapshot}`}
                    >
                      <span className="font-semibold mr-1">{initials(e.employeeNameSnapshot)}</span>
                      <span className="opacity-90">{e.employeeNameSnapshot.split(/\s+/)[0]}</span>
                    </button>
                  ))}
                  {dayEvents.length > maxChipsDesktop && (
                    <button
                      onClick={() => onEventClick(dayEvents[maxChipsDesktop].id)}
                      className="w-full text-left text-[10px] text-gray-500 hover:text-gray-800 px-1.5"
                    >
                      +{dayEvents.length - maxChipsDesktop} más
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Leyenda */}
      <div className="px-3 sm:px-4 py-2 border-t border-gray-100 bg-gray-50/60 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-600">
        {Object.entries(STATUS_META).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn("w-2 h-2 rounded-full", STATUS_DOT[k])} />
            {v.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 ml-auto hidden sm:inline-flex">
          <AlertTriangle className="w-3 h-3 text-red-500" />
          Conflicto bloqueante
        </span>
      </div>
    </div>
  );
}
