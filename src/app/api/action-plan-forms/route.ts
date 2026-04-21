import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can.createActionPlan(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    actionPlanId,
    templateType,
    formData,
    generalScore,
    improvementPlan,
    nextReview,
  } = body;

  if (!actionPlanId || !templateType || !formData || !generalScore) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const plan = await prisma.actionPlan.findUnique({ where: { id: actionPlanId } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  if (
    session.user.role === "BRANCH_MANAGER" &&
    plan.branchId !== session.user.branchId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await prisma.actionPlanForm.create({
    data: {
      actionPlanId,
      templateType,
      formData,
      generalScore,
      improvementPlan: improvementPlan ?? null,
      nextReview: nextReview ? new Date(nextReview) : null,
    },
  });

  return NextResponse.json(form, { status: 201 });
}
