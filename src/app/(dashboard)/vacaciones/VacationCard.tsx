"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Clock, AlertTriangle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";

export const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  PENDING_SUPERVISOR: { label: "Pend. supervisor", color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: Clock },
  PENDING_RRHH:       { label: "Pend. RRHH",       color: "bg-blue-50 text-blue-800 border-blue-200",       icon: Clock },
  APPROVED:           { label: "Aprobada",          color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  REJECTED:           { label: "Rechazada",         color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  CANCELLED:          { label: "Cancelada",         color: "bg-gray-50 text-gray-600 border-gray-200",      icon: Ban },
};

const CONFLICT_META: Record<string, { label: string; color: string }> = {
  WARNING:  { label: "Aviso",     color: "bg-amber-50 text-amber-700 border-amber-200" },
  BLOCKING: { label: "Conflicto", color: "bg-red-50 text-red-700 border-red-200" },
};

interface Props {
  vacation: any;
  role: UserRole | undefined;
  userId: string | undefined;
  onChange: () => void;
}

function fmt(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });
}

export default function VacationCard({ vacation: v, role, userId, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta   = STATUS_META[v.status] ?? STATUS_META.PENDING_SUPERVISOR;
  const SI     = meta.icon;
  const cmeta  = v.conflictLevel && v.conflictLevel !== "NONE" ? CONFLICT_META[v.conflictLevel] : null;

  const canSupervisorAct = role ? can.approveVacation(role) : false;
  const canRrhhAct       = role ? can.confirmVacation(role) : false;
  const canCancel        = role ? can.cancelVacation(role) : false;
  const canCancelApproved =
    role === "SUPERVISOR" || role === "HR" || role === "ADMIN" || role === "OWNER";
  const isOwner          = !!userId && v.requestedByUserId === userId;
  const showCancel =
    v.status === "CANCELLED" ? false
    : v.status === "APPROVED" ? canCancelApproved
    : (canCancel || isOwner);

  const call = async (path: string, body?: any) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/vacations/${v.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const promptReject = (kind: "supervisor-reject" | "rrhh-reject") => {
    const note = window.prompt("Motivo del rechazo (obligatorio):");
    if (!note || !note.trim()) return;
    call(kind, { note: note.trim() });
  };

  const promptCancel = () => {
    const required = v.status === "APPROVED";
    const note = window.prompt(
      required
        ? "La solicitud ya está aprobada. Motivo OBLIGATORIO para cancelarla:"
        : "Motivo de cancelación (opcional):",
    );
    if (required && (!note || !note.trim())) return;
    call("cancel", note?.trim() ? { note: note.trim() } : {});
  };

  return (
    <div className={cn("card overflow-hidden",
      v.conflictLevel === "BLOCKING" && "border-red-200",
      v.conflictLevel === "WARNING"  && "border-amber-200")}>
      <div className="px-4 py-3 cursor-pointer flex items-start gap-3" onClick={() => setExpanded(x => !x)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{v.employeeNameSnapshot}</p>
            <span className="text-xs text-gray-500">{v.positionNameSnapshot}</span>
            {cmeta && (
              <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border", cmeta.color)}>
                <AlertTriangle className="w-2.5 h-2.5" />{cmeta.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-gray-500">
            <span>{fmt(v.startDate)} → {fmt(v.endDate)} ({v.daysCount}d)</span>
            <span>·</span><span>{v.branchNameSnapshot}</span>
            <span>·</span><span>Solicitó: {v.requestedBy?.name ?? "—"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
            <SI className="w-3 h-3" />{meta.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 bg-gray-50/50 space-y-3">
          {/* Notas */}
          {v.requesterNote  && <p className="text-xs text-gray-600"><span className="font-medium text-gray-800">Solicitante:</span> {v.requesterNote}</p>}
          {v.supervisorNote && <p className="text-xs text-gray-600"><span className="font-medium text-gray-800">Supervisor:</span> {v.supervisorNote}</p>}
          {v.rrhhNote       && <p className="text-xs text-gray-600"><span className="font-medium text-gray-800">RRHH:</span> {v.rrhhNote}</p>}

          {/* Actores */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
            {v.supervisorActionBy && <span>Sup: {v.supervisorActionBy.name} ({fmt(v.supervisorActionAt)})</span>}
            {v.rrhhActionBy && <span>RRHH: {v.rrhhActionBy.name} ({fmt(v.rrhhActionAt)})</span>}
          </div>

          {/* Conflictos detallados */}
          {v.conflictReasons?.warnings?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
              <p className="font-medium">Avisos registrados al crear:</p>
              {v.conflictReasons.warnings.map((w: any, i: number) => (
                <p key={i}>• {w.message}</p>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2">
            {v.status === "PENDING_SUPERVISOR" && canSupervisorAct && (
              <>
                <button disabled={busy} onClick={() => call("supervisor-approve")}
                  className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                  Aprobar (supervisor)
                </button>
                <button disabled={busy} onClick={() => promptReject("supervisor-reject")}
                  className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                  Rechazar
                </button>
              </>
            )}
            {v.status === "PENDING_RRHH" && canRrhhAct && (
              <>
                <button disabled={busy} onClick={() => call("rrhh-approve")}
                  className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                  Confirmar (RRHH)
                </button>
                <button disabled={busy} onClick={() => promptReject("rrhh-reject")}
                  className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                  Rechazar
                </button>
              </>
            )}
            {showCancel && (
              <button disabled={busy} onClick={promptCancel}
                className="btn-secondary text-xs py-1.5 px-3">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
