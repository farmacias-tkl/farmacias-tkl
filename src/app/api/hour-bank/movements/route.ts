/**
 * POST /api/hour-bank/movements { employeeId, type, hours, note? }
 *
 * Movimientos que carga supervisión a mano:
 *   INITIAL       saldo inicial de la persona (una sola vez; puede ser negativo)
 *   COMPENSATION  compensación a favor (suma; motivo obligatorio)
 *   ADJUST        corrección, con signo (motivo obligatorio)
 * Los demás movimientos los generan la aprobación de horas extra con destino
 * Banco y la autorización de un pedido.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { addMovement } from "@/lib/hour-bank/actions";

const schema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["INITIAL", "COMPENSATION", "ADJUST"]),
  hours: z.number().finite(),
  note: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.adjustHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await addMovement(prisma, session!.user, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data }, { status: 201 });
}
