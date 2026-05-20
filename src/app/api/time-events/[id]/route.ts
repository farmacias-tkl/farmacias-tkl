/**
 * GET   /api/time-events/[id] — detalle con historial y compensaciones
 * PATCH /api/time-events/[id] — editar (solo PENDING_AUTHORIZATION o PENDING_REVIEW)
 *
 * En PATCH recalcula minutesOwed y minutesRemaining si cambian los tiempos.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { z } from "zod";
import {
  calculateMinutesOwed, computeRemaining, validateTimes,
} from "@/lib/time-events/validation";

const patchSchema = z.object({
  expectedTime: z.string().optional().transform(d => d ? new Date(d) : undefined),
  actualTime:   z.string().optional().transform(d => d ? new Date(d) : undefined),
  reason:       z.string().optional().nullable(),
  reporterNote: z.string().optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const ev = await prisma.timeEvent.findUnique({
    where: { id: params.id },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch:   { select: { id: true, name: true } },
      reportedBy:   { select: { id: true, name: true } },
      authorizedBy: { select: { id: true, name: true } },
      resolvedBy:   { select: { id: true, name: true } },
      compensations: {
        orderBy: { date: "desc" },
        include: {
          registeredBy: { select: { id: true, name: true } },
          authorizedBy: { select: { id: true, name: true } },
        },
      },
      stateHistory: {
        orderBy: { changedAt: "desc" },
        include: { changedBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!ev) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    ev.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json({ data: ev });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const ev = await prisma.timeEvent.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (ev.status !== "PENDING_AUTHORIZATION" && ev.status !== "PENDING_REVIEW") {
    return NextResponse.json(
      { error: `No se puede editar en estado ${ev.status}` },
      { status: 409 },
    );
  }

  const isOwner = ev.reportedByUserId === session!.user.id;
  const role    = session!.user.role;
  const isAdmin = role === "ADMIN" || role === "SUPERVISOR";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Solo quien registró el evento o un admin puede editar" }, { status: 403 });
  }
  if (role === "BRANCH_MANAGER" && ev.branchId !== session!.user.branchId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const expectedTime = data.expectedTime ?? ev.expectedTime;
  const actualTime   = data.actualTime   ?? ev.actualTime;

  const timesOk = validateTimes(ev.type, expectedTime, actualTime);
  if (!timesOk.valid) return NextResponse.json({ error: timesOk.error }, { status: 400 });

  const newOwed      = calculateMinutesOwed(ev.type, expectedTime, actualTime);
  const newRemaining = computeRemaining(ev.status, newOwed, ev.minutesCompensated);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.timeEvent.update({
      where: { id: params.id },
      data: {
        ...(data.expectedTime !== undefined && { expectedTime: data.expectedTime }),
        ...(data.actualTime   !== undefined && { actualTime:   data.actualTime }),
        ...(data.reason       !== undefined && { reason:       data.reason }),
        ...(data.reporterNote !== undefined && { reporterNote: data.reporterNote }),
        minutesOwed:      newOwed,
        minutesRemaining: newRemaining,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "TIME_EVENT_EDITED",
        entity:   "TimeEvent",
        entityId: params.id,
        detail: { newMinutesOwed: newOwed, newMinutesRemaining: newRemaining },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated });
}
