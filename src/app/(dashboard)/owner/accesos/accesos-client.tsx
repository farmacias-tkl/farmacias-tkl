"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck, ShieldOff, Info, Users } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

type FilterValue = "all" | "with-access" | "without-access";

interface UserRow {
  id:              string;
  name:            string;
  email:           string;
  role:            UserRole;
  executiveAccess: boolean;
  branch:          { id: string; name: string } | null;
}

export function AccessosClient({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");

  const { data, isLoading } = useQuery<{ data: UserRow[] }>({
    queryKey: ["owner-access", { search, filter }],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (filter !== "all") p.set("filter", filter);
      const res = await fetch(`/api/owner/access?${p.toString()}`);
      if (!res.ok) throw new Error("Error al cargar usuarios");
      return res.json();
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ userId, value }: { userId: string; value: boolean }) => {
      const res = await fetch(`/api/owner/access/${userId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ executiveAccess: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-access"] }),
  });

  const users  = data?.data ?? [];
  const total  = users.length;
  const withAccess = users.filter(u => u.executiveAccess).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Accesos al Dashboard Ejecutivo</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {total} usuarios · {withAccess} con acceso ejecutivo
        </p>
      </div>

      {/* Banner informativo */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-3">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 leading-relaxed">
          Los cambios pueden tardar hasta 8 horas en propagarse a sesiones activas.
          Para revocacion inmediata, comunica al usuario que cierre sesion.
          Los usuarios con rol Direccion (OWNER) tienen acceso siempre, no se puede modificar.
        </div>
      </div>

      {/* Error de mutación */}
      {toggle.isError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(toggle.error as Error).message}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="input pl-9 w-64"
          />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as FilterValue)} className="input w-auto">
          <option value="all">Todos</option>
          <option value="with-access">Con acceso ejecutivo</option>
          <option value="without-access">Sin acceso ejecutivo</option>
        </select>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="card p-4 h-14 animate-pulse bg-gray-50" />)}
        </div>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No hay usuarios con los filtros aplicados.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Usuario</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rol</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sucursal</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Acceso ejecutivo</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Accion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => {
                const isOwner   = u.role === "OWNER";
                const isSelf    = u.id === currentUserId;
                const cantToggle= isOwner || isSelf;
                const tooltip   = isOwner ? "OWNER tiene acceso siempre" : isSelf ? "No podes modificar tu propio acceso" : undefined;

                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", ROLE_COLORS[u.role])}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {u.branch?.name ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.executiveAccess
                        ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <ShieldCheck className="w-3 h-3" />Otorgado
                          </span>
                        : <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            <ShieldOff className="w-3 h-3" />Sin acceso
                          </span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggle.mutate({ userId: u.id, value: !u.executiveAccess })}
                        disabled={cantToggle || toggle.isPending}
                        title={tooltip}
                        className={cn(
                          "btn-secondary text-xs py-1 px-2.5",
                          cantToggle && "opacity-40 cursor-not-allowed",
                          !cantToggle && u.executiveAccess && "text-red-700 border-red-300 hover:bg-red-50",
                          !cantToggle && !u.executiveAccess && "text-emerald-700 border-emerald-300 hover:bg-emerald-50",
                        )}
                      >
                        {u.executiveAccess ? "Revocar" : "Otorgar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
