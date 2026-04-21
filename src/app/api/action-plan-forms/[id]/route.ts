import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await prisma.actionPlanForm.findUnique({
    where: { id: params.id },
    include: {
      actionPlan: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          branch:   { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (
    session.user.role === "BRANCH_MANAGER" &&
    form.actionPlan.branchId !== session.user.branchId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(form);
}
