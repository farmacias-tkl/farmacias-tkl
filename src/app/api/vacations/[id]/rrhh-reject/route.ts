/**
 * POST /api/vacations/[id]/rrhh-reject
 *
 * PENDING_RRHH → REJECTED (motivo obligatorio).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { releaseOnExit } from "@/lib/vacations/actions";

const schema = z.object({ note: z.string().min(1, "Motivo obligatorio") });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.confirmVacation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const vacation = await prisma.vacationRequest.findUnique({ where: { id: params.id } });
  if (!vacation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (vacation.status !== "PENDING_RRHH") {
    return NextResponse.json(
      { error: `Solo se puede rechazar desde PENDING_RRHH (estado actual: ${vacation.status})` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Motivo obligatorio" }, { status: 400 });
  }
  const note = parsed.data.note;

  const updated = await prisma.$transaction(async (tx) => {
    const cas = await tx.vacationRequest.updateMany({
      where: { id: params.id, status: "PENDING_RRHH" },
      data: {
        status: "REJECTED",
        rrhhActionByUserId: session!.user.id,
        rrhhActionAt: new Date(),
        rrhhNote: note,
      },
    });
    if (cas.count !== 1) throw new StaleStatusError();
    const u = await tx.vacationRequest.findUniqueOrThrow({ where: { id: params.id } });
    await tx.vacationStateHistory.create({
      data: {
        vacationId:      params.id,
        fromStatus:      "PENDING_RRHH",
        toStatus:        "REJECTED",
        changedByUserId: session!.user.id,
        note,
      },
    });
    // Libera la cobertura elegida por supervisión (el saldo todavía no se descontó).
    const exit = await releaseOnExit(tx, vacation, session!.user.id, note);
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "VACATION_RRHH_REJECTED",
        entity:   "VacationRequest",
        entityId: params.id,
        detail: { note, refunds: exit.refunds, coveragesReleased: exit.released } as unknown as Prisma.InputJsonValue,
      },
    });
    return u;
  }).catch((e) => {
    if (e instanceof StaleStatusError) return null;
    throw e;
  });

  if (!updated) {
    return NextResponse.json({ error: "La solicitud cambió de estado; recargá y volvé a intentar" }, { status: 409 });
  }
  return NextResponse.json({ data: updated });
}

// La solicitud cambió de estado entre la lectura y la escritura (otra acción ganó).
class StaleStatusError extends Error {}

