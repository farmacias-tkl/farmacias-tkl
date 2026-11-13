/**
 * GET  /api/absences/[id]/debt  horas del turno en los días de la ausencia
 *                               (según el horario vigente) y su deuda, si ya se resolvió
 * POST /api/absences/[id]/debt  { resolution: "compensation" | "payroll" | "waive", minutes?, note? }
 *                               resuelve qué se hace con esas horas
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { previewAbsenceDebt, resolveAbsenceDebt } from "@/lib/time-events/actions";

const schema = z.object({
  resolution: z.enum(["compensation", "payroll", "waive"]),
  minutes:    z.number().int().positive().optional().nullable(),
  note:       z.string().max(500).optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });
  const r = await previewAbsenceDebt(prisma, session!.user, params.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ data: r.data });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.resolveTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  const r = await resolveAbsenceDebt(prisma, session!.user, { absenceId: params.id, ...parsed.data });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ data: r.data }, { status: 201 });
}
