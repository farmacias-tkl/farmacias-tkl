/**
 * POST /api/time-events/[id]/compensations
 *
 * Registra una compensación de minutos. Solo permitido en
 * APPROVED_FOR_COMPENSATION o PARTIALLY_COMPENSATED.
 *
 * Cap server-side: minutesCompensated no puede exceder minutesRemaining
 * para evitar sobre-compensaciones por error humano.
 *
 * Después de cargar:
 *   - actualiza minutesCompensated += minutesCompensated
 *   - actualiza minutesRemaining   = max(0, owed - newCompensated)
 *   - si newCompensated >= owed → status = COMPENSATED
 *   - sino                      → status = PARTIALLY_COMPENSATED
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import {
  canAcceptCompensation, statusAfterCompensation,
} from "@/lib/time-events/validation";

const schema = z.object({
  date:               z.string().transform(d => new Date(d)),
  minutesCompensated: z.number().int().positive(),
  note:               z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.addCompensation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const ev = await prisma.timeEvent.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (!canAcceptCompensation(ev.status)) {
    return NextResponse.json(
      { error: `No se pueden cargar compensaciones en estado ${ev.status}` },
      { status: 409 },
    );
  }

  const body   = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.minutesCompensated > ev.minutesRemaining) {
    return NextResponse.json(
      {
        error: `La compensación (${data.minutesCompensated} min) excede el saldo pendiente (${ev.minutesRemaining} min).`,
      },
      { status: 400 },
    );
  }

  const newCompensated = ev.minutesCompensated + data.minutesCompensated;
  const newRemaining   = Math.max(0, ev.minutesOwed - newCompensated);
  const newStatus      = statusAfterCompensation(newCompensated, ev.minutesOwed);
  const fromStatus     = ev.status;

  const result = await prisma.$transaction(async (tx) => {
    const comp = await tx.timeEventCompensation.create({
      data: {
        timeEventId:        params.id,
        date:               data.date,
        minutesCompensated: data.minutesCompensated,
        registeredByUserId: session!.user.id,
        // Quién había autorizado la resolución previa que habilita esta compensación
        authorizedByUserId: ev.resolvedByUserId,
        note:               data.note ?? null,
      },
    });
    const u = await tx.timeEvent.update({
      where: { id: params.id },
      data: {
        minutesCompensated: newCompensated,
        minutesRemaining:   newRemaining,
        status:             newStatus,
      },
    });
    // StateHistory solo si cambió el status
    if (newStatus !== fromStatus) {
      await tx.timeEventStateHistory.create({
        data: {
          timeEventId:     params.id,
          fromStatus,
          toStatus:        newStatus,
          changedByUserId: session!.user.id,
          note: `Compensación de ${data.minutesCompensated} min (saldo restante: ${newRemaining})`,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "TIME_EVENT_COMPENSATION_ADDED",
        entity:   "TimeEvent",
        entityId: params.id,
        detail: {
          minutes:           data.minutesCompensated,
          newCompensated,
          newRemaining,
          newStatus,
        },
      },
    });
    return { event: u, compensation: comp };
  });

  return NextResponse.json({ data: result }, { status: 201 });
}
