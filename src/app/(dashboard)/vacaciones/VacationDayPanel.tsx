"use client";
// Detalle de un día del calendario: panel lateral (en celular, pantalla
// completa) con todas las solicitudes de ese día. No tiene acciones: cada
// tarjeta abre la ficha de la solicitud, que muestra los botones según el rol.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Clock, Loader2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseCalendarDate } from "@/lib/dates/calendar";
import { getHolidayByISO, holidayFullName } from "@/lib/holidays";
import type { DayPerson, DayRequest, VacationDayDetail } from "@/lib/vacations/day-detail";
import { STATUS_META } from "./VacationCard";

interface Props {
  /** Día abierto ("YYYY-MM-DD"); null = cerrado. */
  date:           string | null;
  /** Los mismos filtros del calendario, como query string. */
  filters:        string;
  /** Con la ficha abierta encima, ESC cierra solo la ficha. */
  detailOpen:     boolean;
  onClose:        () => void;
  onOpenRequest:  (id: string) => void;
}

const fmtShort = (iso: string) =>
  parseCalendarDate(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

const fmtTitle = (iso: string) =>
  parseCalendarDate(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function VacationDayPanel({ date, filters, detailOpen, onClose, onOpenRequest }: Props) {
  const open = !!date;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open || detailOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, detailOpen, onClose]);

  const { data, isLoading, isError } = useQuery<{ data: VacationDayDetail }>({
    queryKey: ["vacation-day", date, filters],
    queryFn: async () => {
      const p = new URLSearchParams(filters);
      p.set("date", date!);
      const res = await fetch(`/api/vacations/day?${p}`);
      if (!res.ok) throw new Error("No se pudo cargar el día");
      return res.json();
    },
    enabled: open,
  });

  if (!date) return null;
  const holiday = getHolidayByISO(date);
  const day = data?.data;

  return (
    // !mt-0: el contenedor de la página usa space-y y correría el panel hacia abajo.
    <div className="fixed inset-0 z-40 !mt-0" role="dialog" aria-modal="true" aria-labelledby="day-panel-title">
      <div className="absolute inset-0 bg-black/40 hidden sm:block" onClick={onClose} />
      <aside className="absolute inset-0 sm:left-auto sm:w-[30rem] bg-white shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h3 id="day-panel-title" className="text-sm font-semibold text-gray-900 first-letter:uppercase">
              {fmtTitle(date)}
            </h3>
            {holiday && (
              <p className="text-xs text-violet-700 mt-0.5">Feriado: {holidayFullName(holiday)}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0 -mr-1 -mt-1 p-1" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : isError || !day ? (
            <p className="text-sm text-red-700">No se pudo cargar el día.</p>
          ) : day.people.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              No hay solicitudes este día con los filtros aplicados.
            </p>
          ) : (
            <>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
                {day.summary.length > 0
                  ? day.summary.map((s, i) => (
                      <span key={s.position}>
                        {i > 0 && " · "}
                        <span className="whitespace-nowrap">{s.position}: <b>{s.count}</b></span>
                      </span>
                    ))
                  : "Ninguna solicitud activa este día."}
                {day.total > 1 && <p className="text-[11px] text-gray-500 mt-0.5">{day.total} solicitudes en total.</p>}
              </div>
              {day.people.map((p) => (
                <PersonCard key={p.employeeId} person={p} onOpenRequest={onOpenRequest} />
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function PersonCard({ person: p, onOpenRequest }: {
  person: DayPerson;
  onOpenRequest: (id: string) => void;
}) {
  const positions = [p.position, p.secondaryPosition].filter(Boolean).join(" / ");
  const head = (
    <div className="space-y-1.5">
      <div>
        <p className="text-sm font-semibold text-gray-900">{p.name}</p>
        <p className="text-xs text-gray-500">
          {p.branchName} · {positions}
          {p.isTechnicalDirector && (
            <span className="ml-1 text-[10px] font-semibold px-1 py-px rounded bg-gray-100 text-gray-700">DT</span>
          )}
        </p>
      </div>
      <ScheduleLine person={p} />
    </div>
  );

  // Una solicitud: toda la tarjeta abre la ficha. Varias: abre cada renglón.
  if (p.requests.length === 1) {
    return (
      <button
        type="button"
        onClick={() => onOpenRequest(p.requests[0].id)}
        className="w-full text-left rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50/60 p-3 space-y-2 transition-colors"
      >
        {head}
        <RequestLine r={p.requests[0]} />
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
      {head}
      {p.requests.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpenRequest(r.id)}
          className="w-full text-left rounded-md border border-gray-100 hover:border-gray-300 hover:bg-gray-50/60 p-2 transition-colors"
        >
          <RequestLine r={r} />
        </button>
      ))}
    </div>
  );
}

function ScheduleLine({ person: p }: { person: DayPerson }) {
  const s = p.schedule;
  return (
    <div className="flex items-start gap-1.5 text-xs text-gray-700">
      <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-px" />
      {s.kind === "NO_SCHEDULE" ? (
        <span className="text-gray-400">Sin horario cargado</span>
      ) : s.kind === "OFF" ? (
        <span>No trabaja{s.week ? ` (semana ${s.week})` : ""}</span>
      ) : (
        <span>
          {s.slots.map((x, i) => (
            <span key={i} className="block">{x.start}–{x.end} · {x.place}</span>
          ))}
          {s.week && <span className="block text-[11px] text-gray-400">Semana {s.week}</span>}
        </span>
      )}
    </div>
  );
}

function BalanceLine({ r }: { r: DayRequest }) {
  const b = r.balance;
  if (!b.loaded) return <span className="text-gray-400">Sin saldo cargado</span>;
  if (b.effect === "PENDING") {
    return (
      <span className={cn(b.insufficient && "text-amber-800")}>
        Saldo {b.current} → quedaría en <b>{b.after}</b>
      </span>
    );
  }
  return <span>Saldo actual <b>{b.current}</b>{b.effect === "DISCOUNTED" && " (ya descontada)"}</span>;
}

function RequestLine({ r }: { r: DayRequest }) {
  const meta = STATUS_META[r.status] ?? STATUS_META.PENDING_SUPERVISOR;
  return (
    <div className="space-y-1.5 text-xs text-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", meta.color)}>{meta.label}</span>
          <span>{fmtShort(r.startDate)} – {fmtShort(r.endDate)} ({r.daysCount} d)</span>
        </span>
        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
      </div>
      <p><BalanceLine r={r} /></p>
      {(r.blocking || r.withWarnings || r.withoutCoverage || r.coveredBy.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {r.blocking && (
            <Mark className="bg-red-50 text-red-700 border-red-200" icon={AlertTriangle}>Conflicto</Mark>
          )}
          {r.withWarnings && (
            <Mark className="bg-amber-50 text-amber-800 border-amber-300" icon={AlertTriangle}>Con advertencias</Mark>
          )}
          {r.withoutCoverage && (
            <Mark className="bg-red-50 text-red-700 border-red-200" icon={Users}>Sin cobertura</Mark>
          )}
          {r.coveredBy.length > 0 && (
            <Mark className="bg-gray-50 text-gray-700 border-gray-200" icon={Users}>Cubre: {r.coveredBy.join(", ")}</Mark>
          )}
        </div>
      )}
    </div>
  );
}

function Mark({ className, icon: Icon, children }: { className: string; icon: any; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border", className)}>
      <Icon className="w-3 h-3" />{children}
    </span>
  );
}
