/**
 * POST /api/time-events/[id]/authorize
 *
 * EARLY_DEPARTURE: PENDING_AUTHORIZATION → PENDING_REVIEW.
 * Operativo: quién dejó retirarse al empleado.
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
  const permErr = requireCan(can.authorizeTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const ev = await prisma.timeEvent.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (ev.type !== "EARLY_DEPARTURE") {
    return NextResponse.json({ error: "Solo retiros anticipados requieren autorización" }, { status: 409 });
  }
  if (!canTransition(ev.status, "PENDING_REVIEW")) {
    return NextResponse.json(
      { error: `No se puede autorizar desde ${ev.status}` },
      { status: 409 },
    );
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const note   = parsed.success ? parsed.data.note : undefined;

  const fromStatus = ev.status;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.timeEvent.update({
      where: { id: params.id },
      data: {
        status: "PENDING_REVIEW",
        authorizedByUserId: session!.user.id,
        authorizedAt:       new Date(),
        ...(note !== undefined && { authorizationNote: note }),
      },
    });
    await tx.timeEventStateHistory.create({
      data: {
        timeEventId:     params.id,
        fromStatus,
        toStatus:        "PENDING_REVIEW",
        changedByUserId: session!.user.id,
        note,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "TIME_EVENT_AUTHORIZED",
        entity:   "TimeEvent",
        entityId: params.id,
        detail: { note: note ?? null },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated });
}
