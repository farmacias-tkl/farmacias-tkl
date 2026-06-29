/**
 * Helpers de permisos POR USUARIO (refactor permisos-por-usuario, Fase 1B).
 *
 * Reemplaza conceptualmente a position-permissions.ts: los permisos efectivos
 * cuelgan del USUARIO (UserPermission), no del puesto. Coexiste con el legacy
 * durante la transición; NO modifica position-permissions.ts ni permissions.ts.
 *
 * Estos helpers son PUROS: operan sobre un objeto-usuario ya cargado (la query
 * loadUserWithUserPermissions vendrá en una fase posterior). Por eso se testean
 * in-memory, sin DB ni Prisma real (ver user-permissions.test.ts).
 *
 * Distinción central (decisión cerrada):
 *  - OWNER  → override OPERATIVO superior + bypass administrativo.
 *  - ADMIN  → bypass ADMINISTRATIVO, pero NO override operativo (necesita permiso
 *             explícito para acciones operativas).
 *  - SUPERVISOR / resto → sin override; solo permisos explícitos.
 *
 * Regla active-first (decisión cerrada): si user.active === false, NINGÚN helper
 * autoriza nada. Se evalúa ANTES que rol o permisos.
 *
 * Regla de visualización (NO implementada acá, sin tocar rutas/layouts):
 *   ADMIN debe poder visualizar todo el sistema operativo y administrativo,
 *   EXCEPTO el Dashboard Ejecutivo. Dashboard Ejecutivo = OWNER-only
 *   (sigue gobernado por canViewExecutive en permissions.ts legacy).
 */
import type { UserRole, PermissionScope } from "@prisma/client";

// ============================================================================
// Tipos
// ============================================================================

/** Usuario con sus permisos por-usuario cargados (shape para los helpers operativos). */
export interface UserWithUserPermissions {
  id: string;
  role: UserRole;
  active: boolean;
  /** Fuente CANÓNICA de la sucursal propia (OWN_BRANCH). */
  branchId: string | null;
  /** Fallback TRANSITORIO de compatibilidad (Employee.currentBranchId). No re-acoplar a RRHH. */
  employeeCurrentBranchId?: string | null;
  permissions: Array<{
    scope: PermissionScope;
    permission: {
      key: string;
      active: boolean;
    };
  }>;
}

/** Shape mínimo para reglas administrativas (actor / target). */
export interface MinimalUser {
  id: string;
  role: UserRole;
  active: boolean;
}

// ============================================================================
// Permisos críticos
//
// Lo NO listado acá se considera permiso NORMAL por ahora. Agregar una key nueva
// como crítica EXIGE sumarla a este set (fuente única). NO hardcodear keys
// críticas dispersas en los helpers.
// ============================================================================
export const CRITICAL_PERMISSION_KEYS = new Set<string>([
  "caja.edit_close",
  "caja.export",
]);

export function isCriticalPermission(permissionKey: string): boolean {
  return CRITICAL_PERMISSION_KEYS.has(permissionKey);
}

// ============================================================================
// Resolución de sucursal propia
//
// User.branchId es la fuente CANÓNICA. Employee.currentBranchId es fallback
// TRANSITORIO solo para compatibilidad mientras se migra. No re-acoplar permisos
// a RRHH: el fallback se removerá en una fase posterior.
// ============================================================================
export function getOwnBranchId(
  user: Pick<UserWithUserPermissions, "branchId" | "employeeCurrentBranchId"> | null | undefined,
): string | null {
  if (!user) return null;
  return user.branchId ?? user.employeeCurrentBranchId ?? null;
}

// ============================================================================
// Helpers OPERATIVOS
// ============================================================================

/** Busca un permiso ACTIVO por key en el usuario. */
function findActivePermission(
  user: UserWithUserPermissions,
  permissionKey: string,
): UserWithUserPermissions["permissions"][number] | undefined {
  return user.permissions.find(
    (p) => p.permission.active && p.permission.key === permissionKey,
  );
}

/**
 * ¿El usuario tiene el permiso (a nivel módulo, sin sucursal)?
 * Orden: null → false · inactive → false · OWNER → true · permiso explícito activo.
 * ADMIN/SUPERVISOR NO tienen override operativo: necesitan el permiso explícito.
 */
export function canUser(
  user: UserWithUserPermissions | null | undefined,
  permissionKey: string,
): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  if (user.role === "OWNER") return true;
  return Boolean(findActivePermission(user, permissionKey));
}

/**
 * ¿El usuario tiene el permiso PARA ESTA sucursal?
 * - ALL_BRANCHES → true en cualquier sucursal.
 * - OWN_BRANCH   → branchId === sucursal propia (User.branchId canónico, Employee fallback).
 */
export function canUserInBranch(
  user: UserWithUserPermissions | null | undefined,
  permissionKey: string,
  branchId: string,
): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  if (user.role === "OWNER") return true;
  const match = findActivePermission(user, permissionKey);
  if (!match) return false;
  if (match.scope === "ALL_BRANCHES") return true;
  // OWN_BRANCH
  const own = getOwnBranchId(user);
  return own !== null && own === branchId;
}

/**
 * Resolución unificada de una acción operativa.
 * - con branchId → delega en canUserInBranch (scope-aware);
 * - sin branchId → delega en canUser (existencia de permiso activo).
 * Mantiene active-first y OWNER override (ambos viven en los delegados).
 */
