/**
 * GET   /api/vacations/[id] — detalle con historial
 * PATCH /api/vacations/[id] — editar fechas/observación, solo en PENDING_SUPERVISOR
 *
 * Edición:
 *   - Solo PENDING_SUPERVISOR.
 *   - Recalcula validación. Si BLOCKING → rechaza.
 *   - Recalcula conflictLevel y conflictReasons.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth } from "@/lib/permissions";
import { z } from "zod";
import { validateVacationRequest } from "@/lib/vacations/validation";
import { Prisma } from "@prisma/client";

const patchSchema = z.object({
  startDate:     z.string().optional().transform(d => d ? new Date(d) : undefined),
  endDate:       z.string().optional().transform(d => d ? new Date(d) : undefined),
  requesterNote: z.string().optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const vacation = await prisma.vacationRequest.findUnique({
    where: { id: params.id },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, isRotating: true } },
      branch:   { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      requestedBy:        { select: { id: true, name: true } },
      supervisorActionBy: { select: { id: true, name: true } },
      rrhhActionBy:       { select: { id: true, name: true } },
      stateHistory: {
        orderBy: { changedAt: "desc" },
        include: { changedBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!vacation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    vacation.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json({ data: vacation });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const vacation = await prisma.vacationRequest.findUnique({ where: { id: params.id } });
  if (!vacation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  // Solo PENDING_SUPERVISOR es editable
  if (vacation.status !== "PENDING_SUPERVISOR") {
    return NextResponse.json(
      { error: `No se puede editar una solicitud en estado ${vacation.status}` },
      { status: 409 },
    );
  }

  // Solo el solicitante o un admin/supervisor
  const isOwner   = vacation.requestedByUserId === session!.user.id;
  const isAdmin   = session!.user.role === "ADMIN" || session!.user.role === "SUPERVISOR";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Solo el solicitante o un admin puede editar" }, { status: 403 });
  }

  // BRANCH_MANAGER restringido a su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    vacation.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const startDate = data.startDate ?? vacation.startDate;
  const endDate   = data.endDate   ?? vacation.endDate;

  const validation = await validateVacationRequest({
    employeeId: vacation.employeeId,
    startDate,
    endDate,
    excludeRequestId: vacation.id,
  });
  if (!validation.isValid) {
    return NextResponse.json(
      { error: "La solicitud tiene conflictos bloqueantes", validation },
      { status: 409 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.vacationRequest.update({
      where: { id: params.id },
      data: {
        ...(data.startDate     !== undefined && { startDate: data.startDate }),
        ...(data.endDate       !== undefined && { endDate:   data.endDate }),
        ...(data.requesterNote !== undefined && { requesterNote: data.requesterNote }),
        daysCount: validation.calculatedDays,
        conflictLevel:   validation.conflictLevel,
        conflictReasons: (validation.warnings.length
          ? { warnings: validation.warnings, ruleResults: validation.ruleResults }
          : { ruleResults: validation.ruleResults }) as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "VACATION_REQUEST_EDITED",
        entity:   "VacationRequest",
        entityId: params.id,
        detail: {
          startDate: startDate.toISOString().slice(0, 10),
          endDate:   endDate.toISOString().slice(0, 10),
          days:      validation.calculatedDays,
          conflictLevel: validation.conflictLevel,
        },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated, validation });
}
