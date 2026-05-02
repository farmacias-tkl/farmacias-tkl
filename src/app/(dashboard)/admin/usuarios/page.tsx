"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users, Plus, Search, CheckCircle2, XCircle,
  ShieldCheck, KeyRound, ChevronDown, ChevronUp,
} from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["ADMIN","OWNER","SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"];

export default function UsuariosPage() {
  const { data: session, status } = useSession();
  const qc = useQueryClient();

  const [search,      setSearch]      = useState("");
  const [roleFilter,  setRoleFilter]  = useState("");
  const [activeFilter,setActiveFilter]= useState("true");
  const [branchFilter,setBranchFilter]= useState("");
  const [resetResult, setResetResult] = useState<{name:string; password:string} | null>(null);

  const sessionReady = status === "authenticated";

  const { data: usersData, isLoading } = useQuery({
    queryKey: ["admin-users", { search, roleFilter, activeFilter, branchFilter }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "50",
        ...(search       && { search }),
        ...(roleFilter   && { role: roleFilter }),
        ...(activeFilter && { active: activeFilter }),
        ...(branchFilter && { branchId: branchFilter }),
      });
      const res = await fetch(`/api/admin/users?${p}`);
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

  const users    = usersData?.data ?? [];
  const total    = usersData?.meta?.total ?? 0;
  const branches = branchRes?.data ?? [];

  const toggleActive = async (id: string, current: boolean) => {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !current }),
    });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const resetPassword = async (id: string, name: string) => {
    const res  = await fetch(`/api/admin/users/${id}/reset-password`, { method: "POST" });
    const json = await res.json();
    if (res.ok) setResetResult({ name, password: json.temporaryPassword });
  };

  if (status === "loading") return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Usuarios</h2>
          <p className="text-sm text-gray-500 mt-0.5">{total} usuarios</p>
        </div>
        <Link href="/admin/usuarios/nuevo" className="btn-primary">
          <Plus className="w-4 h-4" />Nuevo usuario
        </Link>
      </div>

      {/* Resultado de reset — visible una sola vez */}
      {resetResult && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-4">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 mb-1">
                Contraseña reseteada para {resetResult.name}
              </p>
              <p className="text-xs text-amber-700 mb-2">
                Contraseña temporal (visible una sola vez). Comunícasela al usuario:
              </p>
              <code className="block bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-amber-900 tracking-wider select-all">
                {resetResult.password}
              </code>
              <p className="text-xs text-amber-600 mt-2">
                El usuario deberá cambiarla en su próximo ingreso.
              </p>
            </div>
            <button onClick={() => setResetResult(null)} className="text-amber-400 hover:text-amber-600 text-lg">×</button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="input pl-9 w-64" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input w-auto">
          <option value="">Todos los roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto">
          <option value="">Todas las sucursales</option>
          {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)} className="input w-auto">
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
          <option value="">Todos</option>
        </select>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-14 animate-pulse bg-gray-50" />)}</div>
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
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u: any) => (
                <tr key={u.id} className={cn("hover:bg-gray-50 transition-colors", !u.active && "opacity-60")}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                    {u.mustChangePassword && (
                      <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                        Debe cambiar contraseña
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", ROLE_COLORS[u.role as UserRole])}>
                      {ROLE_LABELS[u.role as UserRole]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {u.branch?.name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.active
                      ? <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />Activo
                        </span>
                      : <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3" />Inactivo
                        </span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/admin/usuarios/${u.id}`}
                        className="btn-secondary text-xs py-1 px-2.5">
                        Editar
                      </Link>
                      <button onClick={() => resetPassword(u.id, u.name)}
                        title="Resetear contraseña"
                        className="btn-secondary text-xs py-1 px-2 text-amber-700 border-amber-300 hover:bg-amber-50">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleActive(u.id, u.active)}
                        title={u.active ? "Desactivar" : "Activar"}
                        className={cn("btn-secondary text-xs py-1 px-2",
                          u.active ? "text-red-600 border-red-300 hover:bg-red-50"
                                   : "text-green-700 border-green-300 hover:bg-green-50")}>
                        {u.active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

