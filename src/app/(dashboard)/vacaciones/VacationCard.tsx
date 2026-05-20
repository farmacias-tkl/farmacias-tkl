"use client";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, Ban, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  PENDING_SUPERVISOR: { label: "Pend. supervisor", color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: Clock },
  PENDING_RRHH:       { label: "Pend. RRHH",       color: "bg-blue-50 text-blue-800 border-blue-200",       icon: Clock },
  APPROVED:           { label: "Aprobada",          color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  REJECTED:           { label: "Rechazada",         color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  CANCELLED:          { label: "Cancelada",         color: "bg-gray-50 text-gray-600 border-gray-200",      icon: Ban },
};

interface Props {
  vacation: any;
  onClick:  () => void;
}

function fmt(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function fmtRelative(date: string | Date): string {
  const d = new Date(date);
  const now = Date.now();
  const diff = Math.round((now - d.getTime()) / 60000);
  if (diff < 1) return "recién";
  if (diff < 60) return `hace ${diff} min`;
  const h = Math.round(diff / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `hace ${days} d`;
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

export default function VacationCard({ vacation: v, onClick }: Props) {
  const meta = STATUS_META[v.status] ?? STATUS_META.PENDING_SUPERVISOR;
  const SI   = meta.icon;

  // Última acción que se haya registrado
  const lastActionAt =
    v.rrhhActionAt ?? v.supervisorActionAt ?? v.updatedAt ?? v.createdAt;
  const lastActor =
    v.rrhhActionBy?.name ?? v.supervisorActionBy?.name ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card w-full text-left hover:border-gray-300 hover:shadow-sm transition-all",
        "px-4 py-3 flex items-start gap-3 group",
        v.conflictLevel === "BLOCKING" && "border-red-200",
        v.conflictLevel === "WARNING"  && "border-amber-200",
      )}
    >
      {/* Avatar inicial */}
      <div className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 text-xs font-semibold flex items-center justify-center">
        {initials(v.employeeNameSnapshot)}
      </div>

      <div className="flex-1 min-w-0">
        {/* Línea 1: nombre + badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 truncate">{v.employeeNameSnapshot}</p>
          <span className="inline-flex items-center text-[10px] font-medium bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
            {v.positionNameSnapshot}
          </span>
          <span className="inline-flex items-center text-[10px] font-medium bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">
            {v.branchNameSnapshot}
          </span>
          {v.conflictLevel === "WARNING" && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded"
                  title="Esta solicitud tiene avisos">
              <AlertTriangle className="w-2.5 h-2.5" />
              Aviso
            </span>
          )}
          {v.conflictLevel === "BLOCKING" && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded"
                  title="Esta solicitud tiene conflictos bloqueantes">
              <AlertTriangle className="w-2.5 h-2.5" />
              Conflicto
            </span>
          )}
        </div>

        {/* Línea 2: rango visual */}
        <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-600">
          <span className="font-medium text-gray-800">{fmt(v.startDate)}</span>
          <span className="flex-1 h-0.5 bg-gradient-to-r from-gray-300 to-gray-200 rounded-full max-w-[80px]" />
          <span className="font-medium text-gray-800">{fmt(v.endDate)}</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-500 font-medium">{v.daysCount}d</span>
        </div>

        {/* Línea 3: actores */}
        <div className="flex items-center gap-x-3 gap-y-0.5 mt-1 flex-wrap text-[11px] text-gray-500">
          <span>Solicitó: <span className="text-gray-700">{v.requestedBy?.name ?? "—"}</span></span>
          {lastActor && lastActor !== v.requestedBy?.name && (
            <span>Última acción: <span className="text-gray-700">{lastActor}</span></span>
          )}
          <span>{fmtRelative(lastActionAt)}</span>
        </div>
      </div>

      {/* Estado + chevron */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
          <SI className="w-3 h-3" />{meta.label}
        </span>
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
    </button>
  );
}
