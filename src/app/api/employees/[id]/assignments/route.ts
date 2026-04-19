/**
 * GET  /api/employees/[id]/assignments  — Historial de asignaciones
 * POST /api/employees/[id]/assignments  — Cambiar sucursal
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const assignSchema = z.object({
  branchId:  z.string().min(1),
  startDate: z.string().transform(d => new Date(d)),
  type:      z.enum(["PERMANENT","TEMPORARY_COVERAGE","ROTATION"]).default("PERMANENT"),
  reason:    z.string().optional(),
  endDate:   z.string().optional().nullable().transform(d => d ? new Date(d) : null),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const assignments = await prisma.employeeBranchAssignment.findMany({
    where: { employeeId: params.id },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { startDate: "desc" },
  });

  return NextResponse.json({ data: assignments });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();

  // Solo quienes pueden reasignar empleados
  const permErr = requireCan(can.reassignEmployee, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const employee = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const { branchId, startDate, type, reason, endDate } = parsed.data;

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });

  if (type === "PERMANENT" && employee.currentBranchId === branchId) {
    return NextResponse.json({ error: "El empleado ya está en esa sucursal" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Cerrar asignación PERMANENT vigente si el nuevo tipo es también PERMANENT
    if (type === "PERMANENT") {
      await tx.employeeBranchAssignment.updateMany({
        where: { employeeId: params.id, endDate: null, type: "PERMANENT" },
        data:  { endDate: startDate },
      });
    }

    const assignment = await tx.employeeBranchAssignment.create({
      data: {
        employeeId:       params.id,
        branchId,
        startDate,
        endDate:          endDate ?? null,
        type,
        reason,
        assignedByUserId: session!.user.id,
      },
      include: { branch: { select: { id: true, name: true } } },
    });

    // Solo actualizar currentBranchId en asignaciones permanentes
    if (type === "PERMANENT") {
      await tx.employee.update({
        where: { id: params.id },
        data:  { currentBranchId: branchId },
      });
    }

    return assignment;
  });

  await prisma.auditLog.create({
    data: {
      userId: session!.user.id, action: "ASSIGN_BRANCH",
      entity: "Employee", entityId: params.id,
      detail: { newBranch: branch.name, prevBranch: employee.currentBranchId, type, reason },
    },
  }).catch(() => {});

  return NextResponse.json({ data: result }, { status: 201 });
}
