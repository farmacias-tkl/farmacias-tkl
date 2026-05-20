"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Calendar, MapPin, User as UserIcon, Briefcase,
  Loader2, ArrowLeft, CheckCircle2, XCircle, Ban,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";
import VacationTimeline from "./VacationTimeline";
import { STATUS_META } from "./VacationCard";

interface Props {
  open:        boolean;
  vacationId:  string | null;
  role:        UserRole | undefined;
  userId:      string | undefined;
  onClose:     () => void;
  onChanged:   () => void;   // se llama tras cualquier acción exitosa
}

type ActionKind = "supervisor-approve" | "supervisor-reject" | "rrhh-approve" | "rrhh-reject" | "cancel";

interface ActionConfig {
  label:        string;
  endpoint:     ActionKind;
  noteRequired: boolean;
  notePrompt:   string;
  notePlaceholder: string;
  confirmLabel: string;
  variant:      "approve" | "reject" | "cancel";
}

const ACTIONS: Record<ActionKind, ActionConfig> = {
  "supervisor-approve": {
    label: "Aprobar (supervisor)",
    endpoint: "supervisor-approve",
    noteRequired: false,
    notePrompt: "Nota del supervisor (opcional)",
    notePlaceholder: "Comentario o aclaración...",
    confirmLabel: "Aprobar y enviar a RRHH",
    variant: "approve",
  },
  "supervisor-reject": {
    label: "Rechazar",
    endpoint: "supervisor-reject",
    noteRequired: true,
    notePrompt: "Motivo del rechazo (obligatorio)",
    notePlaceholder: "Explicá por qué se rechaza...",
    confirmLabel: "Rechazar solicitud",
    variant: "reject",
  },
  "rrhh-approve": {
    label: "Confirmar (RRHH)",
    endpoint: "rrhh-approve",
    noteRequired: false,
    notePrompt: "Nota de RRHH (opcional)",
    notePlaceholder: "Comentario o aclaración...",
    confirmLabel: "Confirmar aprobación",
    variant: "approve",
  },
  "rrhh-reject": {
    label: "Rechazar",
    endpoint: "rrhh-reject",
    noteRequired: true,
    notePrompt: "Motivo del rechazo (obligatorio)",
    notePlaceholder: "Explicá por qué se rechaza...",
    confirmLabel: "Rechazar solicitud",
    variant: "reject",
  },
  "cancel": {
    label: "Cancelar solicitud",
    endpoint: "cancel",
    noteRequired: false, // se ajusta dinámicamente si está APPROVED
    notePrompt: "Motivo de cancelación (opcional)",
    notePlaceholder: "Aclaración...",
    confirmLabel: "Cancelar solicitud",
    variant: "cancel",
  },
};

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("es-AR", {
    weekday: "short", day: "numeric", month: "short", year: "2-digit",
  });
}

