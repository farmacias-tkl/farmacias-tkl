/**
 * Farmacias TKL — Lógica central de asignaciones
 *
 * SEMÁNTICA DE FECHAS:
 *   endDate es INCLUSIVO. Una asignación con endDate=2025-04-30 cubre hasta
 *   el 30 de abril inclusive. El 1 de mayo ya no está cubierta.
 *
 *   Al cerrar una PERMANENT para abrir una nueva con startDate=X,
 *   la anterior se cierra con endDate = X - 1 día.
 *   Esto garantiza cero solapamiento.
 *
 * REGLAS DE endDate:
 *   PERMANENT          → endDate = null (abierta hasta ser reemplazada)
 *   TEMPORARY_COVERAGE → endDate obligatorio (MVP: siempre se conoce el período)
 *   ROTATION           → endDate obligatorio (MVP: siempre se conoce el período)
 *
 *   Una TEMPORARY_COVERAGE o ROTATION sin endDate bloquearía disponibilidad
 *   futura indefinidamente. No tiene caso de uso válido en el MVP.
 *
 * REGLAS DE SOLAPAMIENTO:
 *   - Una sola PERMANENT activa (endDate=null) por empleado.
 *   - Dos TEMPORARY_COVERAGE no pueden solaparse.
 *   - Dos ROTATION no pueden solaparse, salvo rotativos con maxConcurrentAssignments > 1.
 *   - PERMANENT coexiste con TEMPORARY_COVERAGE y ROTATION sin restricción.
 */

import { prisma } from "@/lib/prisma";
import type { AssignmentType } from "@prisma/client";

// ---------------------------------------------------------------------------
// rangesOverlap — endDate inclusivo
// endDate null = "hasta el futuro indefinido" (solo válido para PERMANENT)
// ---------------------------------------------------------------------------

export function rangesOverlap(
  aStart: Date, aEnd: Date | null,
  bStart: Date, bEnd: Date | null
): boolean {
  // Normalizar a medianoche para comparar solo fechas, no horas
  const norm = (d: Date) => {
    const n = new Date(d); n.setHours(0,0,0,0); return n.getTime();
  };

  const aS = norm(aStart);
  const aE = aEnd ? norm(aEnd) : Infinity;
  const bS = norm(bStart);
  const bE = bEnd ? norm(bEnd) : Infinity;

  // Con endDate inclusivo: se solapan si aS <= bE AND bS <= aE
  return aS <= bE && bS <= aE;
}

// ---------------------------------------------------------------------------
// dayBefore — devuelve el día anterior (para cerrar PERMANENT correctamente)
// ---------------------------------------------------------------------------

export function dayBefore(date: Date): Date {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - 1);
  return d;
}

// ---------------------------------------------------------------------------
// validateNewAssignment
// Devuelve null si es válida, string con error si no.
// ---------------------------------------------------------------------------

export async function validateNewAssignment(params: {
  employeeId: string;
  branchId:   string;
  startDate:  Date;
  endDate:    Date | null;
  type:       AssignmentType;
  excludeId?: string;
}): Promise<string | null> {
  const { employeeId, startDate, endDate, type, excludeId } = params;

  // Validar endDate obligatorio para TEMPORARY_COVERAGE y ROTATION
  if ((type === "TEMPORARY_COVERAGE" || type === "ROTATION") && !endDate) {
    return `Las asignaciones de tipo ${type === "TEMPORARY_COVERAGE" ? "cobertura temporal" : "rotación"} requieren fecha de fin. Sin fecha de fin, quedaría abierta indefinidamente y bloquearía la disponibilidad futura.`;
  }

  // Para PERMANENT: verificar que no haya otra PERMANENT activa
  // (la cerramos antes de crear, pero como segunda defensa)
  if (type === "PERMANENT") {
    // No necesita validación adicional de solapamiento con otras PERMANENT
    // porque siempre cerramos la anterior en createAssignment()
    return null;
  }

  // Buscar asignaciones del mismo tipo que puedan solaparse
  const existing = await prisma.employeeBranchAssignment.findMany({
    where: {
      employeeId,
      type,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      // Traer las que empiezan antes de que termine la nueva
      startDate: { lte: endDate! },
    },
  });

  const overlapping = existing.filter(a =>
    rangesOverlap(startDate, endDate, a.startDate, a.endDate)
  );

  if (overlapping.length === 0) return null;

  // Para ROTATION con rotativos: verificar cupo
  if (type === "ROTATION") {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { isRotating: true, maxConcurrentAssignments: true },
    });

    if (employee?.isRotating && overlapping.length < (employee.maxConcurrentAssignments ?? 1)) {
      return null; // Dentro del cupo permitido
    }

    if (employee?.isRotating) {
      return `El rotativo ya tiene ${overlapping.length} asignación(es) de rotación en ese período. Máximo: ${employee.maxConcurrentAssignments}.`;
    }

    return "El empleado ya tiene una asignación de rotación en ese período.";
  }

  // TEMPORARY_COVERAGE
  return "El empleado ya tiene una cobertura temporal asignada en ese período.";
}

// ---------------------------------------------------------------------------
// createAssignment — única forma de crear asignaciones en el sistema
// ---------------------------------------------------------------------------

export async function createAssignment(params: {
  employeeId:       string;
  branchId:         string;
  startDate:        Date;
  endDate:          Date | null; // null solo para PERMANENT
  type:             AssignmentType;
  reason?:          string;
  assignedByUserId?: string;
}) {
  const { employeeId, branchId, startDate, endDate, type, reason, assignedByUserId } = params;

  return prisma.$transaction(async (tx) => {
    if (type === "PERMANENT") {
      // Cerrar la PERMANENT vigente con endDate = startDate - 1 día (inclusivo)
      // Esto evita cualquier solapamiento, incluso de un solo día.
      const closeDate = dayBefore(startDate);

      await tx.employeeBranchAssignment.updateMany({
        where: { employeeId, type: "PERMANENT", endDate: null },
        data:  { endDate: closeDate },
      });

      // Actualizar currentBranchId a la nueva sucursal
      await tx.employee.update({
        where: { id: employeeId },
        data:  { currentBranchId: branchId },
      });
    }

    const assignment = await tx.employeeBranchAssignment.create({
      data: {
        employeeId, branchId,
        startDate, endDate: endDate ?? null,
        type, reason, assignedByUserId,
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });

    return assignment;
  });
}

// ---------------------------------------------------------------------------
// closeAssignment — cierra una asignación y limpia currentBranchId si era PERMANENT
// ---------------------------------------------------------------------------

export async function closeAssignment(params: {
  assignmentId: string;
  employeeId:   string;
  endDate:      Date;
}) {
  const { assignmentId, employeeId, endDate } = params;

  return prisma.$transaction(async (tx) => {
    const assignment = await tx.employeeBranchAssignment.update({
      where: { id: assignmentId },
      data:  { endDate },
    });

    // Si era PERMANENT, limpiar currentBranchId → null
    // (no hay otra PERMANENT activa porque solo puede haber una)
    if (assignment.type === "PERMANENT") {
      await tx.employee.update({
        where: { id: employeeId },
        data:  { currentBranchId: null },
      });
    }

    return assignment;
  });
}
