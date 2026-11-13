/**
 * POST /api/hour-bank/preview { employeeId, startDate, endDate, startMinute?, endMinute? }
 *
 * No escribe. Devuelve las horas del turno de la persona en ese día o franja
 * según su horario (lo que el pedido descuenta por defecto) y su saldo.
 * Encargado/a: solo personas de su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { parseISODate } from "@/lib/personal/dates";
import { previewRequest } from "@/lib/hour-bank/actions";

const isoDate = z.string().refine((s) => parseISODate(s) !== null, "Fecha inválida (YYYY-MM-DD)");
const schema = z.object({
  employeeId: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  startMinute: z.number().int().min(0).max(1440).nullable().optional(),
  endMinute: z.number().int().min(0).max(1440).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.viewHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const result = await previewRequest(prisma, session!.user, {
    ...d, startDate: parseISODate(d.startDate)!, endDate: parseISODate(d.endDate)!,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
