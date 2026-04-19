"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, RotateCcw, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Calendar, MapPin, Briefcase,
} from "lucide-react";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const ASSIGNMENT_TYPES = [
  { value: "ROTATION",            label: "Rotacion programada" },
  { value: "TEMPORARY_COVERAGE",  label: "Cobertura temporal" },
];

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  ACTIVE:    { label: "Activa",     color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  CANCELLED: { label: "Cancelada",  color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  COMPLETED: { label: "Completada", color: "bg-gray-50 text-gray-600 border-gray-200",      icon: CheckCircle2 },
};

const todayStr = new Date().toISOString().split("T")[0];

const createSchema = z.object({
  employeeId: z.string().min(1, "Rotativa obligatoria"),
  branchId:   z.string().min(1, "Sucursal obligatoria"),
  positionId: z.string().optional().nullable(),
  type:       z.enum(["ROTATION","TEMPORARY_COVERAGE"]),
  startDate:  z.string().min(1, "Fecha inicio obligatoria"),
  endDate:    z.string().min(1, "Fecha fin obligatoria"),
  reason:     z.string().optional(),
  notes:      z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

export default function RotativasPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;

  const [showForm,    setShowForm]    = useState(false);
  const [view,        setView]        = useState<"today"|"upcoming"|"all">("today");
  const [branchFilter,setBranchFilter]= useState("");
  const [statusFilter,setStatusFilter]= useState("ACTIVE");
  const [cancelId,    setCancelId]    = useState<string|null>(null);
  const [cancelNote,  setCancelNote]  = useState("");

  const sessionReady = status === "authenticated";
  const canManage    = role ? can.reassignEmployee(role) : false;

  const { data: assignRes, isLoading } = useQuery({
    queryKey: ["assignments", { view, branchFilter, statusFilter }],
    queryFn: async () => {
      const p = new URLSearchParams({
        view, limit: "50",
        status: statusFilter,
        ...(branchFilter && { branchId: branchFilter }),
      });
      const res = await fetch(`/api/assignments?${p}`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: sessionReady,
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
    enabled:  sessionReady,
  });

  const { data: rotRes } = useQuery({
    queryKey: ["rotativos"],
    queryFn:  () => fetch("/api/employees?isRotating=true&limit=50").then(r => r.json()),
    enabled:  sessionReady,
  });

  const { data: posRes } = useQuery({
    queryKey: ["positions"],
    queryFn:  () => fetch("/api/positions").then(r => r.json()),
    enabled:  sessionReady,
  });

  const assignments = assignRes?.data    ?? [];
  const total       = assignRes?.meta?.total ?? 0;
  const branches    = branchRes?.data    ?? [];
  const rotativos   = rotRes?.data       ?? [];
  const positions   = posRes?.data       ?? [];

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { type: "TEMPORARY_COVERAGE", startDate: todayStr, endDate: todayStr },
  });

  const createMut = useMutation({
    mutationFn: async (data: CreateForm) => {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] });
      reset({ type: "TEMPORARY_COVERAGE", startDate: todayStr, endDate: todayStr });
      setShowForm(false);
    },
  });

  const updateStatus = async (id: string, newStatus: string, notes?: string) => {
    await fetch(`/api/assignments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, notes }),
    });
    qc.invalidateQueries({ queryKey: ["assignments"] });
    setCancelId(null); setCancelNote("");
  };

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  const activeToday = assignments.filter((a: any) => a.isActiveToday && a.status === "ACTIVE").length;
  const absentToday = assignments.filter((a: any) => a.isActiveToday && a.employeeAbsentToday).length;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Rotativas y coberturas</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeToday} asignadas hoy
            {absentToday > 0 && (
              <span className="ml-2 text-red-500 font-medium">· {absentToday} ausente{absentToday > 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus className="w-4 h-4" />Nueva asignacion
          </button>
        )}
      </div>

      {/* Formulario nueva asignación */}
      {showForm && canManage && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Nueva asignacion de rotativa</h3>
          <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

              <div>
                <label className="label">Rotativa *</label>
                <select {...register("employeeId")}
                  className={cn("input", errors.employeeId && "input-error")}>
                  <option value="">Selecciona una rotativa</option>
                  {rotativos.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}{e.zone ? ` (${e.zone})` : ""}
                    </option>
                  ))}
                </select>
                {errors.employeeId && <p className="error-msg">{errors.employeeId.message}</p>}
              </div>

              <div>
                <label className="label">Sucursal *</label>
                <select {...register("branchId")}
                  className={cn("input", errors.branchId && "input-error")}>
                  <option value="">Selecciona sucursal</option>
                  {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {errors.branchId && <p className="error-msg">{errors.branchId.message}</p>}
              </div>

              <div>
                <label className="label">Puesto cubierto</label>
                <select {...register("positionId")} className="input">
                  <option value="">Sin especificar</option>
                  {positions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-0.5">
                  Puesto que cubre en esta sucursal. Puede diferir de su puesto habitual.
                </p>
              </div>

              <div>
                <label className="label">Tipo *</label>
                <select {...register("type")} className="input">
                  {ASSIGNMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Fecha inicio *</label>
                <input type="date" {...register("startDate")}
                  className={cn("input", errors.startDate && "input-error")} />
                {errors.startDate && <p className="error-msg">{errors.startDate.message}</p>}
              </div>

              <div>
                <label className="label">Fecha fin *</label>
                <input type="date" {...register("endDate")}
                  className={cn("input", errors.endDate && "input-error")} />
                {errors.endDate && <p className="error-msg">{errors.endDate.message}</p>}
              </div>

              <div className="sm:col-span-2">
                <label className="label">Motivo</label>
                <input {...register("reason")} className="input"
                  placeholder="Ej: Cobertura vacaciones Cajera 1, Rotacion programada zona norte..." />
              </div>

              <div className="sm:col-span-2">
                <label className="label">Notas internas</label>
                <textarea {...register("notes")} rows={2} className="input resize-none" />
              </div>
            </div>

            {createMut.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {(createMut.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); reset(); }} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={createMut.isPending} className="btn-primary">
                {createMut.isPending ? "Guardando..." : "Crear asignacion"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs de vista */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {([
            { key: "today",    label: "Hoy" },
            { key: "upcoming", label: "Proximos 7 dias" },
            { key: "all",      label: "Todas" },
          ] as const).map(v => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                view === v.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto">
          <option value="">Todas las sucursales</option>
          {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="ACTIVE">Solo activas</option>
          <option value="CANCELLED">Canceladas</option>
          <option value="COMPLETED">Completadas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
      ) : assignments.length === 0 ? (
        <div className="card p-10 text-center">
          <RotateCcw className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">
            {view === "today" ? "No hay rotativas asignadas hoy."
              : view === "upcoming" ? "No hay asignaciones en los próximos 7 dias."
              : "No hay asignaciones registradas."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((a: any) => (
            <AssignmentCard key={a.id} assignment={a} canManage={canManage}
              onCancel={id => setCancelId(id)}
              onComplete={id => updateStatus(id, "COMPLETED")} />
          ))}
        </div>
      )}

      {/* Modal cancelación */}
      {cancelId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card p-5 w-full max-w-md">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Cancelar asignacion</h3>
            <p className="text-xs text-gray-500 mb-3">
              La asignacion quedará en estado CANCELADA y no impactará en el plantel.
              El historial se conserva.
            </p>
            <textarea value={cancelNote} onChange={e => setCancelNote(e.target.value)}
              rows={3} className="input resize-none w-full mb-4"
              placeholder="Motivo de cancelacion (opcional)" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setCancelId(null); setCancelNote(""); }} className="btn-secondary">
                Volver
              </button>
              <button onClick={() => updateStatus(cancelId, "CANCELLED", cancelNote || undefined)}
                className="btn-primary bg-red-600 hover:bg-red-700">
                Confirmar cancelacion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignmentCard({ assignment: a, canManage, onCancel, onComplete }: {
  assignment: any; canManage: boolean;
  onCancel:   (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[a.status] ?? STATUS_META.ACTIVE;
  const SI   = meta.icon;

  const start = new Date(a.startDate);
  const end   = a.endDate ? new Date(a.endDate) : null;
  const fmt   = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });

  const typeLabel = ASSIGNMENT_TYPES.find(t => t.value === a.type)?.label ?? a.type;

  return (
    <div className={cn("card overflow-hidden",
      a.isActiveToday && a.status === "ACTIVE" && "border-violet-200",
      a.employeeAbsentToday && "border-red-200",
    )}>
      <div className="px-4 py-3 cursor-pointer flex items-start gap-3" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {a.employee.firstName} {a.employee.lastName}
            </p>
            {a.employee.zone && (
              <span className="text-xs text-gray-400">({a.employee.zone})</span>
            )}
            {a.employeeAbsentToday && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                Ausente hoy
              </span>
            )}
            {a.isActiveToday && !a.employeeAbsentToday && a.status === "ACTIVE" && (
              <span className="text-xs font-medium text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">
                En sucursal hoy
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />{a.branch.name}
            </span>
            {a.position && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3 h-3" />{a.position.name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {fmt(start)}{end ? ` → ${fmt(end)}` : ""}
            </span>
            <span className="text-gray-400">{typeLabel}</span>
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
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 bg-gray-50/50 space-y-2">
          {a.reason && <p className="text-xs text-gray-600">Motivo: {a.reason}</p>}
          {a.notes  && <p className="text-xs text-gray-500 italic">{a.notes}</p>}
          {a.employeeAbsentToday && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <p className="text-xs text-red-700">
                Esta rotativa está ausente hoy. La sucursal{" "}
                {a.position?.requiresCoverage ? "tiene un puesto crítico descubierto." : "puede necesitar reemplazo."}
              </p>
            </div>
          )}
          {canManage && a.status === "ACTIVE" && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => onComplete(a.id)}
                className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                Marcar completada
              </button>
              <button onClick={() => onCancel(a.id)}
                className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
