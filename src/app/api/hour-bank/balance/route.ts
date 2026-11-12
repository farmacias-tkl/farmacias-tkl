/**
 * GET /api/hour-bank/balance?employeeId= — saldo del banco de horas de una
 * persona y sus movimientos (del más nuevo al más viejo). Mismo alcance que la
 * ficha del empleado: encargado/a, solo su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { canSeeBranchRecord } from "@/lib/branch-scope";
import { loadBalance } from "@/lib/hour-bank/actions";

export async function GET(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.viewHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const employeeId = req.nextUrl.searchParams.get("employeeId");
  if (!employeeId) return NextResponse.json({ error: "Falta employeeId" }, { status: 400 });
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, currentBranchId: true } });
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (!canSeeBranchRecord(session!.user, employee.currentBranchId)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const balance = await loadBalance(prisma, employee.id);
  // Nombre de quien cargó cada movimiento (userId es un snapshot sin FK).
  const userIds = [...new Set(balance.movements.map((m) => m.userId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return NextResponse.json({
    data: {
      ...balance,
      movements: balance.movements.map((m) => ({ ...m, userName: m.userId ? nameById.get(m.userId) ?? null : null })),
    },
  });
}