export default function VacationDetailModal({
  open, vacationId, role, userId, onClose, onChanged,
}: Props) {
  const [view, setView]   = useState<"detail" | ActionKind>("detail");
  const [note, setNote]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset interno al cerrar / cambiar de solicitud
  useEffect(() => {
    if (!open) {
      setView("detail"); setNote(""); setError(null); setBusy(false);
    }
  }, [open]);
  useEffect(() => {
    setView("detail"); setNote(""); setError(null);
  }, [vacationId]);

  const { data: detailRes, isLoading, refetch } = useQuery({
    queryKey: ["vacation-detail", vacationId],
    queryFn: async () => {
      if (!vacationId) return null;
      const res = await fetch(`/api/vacations/${vacationId}`);
      if (!res.ok) throw new Error("No se pudo cargar el detalle");
      return res.json();
    },
    enabled: !!vacationId && open,
  });

  const v = detailRes?.data;

  // Permisos
  const canSupervisorAct  = role ? can.approveVacation(role) : false;
  const canRrhhAct        = role ? can.confirmVacation(role) : false;
  const canCancelStd      = role ? can.cancelVacation(role) : false;
  const canCancelApproved = role === "SUPERVISOR" || role === "HR" || role === "ADMIN" || role === "OWNER";
  const isOwner           = !!userId && v?.requestedByUserId === userId;

  // Acciones disponibles según estado
  const availableActions: ActionKind[] = [];
  if (v) {
    if (v.status === "PENDING_SUPERVISOR" && canSupervisorAct) {
      availableActions.push("supervisor-approve", "supervisor-reject");
    }
    if (v.status === "PENDING_RRHH" && canRrhhAct) {
      availableActions.push("rrhh-approve", "rrhh-reject");
    }
    if (v.status !== "CANCELLED") {
      const canDoCancel =
        v.status === "APPROVED" ? canCancelApproved
        : (canCancelStd || isOwner);
      if (canDoCancel) availableActions.push("cancel");
    }
  }

  // Nota obligatoria para cancelación de APPROVED
  const currentAction = view !== "detail" ? ACTIONS[view] : null;
  const effectiveNoteRequired = currentAction
    ? (currentAction.endpoint === "cancel" && v?.status === "APPROVED"
        ? true
        : currentAction.noteRequired)
    : false;

  const startAction = (kind: ActionKind) => {
    setView(kind);
    setNote("");
    setError(null);
  };

  const cancelAction = () => {
    setView("detail");
    setNote("");
    setError(null);
  };

  const submitAction = async () => {
    if (!currentAction || !v) return;
    if (effectiveNoteRequired && !note.trim()) {
      setError("Motivo obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = note.trim() ? { note: note.trim() } : {};
      const res = await fetch(`/api/vacations/${v.id}/${currentAction.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al procesar la acción");
      // Recargar detalle y notificar al padre
      await refetch();
      onChanged();
      setView("detail");
      setNote("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const meta = v ? (STATUS_META[v.status] ?? STATUS_META.PENDING_SUPERVISOR) : null;
  const SI   = meta?.icon;

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      size="xl"
      title={v ? `Solicitud de ${v.employeeNameSnapshot}` : "Cargando..."}
      dismissOnBackdrop={view === "detail"}
    >
      {isLoading || !v ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : view !== "detail" && currentAction ? (
        // ============================================================
        // PASO DE ACCIÓN INLINE (sin abrir un segundo modal)
        // ============================================================
        <div className="space-y-4">
          <button
            type="button"
            onClick={cancelAction}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver al detalle
          </button>

          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 space-y-1">
            <p className="text-xs text-gray-500">Acción:</p>
            <p className="text-sm font-semibold text-gray-900">{currentAction.label}</p>
            <p className="text-xs text-gray-600 mt-2">
              {v.employeeNameSnapshot} · {v.branchNameSnapshot} ·
              {" "}{fmtDate(v.startDate)} → {fmtDate(v.endDate)} ({v.daysCount}d)
            </p>
            {currentAction.endpoint === "cancel" && v.status === "APPROVED" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                ⚠ Esta solicitud ya está APROBADA. La cancelación es excepcional y queda auditada.
              </p>
            )}
          </div>

          <div>
            <label className="label">
              {currentAction.endpoint === "cancel" && v.status === "APPROVED"
                ? "Motivo de la cancelación (obligatorio)"
                : currentAction.notePrompt}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className={cn("input resize-none", error && "input-error")}
              placeholder={currentAction.notePlaceholder}
              disabled={busy}
              autoFocus
            />
            {effectiveNoteRequired && (
              <p className="text-[11px] text-gray-500 mt-1">Este campo es obligatorio.</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button
              onClick={cancelAction}
              disabled={busy}
              className="btn-secondary"
            >
              Volver
            </button>
            <button
              onClick={submitAction}
              disabled={busy || (effectiveNoteRequired && !note.trim())}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                currentAction.variant === "approve" && "bg-green-600 hover:bg-green-700 text-white",
                currentAction.variant === "reject"  && "bg-red-600 hover:bg-red-700 text-white",
                currentAction.variant === "cancel"  && "bg-gray-700 hover:bg-gray-900 text-white",
                busy && "opacity-50",
              )}
            >
              {busy ? "Procesando..." : currentAction.confirmLabel}
            </button>
          </div>
        </div>
      ) : (
        // ============================================================
        // VISTA DE DETALLE
        // ============================================================
        <div className="space-y-5">
          {/* Header con estado + conflictos */}
          <div className="flex flex-wrap items-center gap-2">
            {meta && SI && (
              <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border", meta.color)}>
                <SI className="w-3.5 h-3.5" />{meta.label}
              </span>
            )}
            {v.conflictLevel === "WARNING" && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" />Aviso
              </span>
            )}
            {v.conflictLevel === "BLOCKING" && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-red-50 text-red-700 border-red-200">
                <AlertTriangle className="w-3.5 h-3.5" />Conflicto
              </span>
            )}
          </div>

          {/* Datos en grilla */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
            <Field icon={UserIcon}  label="Empleado" value={v.employeeNameSnapshot} />
            <Field icon={Briefcase} label="Puesto"   value={v.positionNameSnapshot} />
            <Field icon={MapPin}    label="Sucursal" value={v.branchNameSnapshot} />
            <Field icon={Calendar}  label="Rango"    value={`${fmtDate(v.startDate)} → ${fmtDate(v.endDate)} (${v.daysCount}d)`} />
          </div>

          {/* Notas */}
          {(v.supervisorNote || v.rrhhNote) && (
            <div className="space-y-2">
              {v.supervisorNote && (
                <NoteBlock label="Nota del supervisor" value={v.supervisorNote} actor={v.supervisorActionBy?.name} />
              )}
              {v.rrhhNote && (
                <NoteBlock label="Nota de RRHH" value={v.rrhhNote} actor={v.rrhhActionBy?.name} />
              )}
            </div>
          )}

          {/* Conflictos detallados */}
          {v.conflictReasons?.warnings?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 space-y-1">
              <p className="font-medium">Avisos al crear la solicitud:</p>
              {v.conflictReasons.warnings.map((w: any, i: number) => (
                <p key={i}>• {w.message}</p>
              ))}
            </div>
          )}

          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold text-gray-800 mb-2.5">Historial</p>
            <VacationTimeline
              createdAt={v.createdAt}
              createdBy={v.requestedBy ?? null}
              requesterNote={v.requesterNote}
              history={v.stateHistory ?? []}
            />
          </div>

          {/* Acciones */}
          {availableActions.length > 0 && (
            <div className="border-t border-gray-100 pt-4 flex flex-wrap gap-2 justify-end">
              {availableActions.map((kind) => {
                const a = ACTIONS[kind];
                return (
                  <button
                    key={kind}
                    onClick={() => startAction(kind)}
                    className={cn(
                      "btn-secondary text-xs py-1.5 px-3",
                      a.variant === "approve" && "text-green-700 border-green-300 hover:bg-green-50",
                      a.variant === "reject"  && "text-red-600 border-red-300 hover:bg-red-50",
                    )}
                  >
                    {a.variant === "approve" && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {a.variant === "reject"  && <XCircle      className="w-3.5 h-3.5" />}
                    {a.variant === "cancel"  && <Ban          className="w-3.5 h-3.5" />}
                    {a.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
        <p className="text-gray-900 font-medium leading-snug">{value}</p>
      </div>
    </div>
  );
}

function NoteBlock({ label, value, actor }: { label: string; value: string; actor?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
        {label}{actor ? ` · ${actor}` : ""}
      </p>
      <p className="text-xs text-gray-700 mt-0.5 leading-snug">{value}</p>
    </div>
  );
}
