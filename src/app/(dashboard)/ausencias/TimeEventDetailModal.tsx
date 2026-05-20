"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Calendar, MapPin, User as UserIcon, Briefcase, Clock,
  LogOut, ArrowLeft, CheckCircle2, XCircle, Ban, ClipboardCheck, Loader2,
  Plus,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";
import { TIME_EVENT_STATUS_META } from "./TimeEventCard";

type ActionKind =
  | "authorize"
  | "resolve-compensation"
  | "resolve-payroll"
  | "resolve-waive"
  | "cancel"
  | "compensate";

interface ActionConfig {
  label:            string;
  endpoint:         string;
  noteRequired:     boolean;
  notePrompt:       string;
  notePlaceholder:  string;
  confirmLabel:     string;
  variant:          "approve" | "reject" | "neutral" | "compensate";
  needsAmount?:     boolean;  // solo "compensate"
  warningText?:     string;
}

const ACTIONS: Record<ActionKind, ActionConfig> = {
  "authorize": {
    label: "Autorizar retiro",
    endpoint: "authorize",
    noteRequired: false,
    notePrompt: "Nota de autorización (opcional)",
    notePlaceholder: "Comentario...",
    confirmLabel: "Autorizar y enviar a revisión",
    variant: "approve",
  },
  "resolve-compensation": {
    label: "Aprobar compensación",
    endpoint: "resolve-compensation",
    noteRequired: false,
    notePrompt: "Nota de la resolución (opcional)",
    notePlaceholder: "Comentario...",
    confirmLabel: "Aprobar para compensar",
    variant: "approve",
  },
  "resolve-payroll": {
    label: "Enviar a descuento",
    endpoint: "resolve-payroll",
    noteRequired: true,
    notePrompt: "Motivo del envío a payroll (obligatorio)",
    notePlaceholder: "Explicá por qué no se compensa...",
    confirmLabel: "Enviar a descuento salarial",
    variant: "reject",
    warningText: "El monto se descontará del próximo recibo. Esta acción es definitiva.",
  },
  "resolve-waive": {
    label: "Condonar",
    endpoint: "resolve-waive",
    noteRequired: true,
    notePrompt: "Motivo de la condonación (obligatorio)",
    notePlaceholder: "Explicá por qué se condona...",
    confirmLabel: "Condonar la deuda",
    variant: "neutral",
    warningText: "La deuda queda saldada sin compensación ni descuento.",
  },
  "cancel": {
    label: "Cancelar evento",
    endpoint: "cancel",
    noteRequired: false,
    notePrompt: "Motivo de cancelación (opcional)",
    notePlaceholder: "Aclaración...",
    confirmLabel: "Cancelar evento",
    variant: "neutral",
  },
  "compensate": {
    label: "Registrar compensación",
    endpoint: "compensations",
    noteRequired: false,
    notePrompt: "Nota (opcional)",
    notePlaceholder: "Aclaración...",
    confirmLabel: "Registrar minutos compensados",
    variant: "compensate",
    needsAmount: true,
  },
};

