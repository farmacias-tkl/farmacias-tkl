/**
 * GET /api/time-events/balance
 *
 * Saldo por empleado. Devuelve TODOS los empleados con saldo pendiente > 0,
 * ordenados por mayor deuda.
 *
 * Saldo pendiente = sum(minutesRemaining) en estados:
 *   APPROVED_FOR_COMPENSATION + PARTIALLY_COMPENSATED
 *
 * También expone totales globales por empleado:
 *   - totalOwed         = sum(minutesOwed)        de events no cancelados ni waived
 *   - totalCompensated  = sum(minutesCompensated) idem
 *   - totalRemaining    = sum(minutesRemaining)   donde status admite compensación
 *
 * BRANCH_MANAGER: scope automático a su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;
  if (session!.user.role === "BRANCH_MANAGER") {
    branchId = session!.user.branchId ?? undefined;
    if (!branchId) return NextResponse.json({ data: [] });
  }

  const where: Prisma.TimeEventWhereInput = {
    ...(branchId ? { branchId } : {}),
    status: { in: ["APPROVED_FOR_COMPENSATION", "PARTIALLY_COMPENSATED"] },
    minutesRemaining: { gt: 0 },
  };

  // Agregar por empleado los minutos pendientes
  const grouped = await prisma.timeEvent.groupBy({
    by: ["employeeId"],
    where,
    _sum: { minutesRemaining: true, minutesOwed: true, minutesCompensated: true },
    _count: { _all: true },
  });

  if (grouped.length === 0) return NextResponse.json({ data: [] });

  // Traer info del empleado para enriquecer
  const employees = await prisma.employee.findMany({
    where: { id: { in: grouped.map(g => g.employeeId) } },
    select: {
      id: true, firstName: true, lastName: true,
      currentBranch: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  });
  const empMap = new Map(employees.map(e => [e.id, e]));

  const data = grouped
    .map(g => {
      const e = empMap.get(g.employeeId);
      return {
        employeeId:        g.employeeId,
        employeeName:      e ? `${e.firstName} ${e.lastName}` : g.employeeId,
        branchName:        e?.currentBranch?.name ?? null,
        positionName:      e?.position?.name ?? null,
        eventsCount:       g._count._all,
        totalOwed:         g._sum.minutesOwed         ?? 0,
        totalCompensated:  g._sum.minutesCompensated  ?? 0,
        totalRemaining:    g._sum.minutesRemaining    ?? 0,
      };
    })
    .sort((a, b) => b.totalRemaining - a.totalRemaining);

  return NextResponse.json({ data });
}
