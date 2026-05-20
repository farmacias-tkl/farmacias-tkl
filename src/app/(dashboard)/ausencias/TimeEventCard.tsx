"use client";
import {
  Clock, LogOut, ChevronRight, CheckCircle2, XCircle, Ban,
  AlertTriangle, ClipboardCheck, Hourglass,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const TIME_EVENT_STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  PENDING_AUTHORIZATION:     { label: "Pend. autorización", color: "bg-amber-50 text-amber-800 border-amber-200",   icon: Hourglass },
  PENDING_REVIEW:            { label: "Pend. revisión",     color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: Clock },
  APPROVED_FOR_COMPENSATION: { label: "A compensar",         color: "bg-blue-50 text-blue-800 border-blue-200",      icon: ClipboardCheck },
  PARTIALLY_COMPENSATED:     { label: "Compensación parcial", color: "bg-indigo-50 text-indigo-800 border-indigo-200", icon: ClipboardCheck },
  COMPENSATED:               { label: "Compensada",          color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  SENT_TO_PAYROLL_DEDUCTION: { label: "A descuento",         color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  WAIVED:                    { label: "Condonada",           color: "bg-gray-50 text-gray-700 border-gray-200",      icon: CheckCircle2 },
  CANCELLED:                 { label: "Cancelada",           color: "bg-gray-50 text-gray-600 border-gray-200",      icon: Ban },
};

interface Props {
  event:   any;
  onClick: () => void;
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });
}

function fmtTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export default function TimeEventCard({ event: e, onClick }: Props) {
  const meta = TIME_EVENT_STATUS_META[e.status] ?? TIME_EVENT_STATUS_META.PENDING_REVIEW;
  const SI = meta.icon;
  const isLate = e.type === "LATE_ARRIVAL";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card w-full text-left hover:border-gray-300 hover:shadow-sm transition-all",
        "px-4 py-3 flex items-start gap-3 group",
      )}
    >
      {/* Avatar inicial */}
      <div className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 text-xs font-semibold flex items-center justify-center">
        {initials(e.employeeNameSnapshot)}
      </div>

      <div className="flex-1 min-w-0">
        {/* Línea 1 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 truncate">{e.employeeNameSnapshot}</p>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-white">
            {isLate
              ? <><Clock  className="w-2.5 h-2.5 text-orange-600" />Llegada tarde</>
              : <><LogOut className="w-2.5 h-2.5 text-violet-600" />Retiro anticipado</>}
          </span>
          <span className="inline-flex items-center text-[10px] font-medium bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
            {e.positionNameSnapshot}
          </span>
          <span className="inline-flex items-center text-[10px] font-medium bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">
            {e.branchNameSnapshot}
          </span>
        </div>

        {/* Línea 2: fecha + horas + minutos */}
        <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 flex-wrap text-xs text-gray-600">
          <span className="font-medium text-gray-800">{fmtDate(e.date)}</span>
          <span className="text-gray-400">·</span>
          <span>esperada {fmtTime(e.expectedTime)} → real {fmtTime(e.actualTime)}</span>
          <span className="font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">
            {e.minutesOwed} min
          </span>
        </div>

        {/* Línea 3: saldo + actores */}
        <div className="flex items-center gap-x-3 gap-y-0.5 mt-1 flex-wrap text-[11px] text-gray-500">
          {e.minutesRemaining > 0 && e.minutesCompensated > 0 && (
            <span className="text-indigo-700">
              {e.minutesCompensated} / {e.minutesOwed} min compensados ({e.minutesRemaining} pendientes)
            </span>
          )}
          {e.minutesRemaining === 0 && e.minutesCompensated > 0 && e.status === "COMPENSATED" && (
            <span className="text-green-700">{e.minutesCompensated} min compensados</span>
          )}
          {e.reportedBy?.name && <span>Cargó: <span className="text-gray-700">{e.reportedBy.name}</span></span>}
          {e.authorizedBy?.name && <span>Autorizó: <span className="text-gray-700">{e.authorizedBy.name}</span></span>}
        </div>
      </div>

      {/* Estado + chevron */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
          <SI className="w-3 h-3" />{meta.label}
        </span>
        {e.status === "PENDING_AUTHORIZATION" && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-700">
            <AlertTriangle className="w-2.5 h-2.5" />Falta autorización
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
    </button>
  );
}
