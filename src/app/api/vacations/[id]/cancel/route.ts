/**
 * POST /api/vacations/[id]/cancel
 *
 * Estados:
 *   - CANCELLED → 409.
 *   - APPROVED  → solo SUPERVISOR / HR / ADMIN / OWNER. Motivo OBLIGATORIO.
 *                 BRANCH_MANAGER NO puede cancelar una solicitud aprobada.
 *                 Audita igual que las demás cancelaciones (VACATION_CANCELLED
 *                 + VacationStateHistory). El detail.fromStatus = "APPROVED"
 *                 distingue las reversiones excepcionales en el AuditLog.
 *   - Resto     → cualquier rol con can.cancelVacation. Motivo opcional.
 *                 BRANCH_MANAGER restringido a su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const requiredNoteSchema = z.object({ note: z.string().min(1, "Motivo obligatorio") });
const optionalNoteSchema = z.object({ note: z.string().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const vacation = await prisma.vacationRequest.findUnique({ where: { id: params.id } });
  if (!vacation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  if (vacation.status === "CANCELLED") {
    return NextResponse.json({ error: "Ya está cancelada" }, { status: 409 });
  }

  const role = session!.user.role;
  const body = await req.json().catch(() => ({}));

  let note: string | undefined;

  if (vacation.status === "APPROVED") {
    // Reversión excepcional: SUPERVISOR / HR / ADMIN / OWNER, motivo obligatorio.
    // BRANCH_MANAGER queda explícitamente fuera.
    const canCancelApproved =
      role === "SUPERVISOR" || role === "HR" || role === "ADMIN" || role === "OWNER";
    if (!canCancelApproved) {
      return NextResponse.json(
        { error: "Solo Supervisor, RRHH, ADMIN u OWNER pueden cancelar una solicitud aprobada" },
        { status: 403 },
      );
    }
    const parsed = requiredNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Motivo obligatorio para cancelar una solicitud aprobada" },
        { status: 400 },
      );
    }
    note = parsed.data.note;
  } else {
    // Estados no aprobados: flujo original.
    const permErr = requireCan(can.cancelVacation, session);
    if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
    if (role === "BRANCH_MANAGER" && vacation.branchId !== session!.user.branchId) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const parsed = optionalNoteSchema.safeParse(body);
    note = parsed.success ? parsed.data.note : undefined;
  }

  const fromStatus = vacation.status;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.vacationRequest.update({
      where: { id: params.id },
      data: { status: "CANCELLED" },
    });
    await tx.vacationStateHistory.create({
      data: {
        vacationId:      params.id,
        fromStatus,
        toStatus:        "CANCELLED",
        changedByUserId: session!.user.id,
        note,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "VACATION_CANCELLED",
        entity:   "VacationRequest",
        entityId: params.id,
        detail: { fromStatus, note: note ?? null },
      },
    });
    return u;
  });

  return NextResponse.json({ data: updated });
}
