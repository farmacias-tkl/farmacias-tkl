/**
 * GET  /api/action-plans
 * POST /api/action-plans
 *
 * BRANCH_MANAGER: GET forzado a su sucursal. POST verifica que branchId coincide.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  employeeId:      z.string().min(1),
  branchId:        z.string().min(1),
  date:            z.string().transform(d => new Date(d)),
  reason:          z.string().min(1, "El motivo es obligatorio"),
  requiredActions: z.string().min(1, "Las acciones requeridas son obligatorias"),
  deadline:        z.string().transform(d => new Date(d)),
  notes:           z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp         = req.nextUrl.searchParams;
  const branchId   = sp.get("branchId");
  const employeeId = sp.get("employeeId");
  const status     = sp.get("status");
  const page       = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit      = Math.min(100, parseInt(sp.get("limit") ?? "30"));

  const where: any = {};

  // BRANCH_MANAGER: forzar su sucursal en backend
  if (session!.user.role === "BRANCH_MANAGER") {
    if (!session!.user.branchId) {
      return NextResponse.json({ data: [], meta: { total: 0, page, limit, pages: 0 } });
    }
    where.branchId = session!.user.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (employeeId) where.employeeId = employeeId;
  if (status)     where.status     = status;

  const [plans, total] = await Promise.all([
    prisma.actionPlan.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true,
          position: { select: { name: true } } } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.actionPlan.count({ where }),
  ]);

  const today = new Date();
  const enriched = plans.map(p => ({
    ...p,
    isOverdue: p.deadline < today && !["COMPLETED","CLOSED","CANCELLED"].includes(p.status),
  }));

  return NextResponse.json({
    data: enriched,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.createActionPlan, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data } = parsed;

  // BRANCH_MANAGER solo puede crear planes en su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    data.branchId !== session!.user.branchId
  ) {
    return NextResponse.json(
      { error: "Solo podes crear planes de accion en tu sucursal" },
      { status: 403 }
    );
  }

  if (data.deadline < data.date) {
    return NextResponse.json(
      { error: "El plazo no puede ser anterior a la fecha del plan" },
      { status: 400 }
    );
  }

  const [employee, branch] = await Promise.all([
    prisma.employee.findUnique({ where: { id: data.employeeId } }),
    prisma.branch.findUnique({ where: { id: data.branchId } }),
  ]);
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (!branch)   return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });

  // Verificar que el empleado pertenece a la sucursal indicada
  if (employee.currentBranchId && employee.currentBranchId !== data.branchId) {
    return NextResponse.json(
      { error: "El empleado no pertenece a la sucursal indicada" },
      { status: 400 }
    );
  }

  const plan = await prisma.actionPlan.create({
    data: { ...data, createdByUserId: session!.user.id, status: "OPEN" },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch:   { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "ActionPlan",
      entityId: plan.id,
      detail:   { employee: `${employee.firstName} ${employee.lastName}`, reason: data.reason },
    },
  }).catch(() => {});

  return NextResponse.json({ data: plan }, { status: 201 });
}
