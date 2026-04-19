/**
 * GET /api/employees/[id]/active-assignments?startDate=&endDate=
 *
 * Devuelve asignaciones ACTIVAS de un empleado en un rango de fechas.
 * Usado por el formulario de ausencias para sugerir la sucursal impactada
 * y mostrar qué puesto estaba cubriendo.
 *
 * Solo devuelve asignaciones con status = ACTIVE.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp       = req.nextUrl.searchParams;
  const startStr = sp.get("startDate");
  const endStr   = sp.get("endDate");

  if (!startStr || !endStr) {
    return NextResponse.json(
      { error: "startDate y endDate son obligatorios" },
      { status: 400 }
    );
  }

  const startDate = new Date(startStr); startDate.setHours(0,0,0,0);
  const endDate   = new Date(endStr);   endDate.setHours(23,59,59,999);

  const assignments = await prisma.employeeBranchAssignment.findMany({
    where: {
      employeeId: params.id,
      type:       { in: ["TEMPORARY_COVERAGE","ROTATION","PERMANENT"] },
      status:     "ACTIVE",                         // ← solo ACTIVE
      startDate:  { lte: endDate },
      OR: [
        { endDate: null },
        { endDate: { gte: startDate } },
      ],
    },
    include: {
      branch:   { select: { id: true, name: true } },
      position: { select: { id: true, name: true, requiresCoverage: true } },
    },
    orderBy: { startDate: "desc" },
  });

  // Ordenar por relevancia:
  // 1. TEMPORARY_COVERAGE y ROTATION primero (más específicas que PERMANENT)
  // 2. Más recientes primero dentro del mismo tipo
  const typeOrder = { TEMPORARY_COVERAGE: 0, ROTATION: 1, PERMANENT: 2 };
  const sorted = assignments.sort((a, b) => {
    const tA = typeOrder[a.type] ?? 3;
    const tB = typeOrder[b.type] ?? 3;
    if (tA !== tB) return tA - tB;
    return b.startDate.getTime() - a.startDate.getTime();
  });

  const suggested = sorted[0] ?? null;

  return NextResponse.json({
    data: sorted,
    suggested: suggested ? {
      assignmentId:   suggested.id,
      branchId:       suggested.branch.id,
      branchName:     suggested.branch.name,
      type:           suggested.type,
      // Puesto cubierto en esta asignación (puede diferir del puesto base del empleado)
      positionCovered: suggested.position
        ? { id: suggested.position.id, name: suggested.position.name, requiresCoverage: suggested.position.requiresCoverage }
        : null,
    } : null,
  });
}

