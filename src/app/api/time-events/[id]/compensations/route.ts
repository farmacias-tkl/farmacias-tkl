/**
 * POST /api/time-events/[id]/compensations
 *
 * Compensación sobre un registro puntual: { date, minutesCompensated, note? }.
 * Solo en APPROVED_FOR_COMPENSATION o PARTIALLY_COMPENSATED y sin superar el
 * saldo pendiente de ese registro. La compensación por persona (que se reparte
 * entre varias deudas) es /api/time-events/person/compensations.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { parseISODate } from "@/lib/personal/dates";
import { addCompensation } from "@/lib/time-events/actions";

const schema = z.object({
  date:               z.string().min(1),
  minutesCompensated: z.number().int().positive(),
  note:               z.string().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.addCompensation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  const date = parseISODate(parsed.data.date.slice(0, 10));
  if (!date) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  const r = await addCompensation(prisma, session!.user, {
    eventId: params.id, minutes: parsed.data.minutesCompensated, date, note: parsed.data.note,
  });
  if (!r.ok) return NextResponse.json({ error: r.error, max: r.max }, { status: r.status });
  return NextResponse.json({ data: r.data }, { status: 201 });
}
