"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, Clock, Ban,
  FileDown, MapPin, User as UserIcon, Calendar, ClipboardList,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { getTemplate } from "@/lib/action-plan-templates";
import { evaluateForm, type ComplianceResult } from "@/lib/action-plan-templates/compliance";

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  OPEN:        { label: "Abierto",    color: "bg-blue-50 text-blue-800 border-blue-200",    icon: Clock },
  IN_PROGRESS: { label: "En curso",   color: "bg-amber-50 text-amber-800 border-amber-200", icon: Clock },
  COMPLETED:   { label: "Completado", color: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2 },
  CLOSED:      { label: "Cerrado",    color: "bg-gray-50 text-gray-600 border-gray-200",    icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelado",  color: "bg-gray-50 text-gray-400 border-gray-200",    icon: XCircle },
};

// Espeja la matriz blanca del backend (Sprint 2b). Terminales: sin acciones.
const TRANSITIONS: Record<string, { to: string; label: string; variant: "progress" | "complete" | "cancel" }[]> = {
  OPEN:        [{ to: "IN_PROGRESS", label: "Marcar en curso", variant: "progress" },
                { to: "CANCELLED",   label: "Cancelar",        variant: "cancel" }],
  IN_PROGRESS: [{ to: "COMPLETED",   label: "Completado",      variant: "complete" },
                { to: "CANCELLED",   label: "Cancelar",        variant: "cancel" }],
};

interface Props {
  open:       boolean;
  plan:       any | null;        // fila del listado (trae form?.id + scalars del plan)
  canManage:  boolean;
  onClose:    () => void;
  onChanged:  () => void;        // invalida la query de la superficie tras una acción OK
}

