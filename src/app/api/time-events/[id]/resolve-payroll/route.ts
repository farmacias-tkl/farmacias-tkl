/**
 * POST /api/time-events/[id]/resolve-payroll
 *
 * Resuelve una deuda. La lógica (transición, CAS, historial y AuditLog) está en
 * src/lib/time-events/actions.ts → resolveEvents, la misma que usa la
 * resolución de varias deudas juntas (/api/time-events/bulk-resolve).
 *   compensation: PENDING_REVIEW → APPROVED_FOR_COMPENSATION (nota opcional)
 *   payroll:      PENDING_REVIEW | APPROVED_FOR_COMPENSATION → SENT_TO_PAYROLL_DEDUCTION (motivo obligatorio)
 *   waive:        PENDING_REVIEW → WAIVED (motivo obligatorio)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { resolveEvents } from "@/lib/time-events/actions";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.resolveTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note : null;
  const r = await resolveEvents(prisma, session!.user, { ids: [params.id], action: "payroll", note });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ data: r.data.events[0] });
}
