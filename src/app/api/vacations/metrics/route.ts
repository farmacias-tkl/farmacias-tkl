/**
 * GET /api/vacations/metrics
 *
 * Devuelve contadores agregados para el dashboard superior.
 * Filtros: branchId opcional. BRANCH_MANAGER forzado a su sucursal.
 *
 * Métricas:
 *   - pendingSupervisor    — count total en PENDING_SUPERVISOR
 *   - pendingRrhh          — count total en PENDING_RRHH
 *   - approvedThisMonth    — APPROVED con rrhhActionAt dentro del mes
 *   - rejectedThisMonth    — REJECTED con supervisorActionAt o rrhhActionAt en el mes
 *   - approvedActiveToday  — APPROVED cuyo rango incluye hoy
 *   - pendingActiveToday   — PENDING_SUPERVISOR + PENDING_RRHH cuyo rango incluye hoy
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;
  if (session!.user.role === "BRANCH_MANAGER") {
    branchId = session!.user.branchId ?? undefined;
    if (!branchId) {
      return NextResponse.json({
        data: {
          pendingSupervisor: 0, pendingRrhh: 0,
          approvedThisMonth: 0, rejectedThisMonth: 0,
          approvedActiveToday: 0, pendingActiveToday: 0,
        },
      });
    }
  }
  const branchFilter = branchId ? { branchId } : {};

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

  const [
    pendingSupervisor,
    pendingRrhh,
    approvedThisMonth,
    rejectedThisMonth,
    approvedActiveToday,
    pendingActiveToday,
  ] = await Promise.all([
    prisma.vacationRequest.count({
      where: { ...branchFilter, status: "PENDING_SUPERVISOR" },
    }),
    prisma.vacationRequest.count({
      where: { ...branchFilter, status: "PENDING_RRHH" },
    }),
    prisma.vacationRequest.count({
      where: {
        ...branchFilter,
        status: "APPROVED",
        rrhhActionAt: { gte: monthStart, lte: monthEnd },
      },
    }),
    prisma.vacationRequest.count({
      where: {
        ...branchFilter,
        status: "REJECTED",
        OR: [
          { rrhhActionAt:       { gte: monthStart, lte: monthEnd } },
          { supervisorActionAt: { gte: monthStart, lte: monthEnd } },
        ],
      },
    }),
    prisma.vacationRequest.count({
      where: {
        ...branchFilter,
        status: "APPROVED",
        startDate: { lte: todayEnd },
        endDate:   { gte: today },
      },
    }),
    prisma.vacationRequest.count({
      where: {
        ...branchFilter,
        status: { in: ["PENDING_SUPERVISOR", "PENDING_RRHH"] },
        startDate: { lte: todayEnd },
        endDate:   { gte: today },
      },
    }),
  ]);

  return NextResponse.json({
    data: {
      pendingSupervisor,
      pendingRrhh,
      approvedThisMonth,
      rejectedThisMonth,
      approvedActiveToday,
      pendingActiveToday,
    },
  });
}
