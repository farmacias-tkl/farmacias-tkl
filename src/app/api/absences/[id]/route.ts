/**
 * GET   /api/absences/[id]   — detalle
 * PATCH /api/absences/[id]   — cambio de estado, notas, certificado, datos LATE_ARRIVAL
 *
 * Cualquier cambio de status:
 *   - escribe en AuditLog (action ABSENCE_STATUS_CHANGED)
 *   - crea registro en AbsenceStateHistory
 * Si falla la auditoría se loguea con console.error y el error se propaga.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth } from "@/lib/permissions";
import { z } from "zod";
import type { AbsenceStatus, AbsenceType } from "@prisma/client";

const ABSENCE_STATUSES = [
  "REPORTED", "JUSTIFIED", "UNJUSTIFIED", "UNDER_REVIEW", "CLOSED",
] as const;

const patchSchema = z.object({
  status:               z.enum(ABSENCE_STATUSES).optional(),
  notes:                z.string().optional().nullable(),
  hasCertificate:       z.boolean().optional(),
  certificateUntil:     z.string().optional().nullable()
                          .transform(d => d === undefined ? undefined : (d ? new Date(d) : null)),
  reasonDetail:         z.string().optional().nullable(),
  // Solo aplican a LATE_ARRIVAL
  absenceType:          z.string().optional(),
  expectedArrivalTime:  z.string().optional().nullable()
                          .transform(d => d === undefined ? undefined : (d ? new Date(d) : null)),
  actualArrivalTime:    z.string().optional().nullable()
                          .transform(d => d === undefined ? undefined : (d ? new Date(d) : null)),
  lateMinutes:          z.number().int().optional().nullable(),
  // Nota para el historial de transición
  stateChangeNote:      z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const absence = await prisma.absenceRecord.findUnique({
    where: { id: params.id },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true,
          position: { select: { name: true } },
        },
      },
      branch: { select: { id: true, name: true } },
      stateHistory: {
        orderBy: { changedAt: "desc" },
        include: {
          changedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!absence) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    absence.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json({ data: absence });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const absence = await prisma.absenceRecord.findUnique({ where: { id: params.id } });
  if (!absence) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    absence.branchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  if (data.status && !can.justifyAbsence(session!.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Validación LATE_ARRIVAL: si el body declara o el registro ya es LATE_ARRIVAL
  // y se están seteando los tiempos, exigir ambos
  const targetType = (data.absenceType ?? absence.absenceType) as AbsenceType;
  if (targetType === "LATE_ARRIVAL") {
    const expected = data.expectedArrivalTime !== undefined
      ? data.expectedArrivalTime : absence.expectedArrivalTime;
    const actual = data.actualArrivalTime !== undefined
      ? data.actualArrivalTime : absence.actualArrivalTime;

    // Solo bloquear si el cliente está intentando setear uno solo de los dos
    const touchingTimes =
      data.expectedArrivalTime !== undefined ||
      data.actualArrivalTime !== undefined ||
      data.absenceType === "LATE_ARRIVAL";

    if (touchingTimes && (!expected || !actual)) {
      return NextResponse.json(
        { error: "LATE_ARRIVAL requiere expectedArrivalTime y actualArrivalTime" },
        { status: 400 }
      );
    }

    if (expected && actual && actual <= expected) {
      return NextResponse.json(
        { error: "actualArrivalTime debe ser posterior a expectedArrivalTime" },
        { status: 400 }
      );
    }
  }

  // Calcular lateMinutes si vienen ambos tiempos pero no se mandó explícito
  let computedLateMinutes: number | undefined;
  if (
    data.lateMinutes === undefined &&
    data.expectedArrivalTime !== undefined &&
    data.actualArrivalTime !== undefined &&
    data.expectedArrivalTime &&
    data.actualArrivalTime
  ) {
    computedLateMinutes = Math.round(
      (data.actualArrivalTime.getTime() - data.expectedArrivalTime.getTime()) / 60000
    );
  }

  const isStatusChange = data.status && data.status !== absence.status;
  const fromStatus = absence.status as AbsenceStatus;
  const toStatus = (data.status ?? absence.status) as AbsenceStatus;

  // Update + auditoría + historial en una sola transacción
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.absenceRecord.update({
      where: { id: params.id },
      data: {
        ...(data.status !== undefined         && { status: data.status }),
        ...(data.notes !== undefined          && { notes: data.notes }),
        ...(data.hasCertificate !== undefined && { hasCertificate: data.hasCertificate }),
        ...(data.certificateUntil !== undefined && { certificateUntil: data.certificateUntil }),
        ...(data.reasonDetail !== undefined   && { reasonDetail: data.reasonDetail }),
        ...(data.absenceType !== undefined    && { absenceType: data.absenceType as AbsenceType }),
        ...(data.expectedArrivalTime !== undefined && { expectedArrivalTime: data.expectedArrivalTime }),
        ...(data.actualArrivalTime !== undefined   && { actualArrivalTime: data.actualArrivalTime }),
        ...(data.lateMinutes !== undefined
            ? { lateMinutes: data.lateMinutes }
            : computedLateMinutes !== undefined
              ? { lateMinutes: computedLateMinutes }
              : {}),
      },
    });

    if (isStatusChange) {
      await tx.absenceStateHistory.create({
        data: {
          absenceId:       params.id,
          fromStatus,
          toStatus,
          changedByUserId: session!.user.id,
          note:            data.stateChangeNote,
        },
      });

      await tx.auditLog.create({
        data: {
          userId:   session!.user.id,
          action:   "ABSENCE_STATUS_CHANGED",
          entity:   "AbsenceRecord",
          entityId: params.id,
          detail: {
            fromStatus,
            toStatus,
            note: data.stateChangeNote ?? null,
          },
        },
      });
    }

    return u;
  }).catch((err) => {
    console.error("[PATCH /api/absences/[id]] error en transacción:", err);
    throw err;
  });

  return NextResponse.json({ data: updated });
}
