/**
 * POST /api/time-events/person/compensations
 *
 * Compensación por persona: { employeeId, date, minutes, note? }. Se aplica a
 * sus deudas "a compensar" empezando por la más vieja, partiéndola entre
 * varias si hace falta. Si supera lo pendiente a compensar, 400 con `max`.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { parseISODate } from "@/lib/personal/dates";
import { compensatePerson } from "@/lib/time-events/actions";

const schema = z.object({
  employeeId: z.string().min(1),
  date:       z.string().min(1),
  minutes:    z.number().int().positive(),
  note:       z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.addCompensation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  const date = parseISODate(parsed.data.date.slice(0, 10));
  if (!date) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  const r = await compensatePerson(prisma, session!.user, { ...parsed.data, date });
  if (!r.ok) return NextResponse.json({ error: r.error, max: r.max }, { status: r.status });
  return NextResponse.json({ data: r.data }, { status: 201 });
}
