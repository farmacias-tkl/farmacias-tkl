/**
 * Loader de permisos POR USUARIO (refactor permisos-por-usuario, Fase 1E).
 *
 * Produce el shape `UserWithUserPermissions` que consumen los helpers PUROS de
 * user-permissions.ts. Aísla el acceso a datos (Prisma) para que user-permissions.ts
 * siga siendo puro y testeable sin DB.
 *
 * Reglas de diseño (cerradas en Fase 1D):
 *  - `User.branchId` es la fuente CANÓNICA de la sucursal propia (OWN_BRANCH).
 *  - `Employee.currentBranchId` es FALLBACK TRANSITORIO: solo se consulta si
 *    User.branchId === null && User.employeeId != null. Se removerá cuando todos
 *    los usuarios operativos tengan User.branchId poblado. No re-acoplar a RRHH.
 *  - `active` se selecciona EXPLÍCITO desde User: si llegara undefined, la regla
 *    active-first de los helpers no dispararía y un inactivo podría autorizar.
 *  - `Permission.active` se PRESERVA (no se filtra en query): los helpers de 1B
 *    ya filtran active en un único lugar (findActivePermission). No duplicar la regla.
 */
import type { PermissionScope, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { UserWithUserPermissions } from "./user-permissions";

/**
 * Record que devuelve la query principal del loader. `employeeId` se usa SOLO para
 * decidir el fallback a Employee; NO se propaga al UserWithUserPermissions final.
 */
export interface UserPermissionLoadRecord {
  id: string;
  role: UserRole;
  active: boolean;
  branchId: string | null;
  employeeId: string | null;
  permissions: Array<{
    scope: PermissionScope;
    permission: {
      key: string;
      active: boolean;
    };
  }>;
}

/**
 * Cliente mínimo prisma-like que necesita el loader. Permite inyectar un stub en
 * los tests sin importar el Prisma Client runtime ni tocar DB.
 */
export interface UserPermissionsLoaderClient {
  user: {
    findUnique(args: unknown): Promise<UserPermissionLoadRecord | null>;
  };
  employee: {
    findUnique(args: unknown): Promise<{ currentBranchId: string | null } | null>;
  };
}

/**
 * Mapper PURO: transforma el record (+ fallback opcional) en UserWithUserPermissions.
 * Hace copia defensiva profunda de permissions. NO consulta DB.
 */
export function mapUserPermissionRecordToUserWithUserPermissions(
  record: UserPermissionLoadRecord,
  employeeCurrentBranchId?: string | null,
): UserWithUserPermissions {
  return {
    id: record.id,
    role: record.role,
    active: record.active,
    branchId: record.branchId,
    // branchId canónico: si está presente, el fallback Employee es irrelevante (undefined).
    employeeCurrentBranchId:
      record.branchId === null ? (employeeCurrentBranchId ?? null) : undefined,
    permissions: record.permissions.map((p) => ({
      scope: p.scope,
      permission: { key: p.permission.key, active: p.permission.active }, // active preservado
    })),
    // employeeId NO se propaga.
  };
}

// Select de la query principal. El test afirma su forma capturando el argumento
// real recibido por user.findUnique, especialmente active: true.
const USER_LOAD_SELECT = {
  id: true,
  role: true,
  active: true,
  branchId: true,
  employeeId: true,
  permissions: {
    select: {
      scope: true,
      permission: {
        select: {
          key: true,
          active: true,
        },
      },
    },
  },
} as const;

/**
 * Carga un usuario con sus permisos por-usuario en el shape de los helpers.
 * Devuelve null si el usuario no existe. Acepta un `client` inyectable para tests.
 */
export async function loadUserWithUserPermissions(
  userId: string,
  // El PrismaClient real cumple este contrato en runtime; su tipado genérico no es
  // estructuralmente asignable a la interfaz mínima, así que se acota en el default.
  client: UserPermissionsLoaderClient = prisma as unknown as UserPermissionsLoaderClient,
): Promise<UserWithUserPermissions | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: USER_LOAD_SELECT,
  });
  if (!user) return null;

  let employeeCurrentBranchId: string | null = null;
  if (user.branchId === null && user.employeeId) {
    const employee = await client.employee.findUnique({
      where: { id: user.employeeId },
      select: { currentBranchId: true },
    });
    employeeCurrentBranchId = employee?.currentBranchId ?? null;
  }

  return mapUserPermissionRecordToUserWithUserPermissions(user, employeeCurrentBranchId);
}
