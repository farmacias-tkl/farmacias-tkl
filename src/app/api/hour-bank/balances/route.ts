/**
 * GET /api/hour-bank/balances?branchId= — saldo del banco de horas por persona
 * (solo quienes tienen algún movimiento). Encargado/a: solo su sucursal.
 * Es la suma de los movimientos; los minutos adeudados de Asistencia, si están
 * activados, se ven en la ficha de cada persona.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { listBranchScope } from "@/lib/branch-scope";
import { toHours } from "@/lib/hour-bank/hours";

export async function GET(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.viewHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const scope = listBranchScope(session!.user, req.nextUrl.searchParams.get("branchId"));
  if (scope === null) return NextResponse.json({ data: [] });

  const sums = await prisma.hourBankMovement.groupBy({
    by: ["employeeId"],
    where: scope ? { employee: { currentBranchId: scope } } : {},
    _sum: { hours: true },
    _max: { createdAt: true },
  });
  if (sums.length === 0) return NextResponse.json({ data: [] });

  const employees = await prisma.employee.findMany({
    where: { id: { in: sums.map((s) => s.employeeId) } },
    select: {
      id: true, firstName: true, lastName: true, active: true,
      position: { select: { name: true } },
      currentBranch: { select: { id: true, name: true } },
    },
  });
  const byId = new Map(employees.map((e) => [e.id, e]));
  const data = sums
    .map((s) => ({ employee: byId.get(s.employeeId), balance: toHours(s._sum.hours ?? 0), lastMovementAt: s._max.createdAt }))
    .filter((r) => !!r.employee)
    .sort((a, b) => `${a.employee!.lastName} ${a.employee!.firstName}`.localeCompare(`${b.employee!.lastName} ${b.employee!.firstName}`, "es"));
  return NextResponse.json({ data });
}
