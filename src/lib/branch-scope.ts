// Alcance por sucursal de las lecturas (Horas extras, Planes de acción).
// Mismo criterio que Vacaciones: el encargado ve solo su sucursal, aunque pida
// otra; sin sucursal asignada no ve nada. El resto de los roles con acceso ve
// todas, o la que pida.
import type { UserRole } from "@prisma/client";

type ScopeUser = { role: UserRole; branchId?: string | null };

/**
 * Sucursal por la que filtrar una lista.
 * - string: filtrar por esa sucursal.
 * - undefined: sin filtro (todas).
 * - null: no devolver nada.
 */
export function listBranchScope(user: ScopeUser, requested: string | null | undefined): string | null | undefined {
  if (user.role === "BRANCH_MANAGER") return user.branchId || null;
  return requested || undefined;
}

/** ¿Puede ver un registro puntual de esta sucursal? */
export function canSeeBranchRecord(user: ScopeUser, recordBranchId: string | null | undefined): boolean {
  if (user.role !== "BRANCH_MANAGER") return true;
  return !!user.branchId && recordBranchId === user.branchId;
}
