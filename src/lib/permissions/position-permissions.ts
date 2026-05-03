/**
 * Helpers Fase 3 — sistema de permisos por puesto.
 *
 * Operan sobre Universo B (permisos operativos). NO conocen ni modifican
 * Universo A (acceso ejecutivo / panel /owner). La autorizacion ejecutiva
 * sigue via canViewExecutive() y canAccessOwnerPanel() en
 * src/lib/permissions.ts (legacy).
 *
 * Patron de uso en handlers de API:
 *
 *   import { auth } from "@/lib/auth";
 *   import { loadUserWithPermissions, requirePermission } from
 *     "@/lib/permissions/position-permissions";
 *
 *   const session = await auth();
 *   if (!session?.user) return NextResponse.json({ error: "..." }, { status: 401 });
 *   const user = await loadUserWithPermissions(session.user.id);
 *   const err = requirePermission(user, "vencidos.upload_remito", branchId);
 *   if (err) return NextResponse.json({ error: err.error }, { status: err.status });
 *   // ...proceder con la accion
 */
import { prisma } from "@/lib/prisma";
import type { UserRole, PermissionScope } from "@prisma/client";

// ============================================================================
// Tipo interno: shape del usuario con sus permisos cargados.
// ============================================================================
export interface UserWithPermissions {
  id:   string;
  role: UserRole;
  employee: {
    id:              string;
    currentBranchId: string | null;
    position: {
      permissions: Array<{
        scope:      PermissionScope;
        permission: { key: string; active: boolean };
      }>;
    };
  } | null;
}

// ============================================================================
// Bypass operativo: roles que pasan can()/canInBranch() sin lookup.
//
// SUPERVISOR esta incluido para no romper comportamiento actual de
// la plataforma operativa (los SUPERVISOR tienen acceso amplio via
// permisos legacy de ROUTE_PERMISSIONS / can.*).
//
// TODO Fase 5: evaluar migrar SUPERVISOR a permisos finos y remover
// bypass — esto requeriria que cada SUPERVISOR este modelado como
// Employee con un Position con todos los permisos correspondientes.
// ============================================================================
const ROLES_WITH_OPERATIONAL_BYPASS: UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR"];

function hasBypass(user: UserWithPermissions | null | undefined): boolean {
  return user != null && ROLES_WITH_OPERATIONAL_BYPASS.includes(user.role);
}

// ============================================================================
// loadUserWithPermissions: carga User + Employee + Position + permisos.
//
// Devuelve null si el user no existe.
// Devuelve UserWithPermissions con employee=null si el user no tiene
// employeeId asignado o si el Employee referenciado no existe.
//
// Implementado con dos queries encadenadas porque User.employeeId no
// esta formalizada como relacion Prisma (decision Fase 1, mantener
// compatibilidad y evitar cambio de schema).
// ============================================================================
export async function loadUserWithPermissions(userId: string): Promise<UserWithPermissions | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, role: true, employeeId: true },
  });
  if (!user) return null;

  let employee: UserWithPermissions["employee"] = null;
  if (user.employeeId) {
    employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: {
        id:              true,
        currentBranchId: true,
        position: {
          select: {
            permissions: {
              select: {
                scope:      true,
                permission: { select: { key: true, active: true } },
              },
            },
          },
        },
      },
    });
  }

  return { id: user.id, role: user.role, employee };
}

// ============================================================================
// can(user, key)
// El usuario tiene el permiso (sin importar la sucursal)?
// Util para chequeos a nivel modulo (mostrar item de menu, ver pagina).
// Para chequeos en una accion sobre una sucursal especifica, usar canInBranch.
// ============================================================================
export function can(
  user: UserWithPermissions | null | undefined,
  permissionKey: string,
): boolean {
  if (hasBypass(user)) return true;
  if (!user?.employee?.position?.permissions) return false;
  return user.employee.position.permissions.some(
    pp => pp.permission.active && pp.permission.key === permissionKey,
  );
}

// ============================================================================
// canInBranch(user, key, branchId)
// El usuario tiene el permiso PARA ESTA sucursal?
// - OWN_BRANCH: requiere branchId == user.employee.currentBranchId
// - ALL_BRANCHES: aplica a cualquier branchId
// ============================================================================
export function canInBranch(
  user: UserWithPermissions | null | undefined,
  permissionKey: string,
  branchId: string,
): boolean {
  if (hasBypass(user)) return true;
  if (!user?.employee?.position?.permissions) return false;
  const match = user.employee.position.permissions.find(
    pp => pp.permission.active && pp.permission.key === permissionKey,
  );
  if (!match) return false;
  if (match.scope === "ALL_BRANCHES") return true;
  // OWN_BRANCH
  return user.employee.currentBranchId === branchId;
}

// ============================================================================
// requirePermission: para usar en handlers de API.
// Devuelve null si OK, o { error, status } si no autorizado.
// Mismo patron que requireCan/requireAuth en permissions.ts legacy.
// ============================================================================
export function requirePermission(
  user: UserWithPermissions | null | undefined,
  permissionKey: string,
  branchId?: string,
): { error: string; status: number } | null {
  if (!user) return { error: "No autenticado", status: 401 };
  const ok = branchId
    ? canInBranch(user, permissionKey, branchId)
    : can(user, permissionKey);
  return ok ? null : { error: "Sin permisos para esta accion", status: 403 };
}
