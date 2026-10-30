// =============================================================================
// Campos de personal real en el alta y la edición manual de empleados
// (/api/employees POST y /api/employees/[id] PATCH).
//
// nameKey: la misma clave que usa scripts/load-personal.ts ("apellido, nombre"
// normalizado). Se completa siempre que haya sucursal de contrato, así la
// persona cargada a mano cuenta como personal real (la limpieza de datos
// ficticios borra a los empleados SIN nameKey) y una carga posterior desde
// planilla la reconoce en vez de duplicarla.
// =============================================================================

import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/vacations/people";
import { nameKeyOf } from "./names";

export const personalFieldsSchema = {
  contractBranchId:    z.string().min(1).optional().nullable(),
  secondaryPositionId: z.string().min(1).optional().nullable(),
  isTechnicalDirector: z.boolean().optional(),
  weeklyHours:         z.number().min(0).max(99.9).optional().nullable(),
  extraTasks:          z.string().trim().max(500).optional().nullable().transform((s) => (s === "" ? null : s)),
};

/** Verifica sucursales y puestos referidos. Devuelve el error a mostrar, o null. */
export async function checkPersonalRefs(db: Db, p: {
  positionId: string;
  secondaryPositionId?: string | null;
  contractBranchId?: string | null;
  currentBranchId?: string | null;
}): Promise<string | null> {
  if (p.secondaryPositionId && p.secondaryPositionId === p.positionId) {
    return "El puesto secundario no puede ser el mismo que el principal.";
  }
  const branchIds = [p.contractBranchId, p.currentBranchId].filter((x): x is string => !!x);
  const positionIds = [p.positionId, p.secondaryPositionId].filter((x): x is string => !!x);
  const [branches, positions] = await Promise.all([
    db.branch.count({ where: { id: { in: branchIds } } }),
    db.position.count({ where: { id: { in: positionIds } } }),
  ]);
  if (branches !== new Set(branchIds).size) return "Sucursal no encontrada.";
  if (positions !== new Set(positionIds).size) return "Puesto no encontrado.";
  return null;
}

/** nameKey a guardar: solo si hay sucursal de contrato (si no, queda como está). */
export function nameKeyFor(lastName: string, firstName: string, contractBranchId: string | null | undefined): string | undefined {
  return contractBranchId ? nameKeyOf(lastName, firstName) : undefined;
}

/** Choque con @@unique([nameKey, contractBranchId]). */
export function isDuplicatePerson(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export const DUPLICATE_PERSON_ERROR = "Ya hay una persona con ese apellido y nombre en esa sucursal de contrato.";
