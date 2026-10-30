/**
 * GET /api/employees/[id]/personal
 *
 * Datos de personal para la ficha: horarios (con vigencia, tramos, lugar y
 * semana A/B), horas semanales calculadas, saldo de vacaciones por año y sus
 * movimientos. Mismo alcance que GET /api/employees/[id] (encargado: solo su
 * sucursal).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { scheduleAt, weeklyHours, weeklyHoursWarning } from "@/lib/personal/schedule";
import { toSchedule } from "@/lib/vacations/people";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    select: {
      id: true, currentBranchId: true, isRotating: true, weeklyHours: true,
      workSchedules: {
        orderBy: { validFrom: "desc" },
        include: {
          slots: {
            orderBy: [{ week: "asc" }, { dayOfWeek: "asc" }, { slot: "asc" }],
            include: { branch: { select: { id: true, name: true } } },
          },
        },
      },
      vacationBalances: { orderBy: { year: "asc" }, select: { year: true, days: true } },
      vacationBalanceMovements: {
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { vacationRequest: { select: { id: true, startDate: true, endDate: true, status: true } } },
      },
    },
  });
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (session!.user.role === "BRANCH_MANAGER" && employee.currentBranchId !== session!.user.branchId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const current = scheduleAt(employee.workSchedules, new Date());
  const schedules = employee.workSchedules.map((s) => {
    const sch = toSchedule(s);
    return {
      id: s.id,
      validFrom: s.validFrom,
      abReferenceDate: s.abReferenceDate,
      isCurrent: s.id === current?.id,
      hours: weeklyHours(sch.slots),
      hoursWarning: weeklyHoursWarning(sch.slots),
      slots: s.slots,
    };
  });

  return NextResponse.json({
    data: {
      isRotating: employee.isRotating,
      declaredWeeklyHours: employee.weeklyHours === null ? null : Number(employee.weeklyHours),
      schedules,
      balances: employee.vacationBalances,
      balanceTotal: employee.vacationBalances.reduce((acc, b) => acc + b.days, 0),
      movements: employee.vacationBalanceMovements,
    },
  });
}
