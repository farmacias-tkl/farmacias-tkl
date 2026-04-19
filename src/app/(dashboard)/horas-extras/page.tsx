"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Clock, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const OVERTIME_REASONS = [
  { value: "ABSENCE_COVERAGE",   label: "Cobertura de ausencia" },
  { value: "VACATION_COVERAGE",  label: "Cobertura de vacaciones" },
  { value: "UNDERSTAFFING",      label: "Falta de personal" },
  { value: "HIGH_DEMAND",        label: "Alta demanda" },
  { value: "OTHER",              label: "Otro" },
];

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  REPORTED: { label: "Reportada",  color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: Clock },
  APPROVED: { label: "Aprobada",   color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  REJECTED: { label: "Rechazada",  color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
};

const today = new Date().toISOString().split("T")[0];

const createSchema = z.object({
  employeeId: z.string().min(1, "Empleado obligatorio"),
  branchId:   z.string().min(1, "Sucursal obligatoria"),
  date:       z.string().min(1, "Fecha obligatoria"),
  hours:      z.number({ invalid_type_error: "Ingresa las horas" }).min(0.5, "Minimo 0.5hs").max(24, "Maximo 24hs"),
  reason:     z.string().min(1, "Motivo obligatorio"),
  notes:      z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

export default function HorasExtrasPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  const userBranchId = session?.user?.branchId;

  const [showForm,     setShowForm]     = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formBranchId, setFormBranchId] = useState(
    role === "BRANCH_MANAGER" ? (userBranchId ?? "") : ""
  );
  const [rejectId,    setRejectId]    = useState<string | null>(null);
  const [rejectReason,setRejectReason]= useState("");

  const sessionReady    = status === "authenticated";
  const isBranchManager = role === "BRANCH_MANAGER";
  const canCreate       = role ? can.createOvertime(role) : false;
  const canApprove      = role ? can.approveOvertime(role) : false;

  const { data: overtimeData, isLoading } = useQuery({
    queryKey: ["overtime", { branchFilter, statusFilter }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "50",
        ...(isBranchManager && userBranchId ? { branchId: userBranchId }
          : branchFilter ? { branchId: branchFilter } : {}),
        ...(statusFilter && { status: statusFilter }),
      });
      const res = await fetch(`/api/overtime?${p}`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: sessionReady,
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn: () => fetch("/api/branches").then(r => r.json()),
    enabled: sessionReady,
  });

  const { data: empRes, isLoading: empLoading } = useQuery({
    queryKey: ["employees-for-overtime", formBranchId],
    queryFn: async () => {
      if (!formBranchId) return { data: [] };
      const p = new URLSearchParams({ limit: "200", branchId: formBranchId });
      return fetch(`/api/employees?${p}`).then(r => r.json());
    },
    enabled: sessionReady && !!formBranchId,
  });

  const branches  = branchRes?.data    ?? [];
  const employees = empRes?.data       ?? [];
  const records   = overtimeData?.data ?? [];
  const total     = overtimeData?.meta?.total ?? 0;

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { date: today, branchId: isBranchManager ? (userBranchId ?? "") : "" },
  });

  const createMut = useMutation({
    mutationFn: async (data: CreateForm) => {
      const res = await fetch("/api/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, hours: Number(data.hours) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["overtime"] });
      reset({ date: today, branchId: isBranchManager ? (userBranchId ?? "") : "" });
      setFormBranchId(isBranchManager ? (userBranchId ?? "") : "");
      setShowForm(false);
    },
  });

  const updateStatus = async (id: string, newStatus: string, rejectionReason?: string) => {
    await fetch(`/api/overtime/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, ...(rejectionReason && { rejectionReason }) }),
    });
    qc.invalidateQueries({ queryKey: ["overtime"] });
    setRejectId(null);
    setRejectReason("");
  };

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  const pendingCount = records.filter((r: any) => r.status === "REPORTED").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Horas extras</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} registros
            {pendingCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">
                · {pendingCount} pendiente{pendingCount > 1 ? "s" : ""} de aprobacion
              </span>
            )}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus className="w-4 h-4" />Registrar horas extras
          </button>
        )}
      </div>

      {showForm && canCreate && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Registrar horas extras</h3>
          <p className="text-xs text-gray-400 mb-4">Un registro por empleado por dia.</p>
          <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {!isBranchManager ? (
                <div>
                  <label className="label">Sucursal *</label>
                  <select
                    className={cn("input", errors.branchId && "input-error")}
                    value={formBranchId}
                    onChange={e => { setFormBranchId(e.target.value); setValue("branchId", e.target.value); setValue("employeeId", ""); }}>
                    <option value="">Selecciona sucursal</option>
                    {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  {errors.branchId && <p className="error-msg">{errors.branchId.message}</p>}
                </div>
              ) : (
                <div>
                  <label className="label">Sucursal</label>
                  <input className="input bg-gray-50 text-gray-500" disabled
                    value={branches.find((b: any) => b.id === userBranchId)?.name ?? "Tu sucursal"} />
                  <input type="hidden" {...register("branchId")} />
                </div>
              )}

              <div>
                <label className="label">Empleado *{empLoading && <span className="ml-1 text-xs text-gray-400">(cargando...)</span>}</label>
                <select {...register("employeeId")}
                  className={cn("input", errors.employeeId && "input-error")}
                  disabled={!formBranchId || empLoading}>
                  <option value="">{!formBranchId ? "Primero selecciona sucursal" : "Selecciona empleado"}</option>
                  {employees.map((e: any) => (
                    <option key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.position?.name}</option>
                  ))}
                </select>
                {errors.employeeId && <p className="error-msg">{errors.employeeId.message}</p>}
              </div>

              <div>
                <label className="label">Fecha *</label>
                <input type="date" {...register("date")} className={cn("input", errors.date && "input-error")} />
                {errors.date && <p className="error-msg">{errors.date.message}</p>}
              </div>

              <div>
                <label className="label">Cantidad de horas *</label>
                <input type="number" step="0.5" min="0.5" max="24"
                  {...register("hours", { valueAsNumber: true })}
                  className={cn("input", errors.hours && "input-error")}
                  placeholder="Ej: 2.5" />
                {errors.hours && <p className="error-msg">{errors.hours.message}</p>}
              </div>

              <div>
                <label className="label">Motivo *</label>
                <select {...register("reason")} className={cn("input", errors.reason && "input-error")}>
                  <option value="">Selecciona motivo</option>
                  {OVERTIME_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {errors.reason && <p className="error-msg">{errors.reason.message}</p>}
              </div>

              <div className="sm:col-span-2">
                <label className="label">Observaciones</label>
                <textarea {...register("notes")} rows={2} className="input resize-none" />
              </div>
            </div>

            {createMut.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {(createMut.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); reset({ date: today }); setFormBranchId(""); }}
                className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={createMut.isPending} className="btn-primary">
                {createMut.isPending ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {!isBranchManager && (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto">
            <option value="">Todas las sucursales</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
      ) : records.length === 0 ? (
        <div className="card p-10 text-center">
          <Clock className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No hay horas extras registradas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r: any) => (
            <OvertimeCard key={r.id} record={r} canApprove={canApprove}
              onApprove={id => updateStatus(id, "APPROVED")}
              onReject={id => setRejectId(id)} />
          ))}
        </div>
      )}

      {/* Modal rechazo */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card p-5 w-full max-w-md">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Motivo de rechazo</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3} className="input resize-none w-full mb-4"
              placeholder="Explicacion del rechazo..." />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectId(null); setRejectReason(""); }} className="btn-secondary">
                Cancelar
              </button>
              <button
                onClick={() => updateStatus(rejectId, "REJECTED", rejectReason)}
                disabled={!rejectReason.trim()}
                className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50">
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OvertimeCard({ record: r, canApprove, onApprove, onReject }: {
  record: any; canApprove: boolean;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[r.status] ?? STATUS_META.REPORTED;
  const SI   = meta.icon;
  const date = new Date(r.date).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 cursor-pointer flex items-start gap-3" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {r.employee.firstName} {r.employee.lastName}
            </p>
            <span className="text-xs text-gray-500">{r.employee.position?.name}</span>
            <span className="text-sm font-bold text-gray-800">{r.hours}hs</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
            <span>{date}</span>
            <span>·</span>
            <span>{r.branch?.name}</span>
            <span>·</span>
            <span>{OVERTIME_REASONS.find(or => or.value === r.reason)?.label ?? r.reason}</span>
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
          {r.notes && <p className="text-xs text-gray-600 italic">{r.notes}</p>}
          {r.rejectionReason && (
            <p className="text-xs text-red-600">Motivo de rechazo: {r.rejectionReason}</p>
          )}
          {canApprove && r.status === "REPORTED" && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => onApprove(r.id)}
                className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                Aprobar
              </button>
              <button onClick={() => onReject(r.id)}
                className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                Rechazar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
