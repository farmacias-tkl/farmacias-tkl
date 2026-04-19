/**
 * GET   /api/employees/[id]
 * PATCH /api/employees/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const patchSchema = z.object({
  firstName:         z.string().min(1).optional(),
  lastName:          z.string().min(1).optional(),
  positionId:        z.string().optional(),
  workScheduleNotes: z.string().optional().nullable(),
  notes:             z.string().optional().nullable(),
  active:            z.boolean().optional(),
  hireDate:          z.string().optional().nullable().transform(d => d ? new Date(d) : undefined),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: {
      position:      { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
      currentBranch: { select: { id: true, name: true } },
      branchAssignments: {
        include: { branch: { select: { id: true, name: true } } },
        orderBy: { startDate: "desc" },
      },
    },
  });

  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  // Encargados solo ven su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    employee.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json({ data: employee });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();

  // OWNER no puede editar
  const permErr = requireCan(can.manageEmployees, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const existing = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    existing.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.employee.update({
    where: { id: params.id },
    data:  parsed.data,
    include: {
      position:      { select: { id: true, name: true } },
      currentBranch: { select: { id: true, name: true } },
    },
  });

  const changes = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: { from: (existing as any)[k], to: v } }), {});

  await prisma.auditLog.create({
    data: {
      userId: session!.user.id, action: "UPDATE",
      entity: "Employee", entityId: updated.id, detail: changes,
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}
