"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, CheckCircle2, XCircle, AlertTriangle,
  RotateCcw, MapPin, Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const createSchema = z.object({
  name:             z.string().min(1, "Nombre obligatorio"),
  requiresCoverage: z.boolean().default(false),
  isRotatingRole:   z.boolean().default(false),
  scope:            z.enum(["ALL", "SPECIFIC"]).default("ALL"),
  notes:            z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const SCOPE_LABELS: Record<string, string> = {
  ALL:      "Todas las sucursales",
  SPECIFIC: "Sucursales específicas",
};

export default function PuestosPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  // OWNER y ADMIN pueden gestionar puestos (catálogo compartido).
  const isAdmin = role === "ADMIN" || role === "OWNER";

  const [showForm, setShowForm] = useState(false);
  const [serverErr, setServerErr] = useState("");

  const { data: posRes, isLoading, error } = useQuery({
    queryKey: ["positions", { includeInactive: true }],
    queryFn: async () => {
      const res = await fetch("/api/positions?includeInactive=true");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Error ${res.status}`);
      }
      return res.json();
    },
    enabled: status === "authenticated",
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { requiresCoverage: false, isRotatingRole: false, scope: "ALL" },
  });

  const createMut = useMutation({
    mutationFn: async (data: CreateForm) => {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al crear");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions"] });
      reset();
      setShowForm(false);
      setServerErr("");
    },
    onError: (e: Error) => setServerErr(e.message),
  });

  const positions = posRes?.data ?? [];
  const activos   = positions.filter((p: any) => p.active);
  const inactivos = positions.filter((p: any) => !p.active);

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Puestos</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {activos.length} activos{inactivos.length > 0 && ` · ${inactivos.length} inactivos`}
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Nuevo puesto
          </button>
        )}
      </div>

      {/* Error de fetch */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">
            Error al cargar puestos: {(error as Error).message}
          </p>
        </div>
      )}

      {/* Formulario de creación */}
      {showForm && isAdmin && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Nuevo puesto</h3>
          <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Nombre *</label>
                <input
                  {...register("name")}
                  className={cn("input", errors.name && "input-error")}
                  placeholder="Ej: Cajera, Cadete, Encargado..."
                />
                {errors.name && <p className="error-msg">{errors.name.message}</p>}
              </div>

              <div>
                <label className="label">Alcance</label>
                <select {...register("scope")} className="input">
                  <option value="ALL">Todas las sucursales</option>
                  <option value="SPECIFIC">Sucursales específicas</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="label">Notas</label>
                <input
                  {...register("notes")}
                  className="input"
                  placeholder="Opcional — descripción o aclaración"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register("requiresCoverage")}
                  id="reqCov"
                  className="rounded"
                />
                <label htmlFor="reqCov" className="text-sm text-gray-600 cursor-pointer">
                  Requiere cobertura rotativa en vacaciones
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register("isRotatingRole")}
                  id="isRot"
                  className="rounded"
                />
                <label htmlFor="isRot" className="text-sm text-gray-600 cursor-pointer">
                  Es puesto rotativo (personal de cobertura)
                </label>
              </div>
            </div>

            {serverErr && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{serverErr}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowForm(false); reset(); setServerErr(""); }}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button type="submit" disabled={createMut.isPending} className="btn-primary">
                {createMut.isPending ? "Creando..." : "Crear puesto"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla de puestos */}
      {isLoading ? (
        <div className="card overflow-hidden">
          {[1,2,3,4].map(i => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100">
              <div className="flex-1 space-y-1.5 py-0.5">
                <div className="h-3.5 bg-gray-200 rounded animate-pulse w-32" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-48" />
              </div>
            </div>
          ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="card p-10 text-center">
          <Briefcase className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-medium">No hay puestos cargados</p>
          <p className="text-xs text-gray-400 mt-1">
            Corré <code className="bg-gray-100 px-1 rounded">npm run db:seed</code> para cargar el catálogo inicial.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Puesto
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">
                    Características
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">
                    Alcance
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">
                    Notas
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activos.map((p: any) => (
                  <PositionRow key={p.id} position={p} />
                ))}
                {inactivos.map((p: any) => (
                  <PositionRow key={p.id} position={p} inactive />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Leyenda */}
      <div className="card p-4 bg-blue-50 border-blue-200">
        <p className="text-xs font-semibold text-blue-800 mb-2 uppercase tracking-wide">
          Reglas de negocio
        </p>
        <ul className="space-y-1 text-xs text-blue-700">
          <li className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span><strong>Requiere cobertura:</strong> Cajera y Cadete. Al salir de vacaciones se necesita asignar una rotativa.</span>
          </li>
          <li className="flex items-start gap-2">
            <RotateCcw className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span><strong>Rotativo:</strong> No requiere cobertura — es quien cubre a otros. Si tiene asignaciones activas y pide vacaciones, genera conflicto.</span>
          </li>
          <li className="flex items-start gap-2">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span><strong>Alcance específico:</strong> Personal laboratorio y Auditoría son habituales solo en algunas sucursales.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function PositionRow({ position: p, inactive }: { position: any; inactive?: boolean }) {
  const scopeNames = p.branchScopes
    ?.map((s: any) => s.branch?.name ?? s.branchId)
    .join(", ");

  return (
    <tr className={cn("hover:bg-gray-50 transition-colors", inactive && "opacity-50")}>
      <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <div className="flex items-center gap-2 flex-wrap">
          {p.requiresCoverage && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
              <AlertTriangle className="w-2.5 h-2.5" />
              Req. cobertura
            </span>
          )}
          {p.isRotatingRole && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">
              <RotateCcw className="w-2.5 h-2.5" />
              Rotativo
            </span>
          )}
          {!p.requiresCoverage && !p.isRotatingRole && (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
        {p.scope === "SPECIFIC" && scopeNames ? (
          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] font-medium">
            {scopeNames}
          </span>
        ) : (
          <span className="text-gray-400">Todas</span>
        )}
      </td>
      <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-400 max-w-xs truncate">
        {p.notes ?? "—"}
      </td>
      <td className="px-4 py-3 text-center">
        {p.active
          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
          : <XCircle    className="w-4 h-4 text-gray-300 mx-auto" />
        }
      </td>
    </tr>
  );
}
