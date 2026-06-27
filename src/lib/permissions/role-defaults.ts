/**
 * Defaults de permisos POR ROL (refactor permisos-por-usuario, Fase 1C).
 *
 * Estos defaults son una SEMILLA DE CREACIÓN: la lista de permisos que se debería
 * crear UNA SOLA VEZ al dar de alta un usuario nuevo (en una fase posterior, vía
 * filas UserPermission). NO se usan para autorizar acciones en runtime — la
 * autorización la hacen los helpers de user-permissions.ts sobre las filas
 * EFECTIVAS del usuario (que el OWNER/ADMIN pueden editar después).
 *
 * Esta fase NO crea filas UserPermission, NO toca usuarios reales, NO toca endpoints.
 * Solo define el mapa y una lectura pura.
 *
 * ── Alcance ────────────────────────────────────────────────────────────────
 * Este mapa cubre SOLO módulos que ya se construyen sobre user-permissions
 * en este refactor (hoy: caja.*).
 *
 * Cada módulo legacy agregará sus defaults AQUÍ cuando migre a user-permissions,
 * en la misma fase que su migración, nunca antes. Un default cuyo módulo todavía
 * se gobierna por rol no haría nada y podría desactualizarse en silencio.
 *
 * Regla permanente: los permisos críticos (caja.edit_close, caja.export y futuros
 * equivalentes) NUNCA son default; se asignan explícitamente.
 */
import type { UserRole, PermissionScope } from "@prisma/client";

export interface DefaultPermissionGrant {
  key: string;
  scope: PermissionScope;
}

// Defaults por rol. Solo caja.* en esta fase (ver "Alcance" arriba).
// - BRANCH_MANAGER: ve / carga-cierra / adjunta en SU sucursal (OWN_BRANCH).
// - SUPERVISOR:     ve / carga-cierra / adjunta en TODAS las sucursales (ALL_BRANCHES).
// - ADMIN:          solo VISUALIZA cajas de todas las sucursales (caja.view ALL_BRANCHES).
//                   No recibe create_close/attach_doc/edit_close/export por default.
// - OWNER:          sin defaults (tiene override operativo superior).
// - HR / MAINTENANCE: sin permisos de Cajas por default.
// caja.edit_close y caja.export (críticos) NO son default de ningún rol.
const ROLE_DEFAULTS_INTERNAL: Record<UserRole, readonly DefaultPermissionGrant[]> = {
  BRANCH_MANAGER: [
    { key: "caja.view", scope: "OWN_BRANCH" },
    { key: "caja.create_close", scope: "OWN_BRANCH" },
    { key: "caja.attach_doc", scope: "OWN_BRANCH" },
  ],
  SUPERVISOR: [
    { key: "caja.view", scope: "ALL_BRANCHES" },
    { key: "caja.create_close", scope: "ALL_BRANCHES" },
    { key: "caja.attach_doc", scope: "ALL_BRANCHES" },
  ],
  ADMIN: [
    { key: "caja.view", scope: "ALL_BRANCHES" },
  ],
  OWNER: [],
  HR: [],
  MAINTENANCE: [],
};

/** Mapa público de defaults por rol (lectura). Para una copia mutable usar getDefaultPermissionsForRole. */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly DefaultPermissionGrant[]> =
  ROLE_DEFAULTS_INTERNAL;

/**
 * Devuelve los defaults de creación para un rol, como COPIA DEFENSIVA (array y
 * objetos nuevos) en orden estable. Mutar el resultado no afecta el mapa interno.
 * Función pura: no consulta DB ni usa Prisma runtime.
 */
export function getDefaultPermissionsForRole(role: UserRole): DefaultPermissionGrant[] {
  const defaults = ROLE_DEFAULTS_INTERNAL[role] ?? [];
  return defaults.map((g) => ({ key: g.key, scope: g.scope }));
}

/** ¿El rol tiene esta key entre sus defaults? (helper de conveniencia/test). */
export function hasDefaultPermission(role: UserRole, key: string): boolean {
  return (ROLE_DEFAULTS_INTERNAL[role] ?? []).some((g) => g.key === key);
}