interface Props {
  open:       boolean;
  eventId:    string | null;
  role:       UserRole | undefined;
  onClose:    () => void;
  onChanged:  () => void;
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });
}
function fmtDateTime(d: string | Date): string {
  return new Date(d).toLocaleString("es-AR", {
    day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
function fmtTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function TimeEventDetailModal({
  open, eventId, role, onClose, onChanged,
}: Props) {
  const [view,  setView]  = useState<"detail" | ActionKind>("detail");
  const [note,  setNote]  = useState("");
  const [amount, setAmount] = useState(""); // solo "compensate"
  const [compDate, setCompDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setView("detail"); setNote(""); setAmount(""); setError(null); setBusy(false); }
  }, [open]);
  useEffect(() => { setView("detail"); setNote(""); setAmount(""); setError(null); }, [eventId]);

  const { data: detailRes, isLoading, refetch } = useQuery({
    queryKey: ["time-event-detail", eventId],
    queryFn: async () => {
      if (!eventId) return null;
      const res = await fetch(`/api/time-events/${eventId}`);
      if (!res.ok) throw new Error("No se pudo cargar el detalle");
      return res.json();
    },
    enabled: !!eventId && open,
  });
  const e = detailRes?.data;

  // Permisos
  const canAuthorize = role ? can.authorizeTimeEvent(role) : false;
  const canResolve   = role ? can.resolveTimeEvent(role)   : false;
  const canCompAdd   = role ? can.addCompensation(role)    : false;

  // Acciones disponibles según estado + tipo
  const availableActions: ActionKind[] = [];
  if (e) {
    const s = e.status;
    if (s === "PENDING_AUTHORIZATION" && canAuthorize) availableActions.push("authorize");
    if (s === "PENDING_REVIEW" && canResolve) {
      availableActions.push("resolve-compensation", "resolve-payroll", "resolve-waive");
    }
    if (s === "APPROVED_FOR_COMPENSATION") {
      if (canCompAdd) availableActions.push("compensate");
      if (canResolve) availableActions.push("resolve-payroll");
    }
    if (s === "PARTIALLY_COMPENSATED") {
      if (canCompAdd) availableActions.push("compensate");
    }
    const isTerminal = s === "COMPENSATED" || s === "SENT_TO_PAYROLL_DEDUCTION" || s === "WAIVED" || s === "CANCELLED";
    if (!isTerminal && canResolve) availableActions.push("cancel");
  }

  const currentAction = view !== "detail" ? ACTIONS[view] : null;

  const startAction = (kind: ActionKind) => {
    setView(kind);
    setNote("");
    setAmount(kind === "compensate" && e ? String(e.minutesRemaining) : "");
    setCompDate(new Date().toISOString().split("T")[0]);
    setError(null);
  };
  const cancelAction = () => {
    setView("detail"); setNote(""); setAmount(""); setError(null);
  };

  const submitAction = async () => {
    if (!currentAction || !e) return;
    if (currentAction.noteRequired && !note.trim()) { setError("Motivo obligatorio."); return; }

    let body: any = {};
    if (currentAction.needsAmount) {
      const n = parseInt(amount, 10);
      if (isNaN(n) || n <= 0) { setError("Cantidad inválida."); return; }
      if (n > e.minutesRemaining) {
        setError(`No podés compensar más que el saldo pendiente (${e.minutesRemaining} min).`);
        return;
      }
      body = { date: compDate, minutesCompensated: n, note: note.trim() || undefined };
    } else if (note.trim()) {
      body = { note: note.trim() };
    }

    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/time-events/${e.id}/${currentAction.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al procesar la acción");
      await refetch();
      onChanged();
      setView("detail"); setNote(""); setAmount("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const meta = e ? (TIME_EVENT_STATUS_META[e.status] ?? TIME_EVENT_STATUS_META.PENDING_REVIEW) : null;
  const SI = meta?.icon;
  const isLate = e?.type === "LATE_ARRIVAL";

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      size="xl"
      title={e ? `${isLate ? "Llegada tarde" : "Retiro anticipado"} — ${e.employeeNameSnapshot}` : "Cargando..."}
      dismissOnBackdrop={view === "detail"}
    >
      {isLoading || !e ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : view !== "detail" && currentAction ? (
        <div className="space-y-4">
          <button type="button" onClick={cancelAction} disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
            <ArrowLeft className="w-3.5 h-3.5" />Volver al detalle
          </button>

          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 space-y-1">
            <p className="text-xs text-gray-500">Acción:</p>
            <p className="text-sm font-semibold text-gray-900">{currentAction.label}</p>
            <p className="text-xs text-gray-600 mt-2">
              {e.employeeNameSnapshot} · {e.branchNameSnapshot} · {fmtDate(e.date)} · {e.minutesOwed} min adeudados ({e.minutesRemaining} pendientes)
            </p>
            {currentAction.warningText && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                ⚠ {currentAction.warningText}
              </p>
            )}
          </div>

          {currentAction.needsAmount && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Minutos compensados *</label>
                <input
                  type="number"
                  min={1}
                  max={e.minutesRemaining}
                  value={amount}
                  onChange={(v) => setAmount(v.target.value)}
                  className="input"
                  disabled={busy}
                />
                <p className="text-[11px] text-gray-500 mt-0.5">Máximo: {e.minutesRemaining} min.</p>
              </div>
              <div>
                <label className="label">Fecha de la compensación *</label>
                <input
                  type="date"
                  value={compDate}
                  onChange={(v) => setCompDate(v.target.value)}
                  className="input"
                  disabled={busy}
                />
              </div>
            </div>
          )}

          <div>
            <label className="label">{currentAction.notePrompt}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={cn("input resize-none", error && "input-error")}
              placeholder={currentAction.notePlaceholder}
              disabled={busy}
              autoFocus={!currentAction.needsAmount}
            />
            {currentAction.noteRequired && (
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
            <button onClick={cancelAction} disabled={busy} className="btn-secondary">Volver</button>
            <button
              onClick={submitAction}
              disabled={busy}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                currentAction.variant === "approve"    && "bg-green-600 hover:bg-green-700 text-white",
                currentAction.variant === "reject"     && "bg-red-600 hover:bg-red-700 text-white",
                currentAction.variant === "compensate" && "bg-indigo-600 hover:bg-indigo-700 text-white",
                currentAction.variant === "neutral"    && "bg-gray-700 hover:bg-gray-900 text-white",
                busy && "opacity-50",
              )}
            >
              {busy ? "Procesando..." : currentAction.confirmLabel}
            </button>
          </div>
        </div>
      ) : (
        // ============================================================
        // DETALLE
        // ============================================================
        <div className="space-y-5">
          {/* Estado + tipo */}
          <div className="flex flex-wrap items-center gap-2">
            {meta && SI && (
              <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border", meta.color)}>
                <SI className="w-3.5 h-3.5" />{meta.label}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-white">
              {isLate
                ? <><Clock  className="w-3.5 h-3.5 text-orange-600" />Llegada tarde</>
                : <><LogOut className="w-3.5 h-3.5 text-violet-600" />Retiro anticipado</>}
            </span>
          </div>

          {/* Datos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
            <Field icon={UserIcon}  label="Empleado" value={e.employeeNameSnapshot} />
            <Field icon={Briefcase} label="Puesto"   value={e.positionNameSnapshot} />
            <Field icon={MapPin}    label="Sucursal" value={e.branchNameSnapshot} />
            <Field icon={Calendar}  label="Fecha"    value={fmtDate(e.date)} />
            <Field icon={Clock}     label={isLate ? "Esperada entrada" : "Esperada salida"} value={fmtTime(e.expectedTime)} />
            <Field icon={Clock}     label={isLate ? "Real entrada" : "Real salida"} value={fmtTime(e.actualTime)} />
          </div>

          {/* Saldo */}
          <div className="rounded-lg border border-gray-200 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Saldo</p>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-1">
              <span className="text-sm"><span className="font-semibold text-orange-700">{e.minutesOwed}</span> min adeudados</span>
              <span className="text-sm"><span className="font-semibold text-indigo-700">{e.minutesCompensated}</span> compensados</span>
              <span className="text-sm"><span className="font-semibold text-red-700">{e.minutesRemaining}</span> pendientes</span>
            </div>
          </div>

          {/* Motivo y notas */}
          {e.reason && (
            <NoteBlock label="Motivo" value={e.reason} />
          )}
          {e.reporterNote && (
            <NoteBlock label="Nota interna del que lo cargó" value={e.reporterNote} actor={e.reportedBy?.name} />
          )}
          {e.authorizationNote && (
            <NoteBlock label="Nota de autorización" value={e.authorizationNote} actor={e.authorizedBy?.name} />
          )}
          {e.resolutionNote && (
            <NoteBlock label="Nota de la resolución" value={e.resolutionNote} actor={e.resolvedBy?.name} />
          )}

          {/* Compensaciones */}
          {e.compensations?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-800 mb-2">Compensaciones registradas</p>
              <ul className="space-y-1.5">
                {e.compensations.map((c: any) => (
                  <li key={c.id} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs flex items-center justify-between gap-3">
                    <span className="font-medium text-indigo-700">+{c.minutesCompensated} min</span>
                    <span className="text-gray-500">{fmtDate(c.date)}</span>
                    <span className="text-gray-500 truncate">{c.registeredBy?.name ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timeline */}
          {(e.stateHistory?.length > 0 || true) && (
            <div>
              <p className="text-xs font-semibold text-gray-800 mb-2">Historial</p>
              <ol className="space-y-2">
                <li className="text-xs text-gray-600">
                  <span className="font-medium">Creado</span> por {e.reportedBy?.name ?? "—"} · {fmtDateTime(e.createdAt)}
                </li>
                {[...(e.stateHistory ?? [])].reverse().map((h: any) => (
                  <li key={h.id} className="text-xs text-gray-600">
                    <span className="font-medium">{TIME_EVENT_STATUS_META[h.fromStatus]?.label ?? h.fromStatus}</span>
                    {" → "}
                    <span className="font-medium">{TIME_EVENT_STATUS_META[h.toStatus]?.label ?? h.toStatus}</span>
                    {" "}por {h.changedBy?.name ?? "—"} · {fmtDateTime(h.changedAt)}
                    {h.note && (
                      <span className="block mt-0.5 text-gray-500 italic pl-2 border-l-2 border-gray-200">{h.note}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

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
                      a.variant === "approve"    && "text-green-700 border-green-300 hover:bg-green-50",
                      a.variant === "reject"     && "text-red-600 border-red-300 hover:bg-red-50",
                      a.variant === "compensate" && "text-indigo-700 border-indigo-300 hover:bg-indigo-50",
                    )}
                  >
                    {a.variant === "approve"    && <CheckCircle2    className="w-3.5 h-3.5" />}
                    {a.variant === "reject"     && <XCircle         className="w-3.5 h-3.5" />}
                    {a.variant === "compensate" && <Plus            className="w-3.5 h-3.5" />}
                    {kind === "cancel"          && <Ban             className="w-3.5 h-3.5" />}
                    {kind === "resolve-waive"   && <ClipboardCheck  className="w-3.5 h-3.5" />}
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
