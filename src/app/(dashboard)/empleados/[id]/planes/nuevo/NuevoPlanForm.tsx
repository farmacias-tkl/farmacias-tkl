"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOSTRADOR_TEMPLATE } from "@/lib/action-plan-templates/mostrador";
import type { TemplateSection } from "@/lib/action-plan-templates/mostrador";

const SECTIONS: TemplateSection[] = MOSTRADOR_TEMPLATE;

type ItemValue = "SI" | "NO" | null;
type FormData  = Record<string, ItemValue>;
type Score     = "EXCELENTE" | "BUENO" | "NECESITA_MEJORAR";

const SCORE_OPTIONS: { value: Score; label: string; color: string }[] = [
  { value: "EXCELENTE",        label: "Excelente",        color: "bg-green-100 text-green-800 border-green-300" },
  { value: "BUENO",            label: "Bueno",            color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "NECESITA_MEJORAR", label: "Necesita mejorar", color: "bg-red-100 text-red-800 border-red-300" },
];

interface Props {
  employeeId:      string;
  branchId:        string | null;
  encargado:       string;
  createdByUserId: string;
}

export default function NuevoPlanForm({ employeeId, branchId, encargado }: Props) {
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);

  const [date,            setDate]            = useState(today);
  const [deadline,        setDeadline]        = useState("");
  const [reason,          setReason]          = useState("");
  const [requiredActions, setRequiredActions] = useState("");
  const [notes,           setNotes]           = useState("");

  const initialFormData: FormData = {};
  SECTIONS.forEach(s => s.items.forEach(i => { initialFormData[i.id] = null; }));
  const [formData,        setFormData]        = useState<FormData>(initialFormData);
  const [generalScore,    setGeneralScore]    = useState<Score | null>(null);
  const [improvementPlan, setImprovementPlan] = useState("");
  const [nextReview,      setNextReview]      = useState("");

  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const setItem = (itemId: string, value: ItemValue) =>
    setFormData(prev => ({ ...prev, [itemId]: value }));

  const allFilled = Object.values(formData).every(v => v !== null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!generalScore) { setError("Seleccioná una calificación general"); return; }
    if (!reason.trim()) { setError("El motivo es obligatorio"); return; }
    if (!requiredActions.trim()) { setError("Las acciones requeridas son obligatorias"); return; }
    if (!deadline) { setError("El plazo es obligatorio"); return; }

    setSaving(true);
    setError(null);

    try {
      // 1. Create ActionPlan
      const planRes = await fetch("/api/action-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          branchId: branchId ?? "",
          date,
          reason,
          requiredActions,
          deadline,
          notes: notes || null,
        }),
      });

      if (!planRes.ok) {
        const err = await planRes.json();
        setError(err.error ?? "Error al crear el plan");
        setSaving(false);
        return;
      }

      const plan = await planRes.json();

      // 2. Create ActionPlanForm
      const formRes = await fetch("/api/action-plan-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionPlanId:  plan.id,
          templateType:  "MOSTRADOR",
          formData,
          generalScore,
          improvementPlan: improvementPlan || null,
          nextReview:      nextReview || null,
        }),
      });

      if (!formRes.ok) {
        const err = await formRes.json();
        setError(err.error ?? "Error al guardar el formulario");
        setSaving(false);
        return;
      }

      router.push(`/empleados/${employeeId}?tab=planes`);
    } catch {
      setError("Error de conexión");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Datos generales */}
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Datos del plan</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha del plan</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Plazo para cumplimiento</label>
            <input
              type="date"
              className="input"
              value={deadline}
              min={date}
              onChange={e => setDeadline(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="label">Motivo del plan de acción</label>
          <textarea
            className="input min-h-[80px] resize-y"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Describí el motivo por el que se genera este plan..."
            required
          />
        </div>

        <div>
          <label className="label">Acciones requeridas</label>
          <textarea
            className="input min-h-[80px] resize-y"
            value={requiredActions}
            onChange={e => setRequiredActions(e.target.value)}
            placeholder="Listá las acciones concretas que debe realizar el empleado..."
            required
          />
        </div>

        <div>
          <label className="label">Notas internas <span className="text-gray-400 font-normal">(opcional)</span></label>
          <textarea
            className="input min-h-[60px] resize-y"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Observaciones internas..."
          />
        </div>
      </div>

      {/* Evaluación por secciones */}
      <div className="card p-5 space-y-6">
        <h3 className="text-sm font-semibold text-gray-700">Evaluación de desempeño — Mostrador</h3>

        {SECTIONS.map(section => (
          <div key={section.id}>
            <h4 className="text-xs font-semibold text-blue-800 bg-blue-50 px-3 py-1.5 rounded-t border border-blue-200">
              {section.title}
            </h4>
            <div className="border border-t-0 border-gray-200 rounded-b divide-y divide-gray-100">
              {section.items.map(item => {
                const val = formData[item.id];
                return (
                  <div key={item.id} className="flex items-center justify-between px-3 py-2.5 gap-4">
                    <span className="text-sm text-gray-700 flex-1">{item.label}</span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setItem(item.id, "SI")}
                        className={cn(
                          "px-3 py-1 rounded text-xs font-medium border transition-colors",
                          val === "SI"
                            ? "bg-green-600 text-white border-green-600"
                            : "bg-white text-gray-600 border-gray-300 hover:border-green-400 hover:text-green-700",
                        )}
                      >
                        SI
                      </button>
                      <button
                        type="button"
                        onClick={() => setItem(item.id, "NO")}
                        className={cn(
                          "px-3 py-1 rounded text-xs font-medium border transition-colors",
                          val === "NO"
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-gray-600 border-gray-300 hover:border-red-400 hover:text-red-700",
                        )}
                      >
                        NO
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Calificación general */}
      <div className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Calificación general</h3>
        <div className="flex gap-3 flex-wrap">
          {SCORE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setGeneralScore(opt.value)}
              className={cn(
                "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                generalScore === opt.value
                  ? opt.color + " ring-2 ring-offset-1 ring-current"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-400",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Plan de mejora y próxima revisión */}
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Seguimiento</h3>

        <div>
          <label className="label">Plan de mejora <span className="text-gray-400 font-normal">(opcional)</span></label>
          <textarea
            className="input min-h-[80px] resize-y"
            value={improvementPlan}
            onChange={e => setImprovementPlan(e.target.value)}
            placeholder="Describí el plan de mejora acordado con el empleado..."
          />
        </div>

        <div>
          <label className="label">Próxima revisión <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input
            type="date"
            className="input"
            value={nextReview}
            min={today}
            onChange={e => setNextReview(e.target.value)}
          />
        </div>
      </div>

      {/* Error + submit */}
      {error && (
        <p className="error-msg">{error}</p>
      )}

      {!allFilled && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Completá todos los ítems de evaluación antes de guardar.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving || !allFilled || !generalScore}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Guardando..." : "Guardar plan de acción"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/empleados/${employeeId}?tab=planes`)}
          className="btn-secondary"
        >
          Cancelar
        </button>
      </div>

    </form>
  );
}
