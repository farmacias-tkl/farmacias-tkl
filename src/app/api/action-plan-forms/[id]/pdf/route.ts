export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import fs from "fs";
import path from "path";
import ActionPlanDocument from "@/lib/pdf/ActionPlanDocument";
import { getTemplate } from "@/lib/action-plan-templates";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const form = await prisma.actionPlanForm.findUnique({
    where: { id: params.id },
    include: {
      actionPlan: {
        include: {
          employee: { select: { firstName: true, lastName: true } },
          branch:   { select: { name: true } },
        },
      },
    },
  });

  if (!form) return new NextResponse("Not found", { status: 404 });

  if (
    session.user.role === "BRANCH_MANAGER" &&
    form.actionPlan.branchId !== session.user.branchId
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const plan     = form.actionPlan;
  const employee = plan.employee;

  const creator = await prisma.user.findUnique({
    where: { id: plan.createdByUserId },
    select: { name: true },
  });

  const logoPath = path.join(process.cwd(), "public", "branding", "logo-horizontal.jpg");
  const logoBase64 = fs.readFileSync(logoPath).toString("base64");

  const sections = getTemplate(form.templateType);
  const formData = form.formData as Record<string, "SI" | "NO">;

  const element = createElement(ActionPlanDocument, {
    logoBase64,
    employeeName:    `${employee.firstName} ${employee.lastName}`,
    branchName:      plan.branch.name,
    encargado:       creator?.name ?? "—",
    planDate:        plan.date.toISOString(),
    deadline:        plan.deadline.toISOString(),
    reason:          plan.reason,
    requiredActions: plan.requiredActions,
    sections,
    formData,
    generalScore:    form.generalScore,
    improvementPlan: form.improvementPlan,
    nextReview:      form.nextReview?.toISOString() ?? null,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const employeeName = `${employee.firstName}-${employee.lastName}`.replace(/\s+/g, "_");
  const filename     = `plan-accion_${employeeName}_${plan.date.toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
