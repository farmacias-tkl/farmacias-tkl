"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Search, Users, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, AlertTriangle, RotateCcw, UserMinus,
} from "lucide-react";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

function ClockIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

// Estado HOY: qué está haciendo el empleado hoy
const STATUS_HOY: Record<string, { label: string; color: string; icon: any }> = {
  ACTIVE:   { label: "Presente",  color: "text-green-700 bg-green-50",  icon: CheckCircle2 },
  ABSENT:   { label: "Ausente",   color: "text-red-700 bg-red-50",      icon: UserMinus    },
  ON_LEAVE: { label: "Licencia",  color: "text-blue-700 bg-blue-50",    icon: ClockIcon    },
  // Vacaciones se agregará cuando exista VacationRequest
};

const createSchema = z.object({
  firstName:         z.string().min(1, "Nombre obligatorio"),
  lastName:          z.string().min(1, "Apellido obligatorio"),
  positionId:        z.string().min(1, "Puesto obligatorio"),
  currentBranchId:   z.string().optional().nullable(),
  hireDate:          z.string().optional(),
  workScheduleNotes: z.string().optional(),
  notes:             z.string().optional(),
  isRotating:        z.boolean().default(false),
});
type CreateForm = z.infer<typeof createSchema>;

async function fetchBranches() {
  const res = await fetch("/api/branches");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Error al cargar sucursales");
  return json;
}

async function fetchPositions() {
  const res = await fetch("/api/positions");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Error al cargar puestos");
  return json;
}

