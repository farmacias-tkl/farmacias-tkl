/**
 * POST /api/vacations/[id]/supervisor-approve
 *
 * Aprobación de supervisión = aprobación final (adenda B):
 *   PENDING_SUPERVISOR → APPROVED y descuenta el saldo (año más viejo primero).
 *   Con VACATIONS_RRHH_STEP=true: PENDING_SUPERVISOR → PENDING_RRHH (el saldo
 *   se descuenta en rrhh-approve).
 *
 * Body:
 *   note?               nota del supervisor
 *   confirmWarnings?    "Aprobar igual": obligatorio si la validación tiene
 *                       advertencias (si falta → 409 WARNINGS_REQUIRE_CONFIRMATION
 *                       con la validación para mostrarla). Se registra.
 *   rotativeEmployeeId? rotativo que cubre (null/ausente = ninguno → si el
 *                       puesto se cubre con rotativos y la sucursal es de zona
 *                       CABA, queda "sin cobertura"; en PROVINCIA no aplica).
 *
 * Lógica en src/lib/vacations/actions.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { approveVacation } from "@/lib/vacations/actions";

const schema = z.object({
  note:               z.string().optional(),
  confirmWarnings:    z.boolean().optional(),
  rotativeEmployeeId: z.string().min(1).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.approveVacation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await approveVacation(prisma, {
    id: params.id,
    userId: session!.user.id,
    note: parsed.data.note,
    confirmWarnings: parsed.data.confirmWarnings,
    rotativeEmployeeId: parsed.data.rotativeEmployeeId ?? null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, validation: result.validation },
      { status: result.status },
    );
  }
  return NextResponse.json({ data: result.data });
}
