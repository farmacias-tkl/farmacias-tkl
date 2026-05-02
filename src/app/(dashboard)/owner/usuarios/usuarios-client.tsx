"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Plus, Search, CheckCircle2, XCircle,
  KeyRound,
} from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { ConfirmModal } from "@/components/ConfirmModal";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["OWNER","ADMIN","SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"];

interface UserRow {
  id:                 string;
  name:               string;
  email:              string;
  role:               UserRole;
  active:             boolean;
  mustChangePassword: boolean;
  executiveAccess:    boolean;
  branch:             { id: string; name: string } | null;
}

export function UsuariosClient({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [branchFilter, setBranchFilter] = useState("");
  const [resetResult,  setResetResult]  = useState<{name: string; password: string} | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserRow | null>(null);
  const [actionError,  setActionError]  = useState("");

  const { data: usersData, isLoading } = useQuery({
    queryKey: ["owner-users", { search, roleFilter, activeFilter, branchFilter }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "50",
        ...(search       && { search }),
        ...(roleFilter   && { role: roleFilter }),
        ...(activeFilter && { active: activeFilter }),
        ...(branchFilter && { branchId: branchFilter }),
      });
      const res = await fetch(`/api/owner/users?${p}`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
  });

  const users    = usersData?.data ?? [];
  const total    = usersData?.meta?.total ?? 0;
  const branches = branchRes?.data ?? [];

  const toggleActive = async (u: UserRow) => {
    setActionError("");
    const newActive = !u.active;
    const res = await fetch(`/api/owner/users/${u.id}/toggle-active`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ active: newActive }),
    });
    const json = await res.json();
    if (!res.ok) {
      setActionError(json.error ?? "Error al cambiar estado");
      return;
    }
    qc.invalidateQueries({ queryKey: ["owner-users"] });
    setConfirmDeactivate(null);
  };

  const handleToggleClick = (u: UserRow) => {
    // Si es OWNER y se va a desactivar, pedir confirmacion fuerte
    if (u.role === "OWNER" && u.active) {
      setConfirmDeactivate(u);
      return;
    }
    toggleActive(u);
  };

  const resetPassword = async (id: string, name: string) => {
    setActionError("");
    const res  = await fetch(`/api/owner/users/${id}/reset-password`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setActionError(json.error ?? "Error al resetear contrasena");
      return;
    }
    setResetResult({ name, password: json.temporaryPassword });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Gestion de Usuarios</h2>
          <p className="text-sm text-gray-500 mt-0.5">{total} usuarios — incluye OWNER y ADMIN</p>
        </div>
        <Link href="/owner/usuarios/nuevo" className="btn-primary">
          <Plus className="w-4 h-4" />Nuevo usuario
        </Link>
      </div>

      {/* Reset-password result */}
      {resetResult && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-4">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 mb-1">
                Contrasena reseteada para {resetResult.name}
              </p>
              <p className="text-xs text-amber-700 mb-2">
                Contrasena temporal (visible una sola vez). Comunicasela al usuario:
              </p>
              <code className="block bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-amber-900 tracking-wider select-all">
                {resetResult.password}
              </code>
              <p className="text-xs text-amber-600 mt-2">
                El usuario debera cambiarla en su proximo ingreso.
              </p>
            </div>
            <button onClick={() => setResetResult(null)} className="text-amber-400 hover:text-amber-600 text-lg">×</button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionError}
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
              {users.map((u: UserRow) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className={cn("hover:bg-gray-50 transition-colors", !u.active && "opacity-60")}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                      {u.mustChangePassword && (
                        <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                          Debe cambiar contrasena
                        </span>
                      )}
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
                      {u.active
                        ? <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />Activo
                          </span>
                        : <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            <XCircle className="w-3 h-3" />Inactivo
                          </span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/owner/usuarios/${u.id}`} className="btn-secondary text-xs py-1 px-2.5">
                          Editar
                        </Link>
                        <button
                          onClick={() => resetPassword(u.id, u.name)}
                          disabled={!u.active}
                          title={u.active ? "Resetear contrasena" : "Usuario inactivo — no se puede resetear"}
                          className={cn("btn-secondary text-xs py-1 px-2 text-amber-700 border-amber-300 hover:bg-amber-50", !u.active && "opacity-40 cursor-not-allowed")}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleClick(u)}
                          disabled={isSelf}
                          title={isSelf ? "No podes desactivarte a vos mismo" : (u.active ? "Desactivar" : "Activar")}
                          className={cn("btn-secondary text-xs py-1 px-2",
                            isSelf && "opacity-40 cursor-not-allowed",
                            !isSelf && u.active  && "text-red-600 border-red-300 hover:bg-red-50",
                            !isSelf && !u.active && "text-green-700 border-green-300 hover:bg-green-50")}
                        >
                          {u.active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: confirmar desactivacion de OWNER */}
      <ConfirmModal
        open={!!confirmDeactivate}
        title="Desactivar usuario OWNER"
        message={confirmDeactivate
          ? `Estás por desactivar a ${confirmDeactivate.name}, un usuario con permisos de Direccion. Esta accion puede afectar el acceso al sistema.`
          : ""}
        variant="warning"
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        onConfirm={() => confirmDeactivate && toggleActive(confirmDeactivate)}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </div>
  );
}