export default function EmpleadosPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  const userBranchId = session?.user?.branchId;

  const [showForm,     setShowForm]     = useState(false);
  const [search,       setSearch]       = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [posFilter,    setPosFilter]    = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [scopeWarn,    setScopeWarn]    = useState<string | null>(null);

  const sessionReady    = status === "authenticated";
  const isOwner         = role === "OWNER";
  const isBranchManager = role === "BRANCH_MANAGER";
  const canCreate       = role ? can.manageEmployees(role) : false;

  const { data: empData, isLoading: empLoading, error: empError } = useQuery({
    queryKey: ["employees", { search, branchFilter, posFilter, showInactive, role, userBranchId }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "50",
        withStatus: "true",
        ...(search       && { search }),
        ...(showInactive ? { active: "any" } : {}),
        // Encargado: forzar su sucursal. Otros: usar filtro
        ...(isBranchManager && userBranchId
          ? { branchId: userBranchId }
          : branchFilter
          ? { branchId: branchFilter }
          : {}),
        ...(posFilter && { positionId: posFilter }),
      });
      const res = await fetch(`/api/employees?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al cargar empleados");
      return json;
    },
    enabled: sessionReady,
    staleTime: 30_000,
  });

  const { data: branchRes, isLoading: branchLoading, error: branchError } = useQuery({
    queryKey: ["branches"],
    queryFn:  fetchBranches,
    enabled:  sessionReady,
    staleTime: 5 * 60_000,
  });

  const { data: posRes, isLoading: posLoading, error: posError } = useQuery({
    queryKey: ["positions"],
    queryFn:  fetchPositions,
    enabled:  sessionReady,
    staleTime: 5 * 60_000,
  });

  const branches  = branchRes?.data  ?? [];
  const positions = posRes?.data     ?? [];
  const employees = empData?.data    ?? [];
  const total     = empData?.meta?.total ?? 0;

  // Desglose "fuera hoy"
  const fueraHoy = {
    ausente:  employees.filter((e: any) => e.statusHoy === "ABSENT").length,
    licencia: employees.filter((e: any) => e.statusHoy === "ON_LEAVE").length,
  };
  const totalFuera = fueraHoy.ausente + fueraHoy.licencia;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
  });

  const createMut = useMutation({
    mutationFn: async (data: CreateForm) => {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al crear empleado");
      return json;
    },
    onSuccess: (json) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      if (json.warning) setScopeWarn(json.warning);
      reset(); setShowForm(false);
    },
  });

  if (status === "loading") {
    return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>;
  }

  const dataError = branchError || posError;
  if (dataError) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800 mb-1">Error al cargar datos</p>
            <p className="text-sm text-red-700">{(dataError as Error).message}</p>
            <button onClick={() => { qc.invalidateQueries({ queryKey: ["branches"] }); qc.invalidateQueries({ queryKey: ["positions"] }); }}
              className="btn-secondary text-xs mt-3">Reintentar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Empleados</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} empleados
            {totalFuera > 0 && (
              <span className="ml-2 font-medium">
                <span className="text-red-500">· {fueraHoy.ausente} ausente{fueraHoy.ausente !== 1 ? "s" : ""}</span>
                {fueraHoy.licencia > 0 && (
                  <span className="text-blue-500"> · {fueraHoy.licencia} licencia{fueraHoy.licencia !== 1 ? "s" : ""}</span>
                )}
              </span>
            )}
            {isOwner && " · solo lectura"}
            {isBranchManager && " · tu sucursal"}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary" disabled={branchLoading || posLoading}>
            <Plus className="w-4 h-4" />Nuevo empleado
          </button>
        )}
      </div>

      {/* Scope warning */}
      {scopeWarn && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 flex-1">{scopeWarn}</p>
          <button onClick={() => setScopeWarn(null)} className="text-amber-500 text-lg leading-none">×</button>
        </div>
      )}

      {/* Error empleados */}
      {empError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 flex-1">{(empError as Error).message}</p>
          <button onClick={() => qc.invalidateQueries({ queryKey: ["employees"] })}
            className="text-red-600 text-xs underline shrink-0">Reintentar</button>
        </div>
      )}

      {/* Formulario */}
      {showForm && !isOwner && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Nuevo empleado</h3>
          {(positions.length === 0 || branches.length === 0) && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                {positions.length === 0 && "No hay puestos. "}
                {branches.length === 0 && "No hay sucursales. "}
                Ejecuta npm run db:seed.
              </p>
            </div>
          )}
          <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Nombre *</label>
                <input {...register("firstName")} className={cn("input", errors.firstName && "input-error")} placeholder="Nombre" />
                {errors.firstName && <p className="error-msg">{errors.firstName.message}</p>}
              </div>
              <div>
                <label className="label">Apellido *</label>
                <input {...register("lastName")} className={cn("input", errors.lastName && "input-error")} placeholder="Apellido" />
                {errors.lastName && <p className="error-msg">{errors.lastName.message}</p>}
              </div>
              <div>
                <label className="label">Puesto *{posLoading && <span className="ml-1 text-xs text-gray-400">(cargando...)</span>}</label>
                <select {...register("positionId")} className={cn("input", errors.positionId && "input-error")} disabled={posLoading}>
                  <option value="">{posLoading ? "Cargando..." : "Selecciona un puesto"}</option>
                  {positions.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.requiresCoverage ? " (req. cobertura)" : ""}{p.isRotatingRole ? " ★" : ""}
                    </option>
                  ))}
                </select>
                {errors.positionId && <p className="error-msg">{errors.positionId.message}</p>}
              </div>
              {!isBranchManager && (
                <div>
                  <label className="label">Sucursal{branchLoading && <span className="ml-1 text-xs text-gray-400">(cargando...)</span>}</label>
                  <select {...register("currentBranchId")} className="input" disabled={branchLoading}>
                    <option value="">{branchLoading ? "Cargando..." : "Sin sucursal fija (rotativo)"}</option>
                    {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Fecha de ingreso</label>
                <input type="date" {...register("hireDate")} className="input" />
              </div>
              <div>
                <label className="label">Horario habitual</label>
                <input {...register("workScheduleNotes")} className="input" placeholder="Ej: Lunes a viernes, turno manana" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" {...register("isRotating")} id="isRot" className="rounded" />
                <label htmlFor="isRot" className="text-sm text-gray-600 cursor-pointer">Personal rotativo</label>
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
              <button type="button" onClick={() => { setShowForm(false); reset(); }} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={createMut.isPending} className="btn-primary">
                {createMut.isPending ? "Guardando..." : "Crear empleado"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filtros — encargado no ve filtro de sucursal */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre..." className="input pl-9" />
        </div>
        {!isBranchManager && (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto">
            <option value="">Todas las sucursales</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={posFilter} onChange={e => setPosFilter(e.target.value)} className="input w-auto">
          <option value="">Todos los puestos</option>
          {positions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
          Ver inactivos
        </label>
      </div>

      {/* Tabla */}
      {empLoading ? (
        <div className="card overflow-hidden">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5 py-0.5">
                <div className="h-3.5 bg-gray-200 rounded animate-pulse w-40" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-medium">No hay empleados</p>
          <p className="text-xs text-gray-400 mt-1">
            {search || branchFilter || posFilter ? "Proba cambiando los filtros." : "Corre npm run db:seed."}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Empleado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Puesto</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Sucursal</th>
                  {/* Estado hoy — separado del estado laboral */}
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hoy</th>
                  {/* Estado laboral — activo/inactivo en nómina */}
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Nómina</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employees.map((emp: any) => (
                  <EmployeeRow key={emp.id} emp={emp} isOwner={isOwner} canManage={canCreate}
                    onUpdate={() => qc.invalidateQueries({ queryKey: ["employees"] })} />
                ))}
              </tbody>
            </table>
          </div>
          {empData?.meta && (
            <div className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              {empData.meta.total} empleados · Página {empData.meta.page} de {empData.meta.pages}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmployeeRow({ emp, isOwner, canManage, onUpdate }: {
  emp: any; isOwner: boolean; canManage: boolean; onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sm = STATUS_HOY[emp.statusHoy ?? "ACTIVE"] ?? STATUS_HOY.ACTIVE;
  const SI = sm.icon;

  const toggleActive = async () => {
    await fetch(`/api/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !emp.active }),
    });
    onUpdate();
  };

  return (
    <>
      <tr className={cn(
        "hover:bg-gray-50 transition-colors cursor-pointer",
        emp.statusHoy === "ABSENT"   && "bg-red-50/20",
        emp.statusHoy === "ON_LEAVE" && "bg-blue-50/10",
        !emp.active && "opacity-50",
      )} onClick={() => setExpanded(v => !v)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
              emp.isRotating ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700",
              !emp.active && "bg-gray-100 text-gray-400",
            )}>
              {emp.isRotating ? <RotateCcw className="w-4 h-4" /> : `${emp.firstName?.[0] ?? ""}${emp.lastName?.[0] ?? ""}`}
            </div>
            <div>
              <p className="font-medium text-gray-900">{emp.firstName} {emp.lastName}</p>
              {emp.hireDate && <p className="text-xs text-gray-400">Desde {new Date(emp.hireDate).getFullYear()}</p>}
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-sm text-gray-700">{emp.position?.name ?? "—"}</span>
          {emp.position?.requiresCoverage && (
            <span className="ml-1.5 text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">cob</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 hidden sm:table-cell">
          {emp.currentBranch?.name ?? <span className="text-gray-400 italic text-xs">Sin sucursal fija</span>}
          {emp.zone && <span className="ml-1 text-xs text-gray-400">· {emp.zone}</span>}
        </td>

        {/* Estado hoy — qué está haciendo */}
        <td className="px-4 py-3 text-center">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", sm.color)}>
            <SI className="w-3 h-3" />{sm.label}
          </span>
        </td>

        {/* Estado laboral — activo/inactivo en nómina */}
        <td className="px-4 py-3 text-center hidden md:table-cell">
          {emp.active
            ? <span className="text-xs text-green-600 font-medium">Activo</span>
            : <span className="text-xs text-gray-400 font-medium">Inactivo</span>}
        </td>

        <td className="px-4 py-3 text-center">
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/70">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex flex-wrap gap-2 items-center">
              {emp.notes && <p className="text-xs text-gray-500 italic w-full">{emp.notes}</p>}
              {emp.workScheduleNotes && <p className="text-xs text-gray-400 w-full">Horario: {emp.workScheduleNotes}</p>}
              {canManage && !isOwner && (
                <button onClick={e => { e.stopPropagation(); toggleActive(); }}
                  className={cn("btn-secondary text-xs py-1.5 px-3",
                    !emp.active && "text-green-700 border-green-300 hover:bg-green-50")}>
                  {emp.active ? "Dar de baja" : "Reactivar"}
                </button>
              )}
              {isOwner && <p className="text-xs text-gray-400 italic">Vista de solo lectura</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
