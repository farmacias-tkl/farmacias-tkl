/**
 * POST /api/vacations/validate
 *
 * Stateless: recibe { employeeId, startDate, endDate }, devuelve el resultado
 * de la validación sin escribir nada. Lo usa el form de UI para feedback en
 * vivo. El POST a /api/vacations vuelve a validar antes de aceptar.
 *
 * Devuelve el saldo de la persona. Roles: can.viewVacationDetail; el resto recibe
 * 403. BRANCH_MANAGER: solo empleados de su sucursal, si no 403.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, canValidateVacationFor, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { validateVacationRequest } from "@/lib/vacations/validation";

const schema = z.object({
  employeeId:        z.string().min(1),
  startDate:         z.string().transform(d => new Date(d)),
  endDate:           z.string().transform(d => new Date(d)),
  excludeRequestId:  z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.viewVacationDetail, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (session!.user.role === "BRANCH_MANAGER") {
    const employee = await prisma.employee.findUnique({
      where: { id: parsed.data.employeeId },
      select: { currentBranchId: true },
    });
    if (!canValidateVacationFor(session!.user, employee?.currentBranchId ?? null)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
  }

  const validation = await validateVacationRequest(parsed.data);
  return NextResponse.json({ validation });
}
