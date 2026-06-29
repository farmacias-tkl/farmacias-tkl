"use client";

/**
 * Panel inline de permisos por usuario (refactor permisos-por-usuario, Fase 2D).
 *
 * Componente COMPARTIDO entre el editar de Owner y el detalle de Admin. Consume los
 * endpoints 2C-B (GET/POST/DELETE /api/users/[id]/permissions) + el catálogo
 * (GET /api/permissions). Se monta detrás del feature flag
 * NEXT_PUBLIC_USER_PERMISSIONS_PANEL_ENABLED en cada pantalla.
 *
 * El BACKEND es la fuente de verdad: estos guardrails de UI solo evitan intentos
 * que el servicio (user-permissions-admin) ya rechazaría. Guardrails verificados
 * contra el código real de canManageUserPermissions/canGrant/canRevoke (Fase 2D-prep §2.8).
 *
 * Alcance 2D: el catálogo ASIGNABLE se limita a module === "caja". Los grants
 * ACTUALES se muestran completos (cualquier módulo) para no esconder/impedir revocar
 * un permiso fuera del catálogo inicial.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isCriticalPermission } from "@/lib/permissions/user-permissions";
import type { UserRole } from "@prisma/client";

type Scope = "OWN_BRANCH" | "ALL_BRANCHES";

export type UserPermissionsPanelProps = {
  actorContext: "owner" | "admin";
  actorUserId: string;
  targetUserId: string;
  targetBranchId: string | null;
  targetRole: UserRole;
  targetActive: boolean;
};

interface CatalogPerm {
  id: string;
  key: string;
  module: string;
  description: string;
}
interface CatalogGroup {
  module: string;
  permissions: CatalogPerm[];
}
interface GrantRow {
  permissionId: string;
  key: string;
  module: string;
  description: string;
  permissionActive: boolean;
  scope: Scope;
  grantedByUserId: string | null;
}

const SCOPE_LABEL: Record<Scope, string> = {
  OWN_BRANCH: "Sucursal propia",
  ALL_BRANCHES: "Todas las sucursales",
};

export function UserPermissionsPanel(props: UserPermissionsPanelProps) {
  const { actorContext, actorUserId, targetUserId, targetBranchId, targetRole, targetActive } = props;
  const qc = useQueryClient();
  const [flash, setFlash] = useState<{ kind: "ok" | "err" | "noop"; msg: string } | null>(null);
  const [scopeDraft, setScopeDraft] = useState<Record<string, Scope>>({});

  // ── Bloqueos de actor (ANTES de cualquier fetch) ──────────────────────────
  const blockedReason: string | null =
    targetActive === false
      ? "Usuario inactivo: reactivarlo antes de administrar permisos."
      : actorContext === "admin" && targetRole === "OWNER"
        ? "Un administrador no puede administrar permisos de OWNER."
        : actorContext === "admin" && targetRole === "ADMIN" && actorUserId !== targetUserId
          ? "Un administrador no puede administrar permisos de otro ADMIN."
          : null;
  const blocked = blockedReason !== null;

  // ADMIN editándose a sí mismo: panel visible, pero críticos bloqueados.
  const isSelfAdmin =
    actorContext === "admin" && targetRole === "ADMIN" && actorUserId === targetUserId;

  const ownBranchDisabled = targetBranchId === null;

  // ── Datos (solo si el panel no está bloqueado) ────────────────────────────
  const catalogQ = useQuery<{ data: CatalogGroup[] }>({
    queryKey: ["permissions-catalog"],
    queryFn: async () => {
      const res = await fetch("/api/permissions");
      if (!res.ok) throw new Error("Error al cargar catálogo");
      return res.json();
    },
    enabled: !blocked,
  });

  const grantsQ = useQuery<{ data: GrantRow[] }>({
    queryKey: ["user-permissions", targetUserId],
    queryFn: async () => {
      const res = await fetch(`/api/users/${targetUserId}/permissions`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Error al cargar permisos");
      }
      return res.json();
    },
    enabled: !blocked,
  });

  const grants = grantsQ.data?.data ?? [];
  const grantByKey = new Map(grants.map((g) => [g.key, g]));
  const cajaCatalog = (catalogQ.data?.data ?? [])
    .filter((g) => g.module === "caja")
    .flatMap((g) => g.permissions);
  // Catch-all: TODO grant que NO se muestra en la sección principal de Caja (por key
  // del catálogo activo). Cubre no-caja, y también caja inactivo/fuera del catálogo
  // (cuyo Permission.active=false ya no vuelve en /api/permissions). Así ningún grant
  // queda invisible ni imposible de revocar.
  const shownKeys = new Set(cajaCatalog.map((p) => p.key));
  const extraGrants = grants.filter((g) => !shownKeys.has(g.key));

  const refresh = () => qc.invalidateQueries({ queryKey: ["user-permissions", targetUserId] });

  const grantMut = useMutation({
    mutationFn: async (vars: { permissionKey: string; scope: Scope }) => {
      const res = await fetch(`/api/users/${targetUserId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, json };
    },
    onSuccess: ({ ok, json }) => {
      if (!ok) { setFlash({ kind: "err", msg: json.error ?? "Error" }); return; }
      if (json.change === "NOOP") { setFlash({ kind: "noop", msg: "Sin cambios" }); return; }
      setFlash({ kind: "ok", msg: json.change === "SCOPE_CHANGED" ? "Alcance actualizado" : "Permiso asignado" });
      refresh();
    },
    onError: () => setFlash({ kind: "err", msg: "Error inesperado" }),
  });

  const revokeMut = useMutation({
    mutationFn: async (vars: { permissionId: string }) => {
      const res = await fetch(`/api/users/${targetUserId}/permissions/${vars.permissionId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, json };
    },
    onSuccess: ({ ok, json }) => {
      if (!ok) { setFlash({ kind: "err", msg: json.error ?? "Error" }); return; }
      setFlash({ kind: "ok", msg: "Permiso revocado" });
      refresh();
    },
    onError: () => setFlash({ kind: "err", msg: "Error inesperado" }),
  });

  const busy = grantMut.isPending || revokeMut.isPending;

  function effectiveScope(key: string, current?: Scope): Scope {
    const draft = scopeDraft[key];
    if (draft) return draft;
    if (current) return current;
    return ownBranchDisabled ? "ALL_BRANCHES" : "OWN_BRANCH";
  }

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Permisos del usuario</h3>
        <p className="text-xs text-gray-400">
          Asignación fina de permisos operativos. El backend valida cada acción.
        </p>
      </div>

      {blocked ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
          {blockedReason}
        </div>
      ) : (
        <>
          {flash && (
            <div
              className={
                "rounded-lg px-3 py-2 text-xs border " +
                (flash.kind === "err"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : flash.kind === "noop"
                    ? "bg-gray-50 border-gray-200 text-gray-600"
                    : "bg-green-50 border-green-200 text-green-700")
              }
            >
              {flash.msg}
            </div>
          )}

          {ownBranchDisabled && (
            <p className="text-xs text-gray-500">
              El alcance “Sucursal propia” requiere que el usuario tenga una sucursal asignada.
            </p>
          )}

          {/* ── Catálogo asignable: Caja ─────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Permisos de Caja</p>
            {catalogQ.isLoading || grantsQ.isLoading ? (
              <p className="text-xs text-gray-400">Cargando...</p>
            ) : catalogQ.isError ? (
              <p className="text-xs text-red-600">{(catalogQ.error as Error)?.message ?? "Error al cargar catálogo"}</p>
            ) : grantsQ.isError ? (
              <p className="text-xs text-red-600">{(grantsQ.error as Error)?.message ?? "Error al cargar permisos"}</p>
            ) : cajaCatalog.length === 0 ? (
              <p className="text-xs text-gray-400">No hay permisos de Caja en el catálogo.</p>
            ) : (
              cajaCatalog.map((p) => {
                const g = grantByKey.get(p.key);
                const critical = isCriticalPermission(p.key);
                const criticalLocked = isSelfAdmin && critical;
                const sel = effectiveScope(p.key, g?.scope);
                const scopeInvalid = sel === "OWN_BRANCH" && ownBranchDisabled;
                const changed = g ? sel !== g.scope : true;
                const actionDisabled = busy || criticalLocked || scopeInvalid || (!!g && !changed);
                return (
                  <div key={p.key} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">
                        {p.description}
                        {critical && (
                          <span className="ml-1.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                            crítico
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400 font-mono">
                        {p.key}{g ? ` · asignado (${SCOPE_LABEL[g.scope]})` : ""}
                      </p>
                      {criticalLocked && (
                        <p className="text-[11px] text-amber-700">
                          No podés autoasignarte ni autorevocarte permisos críticos.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        value={sel}
                        disabled={busy || criticalLocked}
                        onChange={(e) => setScopeDraft((d) => ({ ...d, [p.key]: e.target.value as Scope }))}
                        className="input text-xs py-1 px-2 w-auto disabled:opacity-50"
                      >
                        <option value="OWN_BRANCH" disabled={ownBranchDisabled}>{SCOPE_LABEL.OWN_BRANCH}</option>
                        <option value="ALL_BRANCHES">{SCOPE_LABEL.ALL_BRANCHES}</option>
                      </select>
                      <button
                        type="button"
                        disabled={actionDisabled}
                        onClick={() => grantMut.mutate({ permissionKey: p.key, scope: sel })}
                        className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
                      >
                        {g ? "Cambiar alcance" : "Asignar"}
                      </button>
                      {g && (
                        <button
                          type="button"
                          disabled={busy || criticalLocked}
                          onClick={() => revokeMut.mutate({ permissionId: g.permissionId })}
                          className="btn-secondary text-xs py-1 px-2 text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-40"
                        >
                          Revocar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Grants no mostrados arriba (no-caja, o caja fuera del catálogo activo) ── */}
          {extraGrants.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Otros permisos asignados
              </p>
              {extraGrants.map((g) => {
                const critical = isCriticalPermission(g.key);
                const criticalLocked = isSelfAdmin && critical;
                return (
                  <div key={g.permissionId} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">
                        {g.description}
                        <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                          fuera del catálogo inicial
                        </span>
                        {!g.permissionActive && (
                          <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                            permiso inactivo
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400 font-mono">
                        {g.key} · {g.module} · {SCOPE_LABEL[g.scope]}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || criticalLocked}
                      onClick={() => revokeMut.mutate({ permissionId: g.permissionId })}
                      className="btn-secondary text-xs py-1 px-2 text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-40 shrink-0"
                    >
                      Revocar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
