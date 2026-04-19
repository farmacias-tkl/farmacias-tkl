/**
 * GET   /api/assignments/[id]
 * PATCH /api/assignments/[id]  — cambiar status: CANCELLED o COMPLETED
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth } from "@/lib/permissions";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["ACTIVE","CANCELLED","COMPLETED"]).optional(),
  notes:  z.string().optional().nullable(),
  endDate:z.string().optional().transform(d => d ? new Date(d) : undefined),
  reason: z.string().optional().nullable(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const assignment = await prisma.employeeBranchAssignment.findUnique({
    where: { id: params.id },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, zone: true,
          position: { select: { id: true, name: true } },
        },
      },
      branch:   { select: { id: true, name: true } },
      position: { select: { id: true, name: true, requiresCoverage: true } },
    },
  });

  if (!assignment) {
    return NextResponse.json({ error: "Asignacion no encontrada" }, { status: 404 });
  }

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    assignment.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json({ data: assignment });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  if (!can.reassignEmployee(session!.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const assignment = await prisma.employeeBranchAssignment.findUnique({
    where: { id: params.id },
  });
  if (!assignment) {
    return NextResponse.json({ error: "Asignacion no encontrada" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const updates: any = {};
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.notes  !== undefined) updates.notes  = parsed.data.notes;
  if (parsed.data.endDate !== undefined) updates.endDate = parsed.data.endDate;
  if (parsed.data.reason !== undefined) updates.reason = parsed.data.reason;

  const updated = await prisma.employeeBranchAssignment.update({
    where: { id: params.id },
    data:  updates,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch:   { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "UPDATE",
      entity:   "EmployeeBranchAssignment",
      entityId: updated.id,
      detail:   { changes: updates },
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}

