import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({
  // ActionPlan fields
  employeeId:      z.string().min(1),
  branchId:        z.string().min(1, "Sucursal obligatoria"),
  date:            z.string().min(1).transform(d => new Date(d)),
  reason:          z.string().min(1, "El motivo es obligatorio"),
  requiredActions: z.string().min(1, "Las acciones requeridas son obligatorias"),
  deadline:        z.string().min(1).transform(d => new Date(d)),
  notes:           z.string().optional().nullable(),

  // ActionPlanForm fields
  templateType:    z.enum(["MOSTRADOR", "CADETE", "CAJERA", "AUDITORIA"]),
  formData:        z.record(z.string(), z.enum(["SI", "NO"])),
  generalScore:    z.enum(["EXCELENTE", "BUENO", "NECESITA_MEJORAR"]),
  improvementPlan: z.string().optional().nullable(),
  nextReview:      z.string().optional().nullable().transform(v => v ? new Date(v) : null),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.createActionPlan, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data } = parsed;

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    data.branchId !== session!.user.branchId
  ) {
    return NextResponse.json(
      { error: "Solo podés crear planes en tu sucursal" },
      { status: 403 },
    );
  }

  if (data.deadline < data.date) {
    return NextResponse.json(
      { error: "El plazo no puede ser anterior a la fecha del plan" },
      { status: 400 },
    );
  }

  const [employee, branch] = await Promise.all([
    prisma.employee.findUnique({ where: { id: data.employeeId } }),
    prisma.branch.findUnique({ where: { id: data.branchId } }),
  ]);
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (!branch)   return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });

  if (employee.currentBranchId && employee.currentBranchId !== data.branchId) {
    return NextResponse.json(
      { error: "El empleado no pertenece a la sucursal indicada" },
      { status: 400 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const plan = await tx.actionPlan.create({
      data: {
        employeeId:      data.employeeId,
        branchId:        data.branchId,
        createdByUserId: session!.user.id,
        date:            data.date,
        reason:          data.reason,
        requiredActions: data.requiredActions,
        deadline:        data.deadline,
        notes:           data.notes ?? null,
        status:          "OPEN",
      },
    });

    const form = await tx.actionPlanForm.create({
      data: {
        actionPlanId:    plan.id,
        templateType:    data.templateType,
        formData:        data.formData,
        generalScore:    data.generalScore,
        improvementPlan: data.improvementPlan ?? null,
        nextReview:      data.nextReview,
      },
    });

    return { plan, form };
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "ActionPlan",
      entityId: result.plan.id,
      detail: {
        employee: `${employee.firstName} ${employee.lastName}`,
        reason:   data.reason,
        hasForm:  true,
      },
    },
  }).catch(() => {});

  return NextResponse.json({ data: result }, { status: 201 });
}
