/**
 * GET  /api/action-plans/[id]
 * PATCH /api/action-plans/[id]  — solo actualiza status, cierra automáticamente en estados terminales
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const TERMINAL = ["COMPLETED", "CLOSED", "CANCELLED"] as const;
type Terminal = (typeof TERMINAL)[number];

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"]),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const plan = await prisma.actionPlan.findUnique({
    where: { id: params.id },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true,
          position: { select: { name: true } },
        },
      },
      branch: { select: { id: true, name: true } },
    },
  });

  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    plan.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const today = new Date();
  return NextResponse.json({
    data: {
      ...plan,
      isOverdue: plan.deadline < today && !TERMINAL.includes(plan.status as Terminal),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.createActionPlan, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const plan = await prisma.actionPlan.findUnique({ where: { id: params.id } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    plan.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const { status } = parsed.data;
  const isTerminal = TERMINAL.includes(status as Terminal);

  const updated = await prisma.actionPlan.update({
    where: { id: params.id },
    data: {
      status,
      closedAt: isTerminal && !plan.closedAt ? new Date() : plan.closedAt,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch:   { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "UPDATE",
      entity:   "ActionPlan",
      entityId: plan.id,
      detail:   { from: plan.status, to: status },
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}
