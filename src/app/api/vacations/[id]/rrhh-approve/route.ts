/**
 * POST /api/vacations/[id]/rrhh-approve
 *
 * PENDING_RRHH → APPROVED.
 * Estado final del workflow positivo.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ note: z.string().optional() });

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
      { error: `Solo se puede confirmar desde PENDING_RRHH (estado actual: ${vacation.status})` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const note = parsed.success ? parsed.data.note : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.vacationRequest.update({
      where: { id: params.id },
      data: {
        status: "APPROVED",
        rrhhActionByUserId: session!.user.id,
        rrhhActionAt: new Date(),
        ...(note !== undefined && { rrhhNote: note }),
      },
    });
    await tx.vacationStateHistory.create({
      data: {
        vacationId:      params.id,
        fromStatus:      "PENDING_RRHH",
        toStatus:        "APPROVED",
        changedByUserId: session!.user.id,
        note,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "VACATION_RRHH_APPROVED",
        entity:   "VacationRequest",
        entityId: params.id,
        detail: { note: note ?? null },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated });
}