const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function ActionPlanDetailModal({ open, plan, canManage, onClose, onChanged }: Props) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formId = plan?.form?.id as string | undefined;

  const { data: form, isLoading, isError } = useQuery({
    queryKey: ["action-plan-form", formId],
    queryFn: async () => {
      const res = await fetch(`/api/action-plan-forms/${formId}`);
      if (!res.ok) throw new Error("No se pudo cargar el formulario");
      return res.json(); // este endpoint devuelve el form DIRECTO, no { data }
    },
    enabled: open && !!formId,
  });

  if (!plan) return null;

  const meta = STATUS_META[plan.status] ?? STATUS_META.OPEN;
  const SI   = meta.icon;
  const employeeName = `${plan.employee?.firstName ?? ""} ${plan.employee?.lastName ?? ""}`.trim();

  // Interpretación de respuestas (solo para answer/favorable). El score y el %
  // documentales vienen de lo persistido; evaluateForm NO los reemplaza.
  let result: ComplianceResult | null = null;
  let evalError = false;
  if (form) {
    try {
      result = evaluateForm(form.formData, getTemplate(form.templateType));
    } catch {
      evalError = true;
    }
  }
  const byId = new Map((result?.items ?? []).map(i => [i.id, i]));
  const ratioForDisplay: number | null =
    form?.complianceRatio != null ? form.complianceRatio : (result?.ratio ?? null);

  const actions = canManage ? (TRANSITIONS[plan.status] ?? []) : [];

  async function doTransition(to: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/action-plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "No se pudo actualizar el estado");
      }
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Error al actualizar el estado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      size="xl"
      title={employeeName ? `Plan de ${employeeName}` : "Plan de acción"}
    >
      <div className="space-y-5">
        {/* Estado + vencido */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border", meta.color)}>
            <SI className="w-3.5 h-3.5" />{meta.label}
          </span>
          {plan.isOverdue && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-red-50 text-red-700 border-red-200">
              <AlertTriangle className="w-3.5 h-3.5" />Vencido
            </span>
          )}
        </div>

        {/* Datos del plan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
          <Field icon={UserIcon} label="Empleado" value={employeeName || "—"} />
          <Field icon={MapPin}   label="Sucursal" value={plan.branch?.name ?? "—"} />
          <Field icon={Calendar} label="Fecha"    value={fmtDate(plan.date)} />
          <Field icon={Calendar} label="Plazo"    value={fmtDate(plan.deadline)} />
        </div>

        <Block label="Motivo">{plan.reason}</Block>
        <Block label="Acciones requeridas"><span className="whitespace-pre-wrap">{plan.requiredActions}</span></Block>
        {plan.notes && <Block label="Notas internas"><span className="italic text-gray-600">{plan.notes}</span></Block>}
        {plan.closedAt && (
          <p className="text-xs text-gray-400">Cerrado: {fmtDate(plan.closedAt)}</p>
        )}

        {/* Bloque de evaluación (solo si hay form) */}
        {formId ? (
          isLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : isError || !form ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>No se pudo cargar el formulario de evaluación.</span>
            </div>
          ) : (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-gray-500 uppercase tracking-wide">Evaluación · {form.templateType}</span>
                {ratioForDisplay != null && (
                  <span className="text-sm text-gray-700">
                    Cumplimiento: <strong>{Math.round(ratioForDisplay * 100)}%</strong>
                  </span>
                )}
                <span className={cn(
                  "inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border",
                  scoreColor(form.generalScore),
                )}>
                  {scoreLabel(form.generalScore)}
                </span>
              </div>

              {evalError ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>No se pudo interpretar el formulario.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {getTemplate(form.templateType).map(section => (
                    <div key={section.id} className="rounded-lg border border-gray-200 overflow-hidden">
                      <p className="text-xs font-semibold text-blue-800 bg-blue-50 px-3 py-1.5 border-b border-blue-100">
                        {section.title}
                      </p>
                      <div className="divide-y divide-gray-100">
                        {section.items.map(item => {
                          const ev = byId.get(item.id);
                          const favorable = ev?.favorable;
                          return (
                            <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                              <span className="text-sm text-gray-700 flex-1">{item.label}</span>
                              <span className={cn(
                                "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded shrink-0",
                                favorable === true  ? "bg-green-50 text-green-700"
                                : favorable === false ? "bg-red-50 text-red-700"
                                : "bg-gray-50 text-gray-400",
                              )}>
                                {favorable === true ? <CheckCircle2 className="w-3.5 h-3.5" />
                                 : favorable === false ? <XCircle className="w-3.5 h-3.5" /> : null}
                                {ev?.answer ?? "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {form.improvementPlan && <Block label="Plan de mejora">{form.improvementPlan}</Block>}
              {form.nextReview && (
                <p className="text-xs text-gray-500">Próxima revisión: {fmtDate(form.nextReview)}</p>
              )}
              {form.signedAt && (
                <p className="text-xs text-gray-500">Firmado: {fmtDate(form.signedAt)}</p>
              )}

              <a
                href={`/api/action-plan-forms/${formId}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs py-1.5 px-3 text-blue-700 border-blue-300 hover:bg-blue-50 inline-flex items-center gap-1"
              >
                <FileDown className="w-3.5 h-3.5" /> Descargar PDF
              </a>
            </div>
          )
        ) : (
          <div className="border-t border-gray-100 pt-4 flex items-center gap-2 text-xs text-gray-400">
            <ClipboardList className="w-4 h-4" />
            Plan sin formulario de evaluación.
          </div>
        )}

        {/* Error de mutación */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Acciones de estado (matriz 2b) */}
        {actions.length > 0 && (
          <div className="border-t border-gray-100 pt-4 flex flex-wrap gap-2 justify-end">
            {actions.map(a => (
              <button
                key={a.to}
                onClick={() => doTransition(a.to)}
                disabled={busy}
                className={cn(
                  "btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1 disabled:opacity-50",
                  a.variant === "progress" && "text-amber-700 border-amber-300 hover:bg-amber-50",
                  a.variant === "complete" && "text-green-700 border-green-300 hover:bg-green-50",
                  a.variant === "cancel"   && "text-gray-500",
                )}
              >
                {a.variant === "progress" && <Clock className="w-3.5 h-3.5" />}
                {a.variant === "complete" && <CheckCircle2 className="w-3.5 h-3.5" />}
                {a.variant === "cancel"   && <Ban className="w-3.5 h-3.5" />}
                {busy ? "..." : a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function scoreLabel(score: string) {
  if (score === "EXCELENTE")        return "Excelente";
  if (score === "BUENO")            return "Bueno";
  if (score === "NECESITA_MEJORAR") return "Necesita mejorar";
  return score;
}

function scoreColor(score: string) {
  if (score === "EXCELENTE") return "bg-green-50 text-green-800 border-green-200";
  if (score === "BUENO")     return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-red-50 text-red-800 border-red-200";
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

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-gray-700">{children}</p>
    </div>
  );
}
