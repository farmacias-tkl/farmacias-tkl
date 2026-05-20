/**
 * POST /api/time-events/[id]/resolve-compensation
 *
 * PENDING_REVIEW → APPROVED_FOR_COMPENSATION.
 * El supervisor/RRHH aprueba que se compense el tiempo (no se descuenta).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { canTransition } from "@/lib/time-events/validation";

const schema = z.object({ note: z.string().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.resolveTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const ev = await prisma.timeEvent.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (!canTransition(ev.status, "APPROVED_FOR_COMPENSATION")) {
    return NextResponse.json(
      { error: `No se puede aprobar compensación desde ${ev.status}` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const note = schema.safeParse(body).success ? schema.parse(body).note : undefined;

  const fromStatus = ev.status;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.timeEvent.update({
      where: { id: params.id },
      data: {
        status: "APPROVED_FOR_COMPENSATION",
        resolvedByUserId: session!.user.id,
        resolvedAt:       new Date(),
        ...(note !== undefined && { resolutionNote: note }),
      },
    });
    await tx.timeEventStateHistory.create({
      data: {
        timeEventId:     params.id,
        fromStatus,
        toStatus:        "APPROVED_FOR_COMPENSATION",
        changedByUserId: session!.user.id,
        note,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "TIME_EVENT_RESOLUTION_APPROVED",
        entity:   "TimeEvent",
        entityId: params.id,
        detail: { fromStatus, note: note ?? null },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated });
}
