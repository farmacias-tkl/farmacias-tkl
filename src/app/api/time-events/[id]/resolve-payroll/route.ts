/**
 * POST /api/time-events/[id]/resolve-payroll
 *
 * → SENT_TO_PAYROLL_DEDUCTION.
 * Restringido a PENDING_REVIEW y APPROVED_FOR_COMPENSATION
 * (no permitido si ya hay compensaciones cargadas).
 * Motivo OBLIGATORIO.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { canTransition } from "@/lib/time-events/validation";

const schema = z.object({ note: z.string().min(1, "Motivo obligatorio") });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.resolveTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const ev = await prisma.timeEvent.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (!canTransition(ev.status, "SENT_TO_PAYROLL_DEDUCTION")) {
    return NextResponse.json(
      { error: `No se puede enviar a payroll desde ${ev.status} (solo desde PENDING_REVIEW o APPROVED_FOR_COMPENSATION)` },
      { status: 409 },
    );
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Motivo obligatorio" }, { status: 400 });
  const note   = parsed.data.note;

  const fromStatus = ev.status;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.timeEvent.update({
      where: { id: params.id },
      data: {
        status: "SENT_TO_PAYROLL_DEDUCTION",
        resolvedByUserId: session!.user.id,
        resolvedAt:       new Date(),
        resolutionNote:   note,
        // minutesRemaining queda con el saldo original — payroll lo descontará.
      },
    });
    await tx.timeEventStateHistory.create({
      data: {
        timeEventId:     params.id,
        fromStatus,
        toStatus:        "SENT_TO_PAYROLL_DEDUCTION",
        changedByUserId: session!.user.id,
        note,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "TIME_EVENT_SENT_TO_PAYROLL",
        entity:   "TimeEvent",
        entityId: params.id,
        detail: { fromStatus, note },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated });
}
