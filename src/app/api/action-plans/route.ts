/**
 * GET /api/action-plans
 *
 * BRANCH_MANAGER: GET forzado a su sucursal.
 * La creación de planes se hace exclusivamente vía POST /api/action-plan-forms/complete.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

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
        form:   { select: { id: true } },
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
