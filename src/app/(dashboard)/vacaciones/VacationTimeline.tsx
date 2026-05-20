"use client";
import { Plus, CheckCircle2, XCircle, Ban, Clock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoryEntry {
  id:         string;
  fromStatus: string;
  toStatus:   string;
  changedAt:  string | Date;
  note?:      string | null;
  changedBy:  { id: string; name: string } | null;
}

interface Props {
  /** Solicitud completa para mostrar el evento inicial "creada". */
  createdAt:    string | Date;
  createdBy:    { id: string; name: string } | null;
  requesterNote?: string | null;
  /** Historial de transiciones — del más reciente al más viejo, como devuelve el GET. */
  history:      HistoryEntry[];
}

function statusVisual(s: string): { icon: any; color: string; label: string } {
  switch (s) {
    case "PENDING_SUPERVISOR": return { icon: Clock,        color: "text-yellow-600 bg-yellow-50 border-yellow-200", label: "Pend. supervisor" };
    case "PENDING_RRHH":       return { icon: Clock,        color: "text-blue-600 bg-blue-50 border-blue-200",       label: "Pend. RRHH" };
    case "APPROVED":           return { icon: CheckCircle2, color: "text-green-600 bg-green-50 border-green-200",    label: "Aprobada" };
    case "REJECTED":           return { icon: XCircle,      color: "text-red-600 bg-red-50 border-red-200",          label: "Rechazada" };
    case "CANCELLED":          return { icon: Ban,          color: "text-gray-500 bg-gray-50 border-gray-200",       label: "Cancelada" };
    default:                   return { icon: Clock,        color: "text-gray-500 bg-gray-50 border-gray-200",       label: s };
  }
}

function fmt(d: string | Date): string {
  const date = new Date(d);
  return date.toLocaleString("es-AR", {
    day: "numeric", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function VacationTimeline({ createdAt, createdBy, requesterNote, history }: Props) {
  // Orden cronológico ascendente: creación → primera transición → ... → última.
  const ordered = [...history].reverse();

  return (
    <ol className="space-y-3">
      {/* Evento "creada" */}
      <li className="flex gap-3">
        <div className="flex flex-col items-center pt-0.5">
          <div className="w-7 h-7 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
            <Plus className="w-3.5 h-3.5 text-gray-500" />
          </div>
          {ordered.length > 0 && <div className="flex-1 w-px bg-gray-200 mt-1.5" />}
        </div>
        <div className="flex-1 min-w-0 pb-2">
          <p className="text-xs text-gray-900">
            <span className="font-medium">Solicitud creada</span>
            {createdBy?.name && <> por <span className="font-medium">{createdBy.name}</span></>}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">{fmt(createdAt)}</p>
          {requesterNote && (
            <p className="mt-1.5 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 leading-snug">
              {requesterNote}
            </p>
          )}
        </div>
      </li>

      {/* Transiciones */}
      {ordered.map((h, idx) => {
        const v = statusVisual(h.toStatus);
        const Icon = v.icon;
        const isLast = idx === ordered.length - 1;
        return (
          <li key={h.id} className="flex gap-3">
            <div className="flex flex-col items-center pt-0.5">
              <div className={cn("w-7 h-7 rounded-full border flex items-center justify-center shrink-0", v.color)}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              {!isLast && <div className="flex-1 w-px bg-gray-200 mt-1.5" />}
            </div>
            <div className="flex-1 min-w-0 pb-2">
              <p className="text-xs text-gray-900 flex items-center gap-1.5 flex-wrap">
                <span className="font-medium">{statusVisual(h.fromStatus).label}</span>
                <ArrowRight className="w-3 h-3 text-gray-400" />
                <span className="font-medium">{v.label}</span>
                {h.changedBy?.name && (
                  <> · <span className="text-gray-600">{h.changedBy.name}</span></>
                )}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">{fmt(h.changedAt)}</p>
              {h.note && (
                <p className="mt-1.5 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 leading-snug">
                  {h.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