export function canPerformOperationalAction(
  user: UserWithUserPermissions | null | undefined,
  permissionKey: string,
  branchId?: string,
): boolean {
  return branchId !== undefined
    ? canUserInBranch(user, permissionKey, branchId)
    : canUser(user, permissionKey);
}

/**
 * Para handlers de API. Mismo contrato { error, status } | null que requireCan/requirePermission.
 * - sin user            → 401 "No autenticado"
 * - inactive o sin permiso → 403 "Sin permisos"
 * - autorizado          → null
 */
export function requireUserPermission(
  user: UserWithUserPermissions | null | undefined,
  permissionKey: string,
  branchId?: string,
): { error: string; status: number } | null {
  if (!user) return { error: "No autenticado", status: 401 };
  const ok = canPerformOperationalAction(user, permissionKey, branchId);
  return ok ? null : { error: "Sin permisos", status: 403 };
}

// ============================================================================
// Helpers ADMINISTRATIVOS
//
// Bypass ADMINISTRATIVO (OWNER + ADMIN) ≠ override OPERATIVO (solo OWNER).
// ADMIN no puede tocar OWNER ni otro ADMIN; no puede auto-asignarse/revocarse
// permisos CRÍTICOS (eso lo administra OWNER).
// ============================================================================

/** ¿Puede entrar al área de administración de usuarios? OWNER o ADMIN activos. */
export function canAdministerUsers(actor: MinimalUser | null | undefined): boolean {
  if (!actor) return false;
  if (actor.active === false) return false;
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

/**
 * ¿Este actor activo tiene AUTORIDAD DE GOBIERNO sobre este target?
 *
 * Autoridad PURA (2C-C): NO mira `targetUser.active`. La inactividad del target NO
 * relaja ni concede autoridad; es un gate APARTE que aplican grant (exige activo) y
 * el servicio admin — no este helper. Así, list/revoke operan sobre usuarios
 * inactivos con la MISMA autoridad que sobre activos.
 *
 * OWNER → cualquier target. ADMIN → operativos y a sí mismo; NUNCA OWNER ni otro ADMIN.
 * La inactividad del target tampoco relaja estas reglas de gobierno (un OWNER/ADMIN
 * inactivo sigue intocable para un ADMIN).
 */
export function canManageUserPermissions(
  actor: MinimalUser | null | undefined,
  targetUser: MinimalUser | null | undefined,
): boolean {
  if (!actor || !targetUser) return false;
  if (actor.active === false) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") {
    if (targetUser.role === "OWNER") return false;
    if (targetUser.role === "ADMIN") return targetUser.id === actor.id; // solo a sí mismo
    return true; // operativo
  }
  return false;
}

/**
 * ¿Puede ASIGNAR o CAMBIAR SCOPE de este permiso a este usuario?
 *
 * Parte de la autoridad de gobierno (canManageUserPermissions) y AGREGA dos gates
 * propios de grant/scope-change (2C-C):
 *  - el target DEBE estar activo (otorgar/ampliar sobre un inactivo está bloqueado);
 *  - críticos: ADMIN a sí mismo solo NORMAL (otorgarse un crítico = posible escalada;
 *    lo administra OWNER). A operativos, ADMIN sí puede crítico.
 * Otorgar/ampliar críticos PUEDE ser escalada → la restricción de críticos vive acá,
 * NO en revoke.
 */
export function canGrantUserPermission(
  actor: MinimalUser | null | undefined,
  targetUser: MinimalUser | null | undefined,
  permissionKey: string,
): boolean {
  if (!canManageUserPermissions(actor, targetUser)) return false;
  if (!actor || !targetUser) return false;       // narrowing (canManage ya lo garantiza)
  if (targetUser.active === false) return false;  // grant/scope-change exige target activo
  if (actor.role === "OWNER") return true;
  // ADMIN con autoridad: a sí mismo solo NORMAL; a operativos, normal o crítico.
  if (targetUser.id === actor.id) return !isCriticalPermission(permissionKey);
  return true; // operativo
}

/**
 * ¿Puede REVOCAR este permiso de este usuario?
 *
 * Revocar es DE-ESCALADA, no escalada (2C-C): basta la autoridad de gobierno.
 * A diferencia de grant, NO exige target activo (limpieza sobre inactivos OK) y NO
 * aplica la restricción de críticos (un ADMIN PUEDE auto-revocarse un crítico).
 *
 * Conserva `permissionKey` en la firma por simetría con grant, pero no lo usa.
 */
export function canRevokeUserPermission(
  actor: MinimalUser | null | undefined,
  targetUser: MinimalUser | null | undefined,
  _permissionKey: string,
): boolean {
  return canManageUserPermissions(actor, targetUser);
}

/** ¿Puede crear un usuario con este rol? OWNER → cualquiera; ADMIN → solo no-OWNER/no-ADMIN. */
export function canCreateUserWithRole(
  actor: MinimalUser | null | undefined,
  newRole: UserRole,
): boolean {
  if (!actor) return false;
  if (actor.active === false) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") return newRole !== "OWNER" && newRole !== "ADMIN";
  return false;
}

/** ¿Puede modificar a este usuario (rol/activo/datos)? OWNER → todos; ADMIN → solo operativos. */
export function canModifyUser(
  actor: MinimalUser | null | undefined,
  targetUser: MinimalUser | null | undefined,
): boolean {
  if (!actor || !targetUser) return false;
  if (actor.active === false || targetUser.active === false) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") return targetUser.role !== "OWNER" && targetUser.role !== "ADMIN";
  return false;
}
