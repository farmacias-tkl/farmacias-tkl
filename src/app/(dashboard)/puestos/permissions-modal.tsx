"use client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Search, Loader2, AlertTriangle } from "lucide-react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { cn } from "@/lib/utils";

type Scope = "OWN_BRANCH" | "ALL_BRANCHES";

interface CatalogPermission {
  id:          string;
  key:         string;
  module:      string;
  description: string;
}

interface CatalogModule {
  module:      string;
  permissions: CatalogPermission[];
}

interface AssignedPermission {
  permissionId: string;
  key:          string;
  module:       string;
  description:  string;
  scope:        Scope;
}

interface Props {
  positionId:   string;
  positionName: string;
  canEdit:      boolean;
  onClose:      () => void;
}

const SCOPE_LABELS: Record<Scope, string> = {
  OWN_BRANCH:   "Propia sucursal",
  ALL_BRANCHES: "Todas las sucursales",
};

export function PermissionsModal({ positionId, positionName, canEdit, onClose }: Props) {
  const qc = useQueryClient();
  const [search,    setSearch]    = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error,     setError]     = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<{ permissionId: string; key: string } | null>(null);

  const { data: catalogRes, isLoading: loadingCatalog } = useQuery<{ data: CatalogModule[] }>({
    queryKey: ["permissions-catalog"],
    queryFn:  async () => {
      const res = await fetch("/api/permissions");
      if (!res.ok) throw new Error("Error al cargar catalogo");
      return res.json();
    },
  });

  const { data: assignedRes, isLoading: loadingAssigned } = useQuery<{ data: AssignedPermission[] }>({
    queryKey: ["position-permissions", positionId],
    queryFn:  async () => {
      const res = await fetch(`/api/positions/${positionId}/permissions`);
      if (!res.ok) throw new Error("Error al cargar permisos del puesto");
      return res.json();
    },
  });

  const catalog = catalogRes?.data ?? [];
  const assignedMap = useMemo(() => {
    const m = new Map<string, AssignedPermission>();
    for (const a of assignedRes?.data ?? []) m.set(a.permissionId, a);
    return m;
  }, [assignedRes]);

  // Filtro in-memory por search (key + description)
  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog
      .map(group => ({
        module:      group.module,
        permissions: group.permissions.filter(p =>
          p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
        ),
      }))
      .filter(group => group.permissions.length > 0);
  }, [catalog, search]);

  const totalAssigned = assignedMap.size;
  const totalCatalog  = catalog.reduce((acc, g) => acc + g.permissions.length, 0);

  const handleClose = () => {
    qc.invalidateQueries({ queryKey: ["positions"] }); // refresca count en la tabla
    onClose();
  };

  // Asignar o cambiar scope (POST upsert)
  const upsert = async (permissionId: string, scope: Scope, key: string) => {
    setError("");
    setSavingKey(key);
    try {
      const res = await fetch(`/api/positions/${positionId}/permissions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ permissionId, scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al guardar");
      qc.invalidateQueries({ queryKey: ["position-permissions", positionId] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  };

  // Revocar (DELETE) — disparado desde el ConfirmModal
  const revoke = async (permissionId: string, key: string) => {
    setError("");
    setSavingKey(key);
    try {
      const res = await fetch(`/api/positions/${positionId}/permissions/${permissionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Error al revocar");
      }
      qc.invalidateQueries({ queryKey: ["position-permissions", positionId] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingKey(null);
      setConfirmRevoke(null);
    }
  };

  const handleToggle = (p: CatalogPermission) => {
    if (!canEdit) return;
    const isAssigned = assignedMap.has(p.id);
    if (isAssigned) {
      setConfirmRevoke({ permissionId: p.id, key: p.key });
    } else {
      upsert(p.id, "OWN_BRANCH", p.key);
    }
  };

  const handleScopeChange = (p: CatalogPermission, newScope: Scope) => {
    if (!canEdit) return;
    upsert(p.id, newScope, p.key);
  };

  const isLoading = loadingCatalog || loadingAssigned;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="card p-0 w-full max-w-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-gray-100">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Permisos del puesto</h3>
              <p className="text-base font-medium text-gray-800 mt-0.5 truncate">{positionName}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {totalAssigned} de {totalCatalog} permisos asignados
              </p>
            </div>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 shrink-0 ml-3">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Read-only banner */}
          {!canEdit && (
            <div className="px-5 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
              Solo lectura — no podes modificar permisos.
            </div>
          )}

          {/* Buscador */}
          <div className="px-5 py-3 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar permiso por nombre o descripcion..."
                className="input pl-9 w-full text-sm"
              />
            </div>
          </div>

          {/* Error global */}
          {error && (
            <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />Cargando permisos...
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                {search ? "Sin coincidencias" : "Sin permisos en el catalogo"}
              </div>
            ) : (
              <div className="space-y-5">
                {filteredCatalog.map(group => {
                  const groupAssigned = group.permissions.filter(p => assignedMap.has(p.id)).length;
                  return (
                    <div key={group.module}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                          {group.module}
                        </span>
                        <span className="text-xs text-gray-400">
                          {groupAssigned} de {group.permissions.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {group.permissions.map(p => {
                          const assigned = assignedMap.get(p.id);
                          const saving   = savingKey === p.key;
                          return (
                            <div
                              key={p.id}
                              className={cn(
                                "flex items-start gap-3 px-3 py-2 rounded-lg border transition-colors",
                                assigned ? "bg-emerald-50/50 border-emerald-200" : "bg-white border-gray-200",
                                !canEdit && "opacity-90"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={!!assigned}
                                disabled={!canEdit || saving}
                                onChange={() => handleToggle(p)}
                                className="mt-0.5 w-4 h-4 rounded cursor-pointer disabled:cursor-not-allowed"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-mono text-gray-900">{p.key}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                              </div>
                              {assigned && (
                                <select
                                  value={assigned.scope}
                                  disabled={!canEdit || saving}
                                  onChange={e => handleScopeChange(p, e.target.value as Scope)}
                                  className="input text-xs py-1 px-2 w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <option value="OWN_BRANCH">{SCOPE_LABELS.OWN_BRANCH}</option>
                                  <option value="ALL_BRANCHES">{SCOPE_LABELS.ALL_BRANCHES}</option>
                                </select>
                              )}
                              {saving && (
                                <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0 mt-1" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end px-5 py-3 border-t border-gray-100">
            <button onClick={handleClose} className="btn-secondary">Cerrar</button>
          </div>
        </div>
      </div>

      {/* Confirm modal de revoke */}
      <ConfirmModal
        open={!!confirmRevoke}
        title="Revocar permiso"
        message={confirmRevoke
          ? `Vas a revocar el permiso "${confirmRevoke.key}" del puesto "${positionName}". Los empleados con este puesto perderan la accion correspondiente.`
          : ""}
        variant="warning"
        confirmLabel="Revocar"
        loading={savingKey === confirmRevoke?.key}
        onConfirm={() => confirmRevoke && revoke(confirmRevoke.permissionId, confirmRevoke.key)}
        onCancel={() => setConfirmRevoke(null)}
      />
    </>
  );
}
