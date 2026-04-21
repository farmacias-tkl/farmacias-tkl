import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  actionPlanId:    z.string().min(1, "actionPlanId es obligatorio"),
  templateType:    z.enum(["MOSTRADOR", "CADETE", "CAJERA", "AUDITORIA"]),
  formData:        z.record(z.string(), z.enum(["SI", "NO"])),
  generalScore:    z.enum(["EXCELENTE", "BUENO", "NECESITA_MEJORAR"]),
  improvementPlan: z.string().optional().nullable(),
  nextReview:      z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.createActionPlan, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data } = parsed;

  const plan = await prisma.actionPlan.findUnique({ where: { id: data.actionPlanId } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    plan.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await prisma.actionPlanForm.create({
    data: {
      actionPlanId:    data.actionPlanId,
      templateType:    data.templateType,
      formData:        data.formData,
      generalScore:    data.generalScore,
      improvementPlan: data.improvementPlan ?? null,
      nextReview:      data.nextReview ? new Date(data.nextReview) : null,
    },
  });

  return NextResponse.json(form, { status: 201 });
}
