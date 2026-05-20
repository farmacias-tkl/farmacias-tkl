/**
 * POST /api/vacations/validate
 *
 * Stateless: recibe { employeeId, startDate, endDate }, devuelve el resultado
 * de la validación sin escribir nada. Lo usa el form de UI para feedback en
 * vivo. El POST a /api/vacations vuelve a validar antes de aceptar.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAuth } from "@/lib/permissions";
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
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const validation = await validateVacationRequest(parsed.data);
  return NextResponse.json({ validation });
}
