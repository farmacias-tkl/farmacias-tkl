"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, ClipboardList, AlertTriangle, CheckCircle2,
  Clock, XCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  OPEN:        { label: "Abierto",    color: "bg-blue-50 text-blue-800 border-blue-200",    icon: Clock },
  IN_PROGRESS: { label: "En curso",   color: "bg-amber-50 text-amber-800 border-amber-200", icon: Clock },
  COMPLETED:   { label: "Completado", color: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2 },
  CLOSED:      { label: "Cerrado",    color: "bg-gray-50 text-gray-600 border-gray-200",    icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelado",  color: "bg-gray-50 text-gray-400 border-gray-200",    icon: XCircle },
};
const TERMINAL = ["COMPLETED", "CLOSED", "CANCELLED"];

const today = new Date().toISOString().split("T")[0];

const createSchema = z.object({
  branchId:        z.string().min(1, "Sucursal obligatoria"),
  date:            z.string().min(1, "Fecha obligatoria"),
  reason:          z.string().min(1, "Motivo obligatorio"),
  requiredActions: z.string().min(1, "Acciones requeridas obligatorias"),
  deadline:        z.string().min(1, "Plazo obligatorio"),
  notes:           z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

interface Props {
  employeeId:   string;
  employeeName: string;
  branchId:     string | null;
  branchName:   string | null;
  canCreate:    boolean;
}

export default function ActionPlansSection({
  employeeId, employeeName, branchId, branchName, canCreate,
}: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: plansData, isLoading, error } = useQuery({
    queryKey: ["action-plans", { employeeId }],
    queryFn: async () => {
      const res = await fetch(`/api/action-plans?employeeId=${employeeId}&limit=50`);
      if (!res.ok) throw new Error("Error al cargar planes");
      return res.json();
    },
  });

  // Solo se carga si el empleado es rotativo (sin sucursal fija)
  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn: () => fetch("/api/branches").then(r => r.json()),
    enabled: canCreate && !branchId,
  });

  const plans    = plansData?.data ?? [];
  const branches = branchRes?.data ?? [];

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { date: today, branchId: branchId ?? "" },
  });

  const createMut = useMutation({
    mutationFn: async (data: CreateForm) => {
      const res = await fetch("/api/action-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, employeeId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al crear plan");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action-plans", { employeeId }] });
      reset({ date: today, branchId: branchId ?? "" });
      setShowForm(false);
    },
  });

  const patchMut = useMutation({
    mutationFn: async ({ planId, status }: { planId: string; status: string }) => {
      const res = await fetch(`/api/action-plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al actualizar plan");
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["action-plans", { employeeId }] }),
  });

  return (
    <div className="space-y-3">

      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-400" />
          Planes de acción
          {plans.length > 0 && (
            <span className="text-xs font-normal text-gray-400">({plans.length})</span>
          )}
        </h3>
        {canCreate && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="btn-primary text-xs py-1.5 px-3"
          >
            <Plus className="w-3.5 h-3.5" />Nuevo plan
          </button>
        )}
      </div>

      {/* Formulario de creación */}
      {showForm && canCreate && (
        <div className="card p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-4">
            Nuevo plan — {employeeName}
          </h4>
          <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

              {/* Sucursal */}
              {branchId ? (
                <div className="sm:col-span-2">
                  <label className="label">Sucursal</label>
                  <p className="text-sm text-gray-700 py-1">{branchName}</p>
                  <input type="hidden" {...register("branchId")} defaultValue={branchId} />
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <label className="label">Sucursal *</label>
                  <select
                    {...register("branchId")}
                    className={cn("input", errors.branchId && "input-error")}
                  >
                    <option value="">Seleccioná una sucursal</option>
                    {branches.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  {errors.branchId && <p className="error-msg">{errors.branchId.message}</p>}
                </div>
              )}

              <div>
                <label className="label">Fecha *</label>
                <input
                  type="date"
                  {...register("date")}
                  className={cn("input", errors.date && "input-error")}
                />
                {errors.date && <p className="error-msg">{errors.date.message}</p>}
              </div>
              <div>
                <label className="label">Plazo límite *</label>
                <input
                  type="date"
                  {...register("deadline")}
                  className={cn("input", errors.deadline && "input-error")}
                />
                {errors.deadline && <p className="error-msg">{errors.deadline.message}</p>}
              </div>

              <div className="sm:col-span-2">
                <label className="label">Motivo *</label>
                <textarea
                  {...register("reason")}
                  rows={2}
                  className={cn("input resize-none", errors.reason && "input-error")}
                  placeholder="Describí el motivo del plan de acción..."
                />
                {errors.reason && <p className="error-msg">{errors.reason.message}</p>}
              </div>

              <div className="sm:col-span-2">
                <label className="label">Acciones requeridas *</label>
                <textarea
                  {...register("requiredActions")}
                  rows={2}
                  className={cn("input resize-none", errors.requiredActions && "input-error")}
                  placeholder="Listá las acciones que el empleado debe tomar..."
                />
                {errors.requiredActions && <p className="error-msg">{errors.requiredActions.message}</p>}
              </div>

              <div className="sm:col-span-2">
                <label className="label">Notas adicionales</label>
                <textarea {...register("notes")} rows={2} className="input resize-none" />
              </div>
            </div>

            {createMut.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {(createMut.error as Error).message}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowForm(false); reset(); }}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button type="submit" disabled={createMut.isPending} className="btn-primary">
                {createMut.isPending ? "Guardando..." : "Crear plan"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Error al cargar */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{(error as Error).message}</p>
        </div>
      )}

      {/* Lista de planes */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />
          ))}
        </div>
      ) : plans.length === 0 && !error ? (
        <div className="card p-8 text-center">
          <ClipboardList className="w-7 h-7 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500 font-medium">Sin planes de acción</p>
          {canCreate && (
            <p className="text-xs text-gray-400 mt-1">
              Hacé clic en "Nuevo plan" para crear uno.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((plan: any) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              canCreate={canCreate}
              isPending={patchMut.isPending}
              onStatusChange={status => patchMut.mutate({ planId: plan.id, status })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan, canCreate, isPending, onStatusChange,
}: {
  plan: any;
  canCreate: boolean;
  isPending: boolean;
  onStatusChange: (s: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sm = STATUS_META[plan.status] ?? STATUS_META.OPEN;
  const SI = sm.icon;
  const isTerminal = TERMINAL.includes(plan.status);

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="card overflow-hidden">
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50/70 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <span className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 mt-0.5",
          sm.color,
        )}>
          <SI className="w-3 h-3" />{sm.label}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{plan.reason}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-gray-400">
            <span>Fecha: {fmt(plan.date)}</span>
            <span className={cn(plan.isOverdue && "text-red-600 font-medium")}>
              Plazo: {fmt(plan.deadline)}
              {plan.isOverdue && " · vencido"}
            </span>
            {plan.branch && <span>· {plan.branch.name}</span>}
          </div>
        </div>

        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Acciones requeridas
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{plan.requiredActions}</p>
          </div>

          {plan.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Notas
              </p>
              <p className="text-sm text-gray-600 italic">{plan.notes}</p>
            </div>
          )}

          {plan.closedAt && (
            <p className="text-xs text-gray-400">Cerrado: {fmt(plan.closedAt)}</p>
          )}

          {canCreate && !isTerminal && (
            <div className="flex items-center gap-2 pt-1">
              <label className="text-xs text-gray-500 shrink-0">Cambiar estado:</label>
              <select
                className="input text-xs py-1 w-auto"
                defaultValue={plan.status}
                disabled={isPending}
                onChange={e => onStatusChange(e.target.value)}
              >
                <option value="OPEN">Abierto</option>
                <option value="IN_PROGRESS">En curso</option>
                <option value="COMPLETED">Completado</option>
                <option value="CLOSED">Cerrado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
