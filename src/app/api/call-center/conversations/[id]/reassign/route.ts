/**
 * POST /api/call-center/conversations/[id]/reassign  — body: { toAssignedToUserId }
 *
 * Reasignar: ASIGNADA → ASIGNADA cambiando de dueño. Subconjunto de la whitelist.
 * Requiere que la conversación esté ASIGNADA. Rechaza no-op (mismo asignado actual) y
 * targets no asignables (sin acceso efectivo a Call Center o inactivos).
 *
 * Concurrencia: lectura + validación dentro del $transaction; cambio por compare-and-swap
 * (precondición status=ASIGNADA + assignedToUserId actual en el WHERE) → 409 si cambió.
 */
import { NextRequest, NextResponse } from "next/server";
import { ConversationStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canActOnCallCenter, canViewCallCenter } from "@/lib/permissions";
import { canTransition } from "@/lib/call-center/transitions";
import { HttpError, errorToResponse } from "@/lib/call-center/http-error";

const schema = z.object({ toAssignedToUserId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canActOnCallCenter(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const targetId = parsed.data.toAssignedToUserId;
  const actorId = session.user.id;

  try {
    const data = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.findUnique({
        where: { id: params.id },
        select: { id: true, status: true, assignedToUserId: true },
      });
      if (!conv) throw new HttpError(404, "Conversación no encontrada");

      const from = conv.status;
      if (from !== ConversationStatus.ASIGNADA) {
        throw new HttpError(409, `Solo se puede reasignar una conversación ASIGNADA (estado actual: ${from})`);
      }
      if (conv.assignedToUserId === targetId) {
        throw new HttpError(400, "La conversación ya está asignada a ese operador");
      }

      // Target asignable = acceso efectivo a Call Center (misma fuente única) y activo.
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, active: true, callCenterAccess: true },
      });
      if (!target || !target.active) throw new HttpError(404, "Operador no encontrado o inactivo");
      if (!canViewCallCenter(target)) throw new HttpError(400, "El operador no tiene acceso a Call Center");

      if (!canTransition(from, ConversationStatus.ASIGNADA)) {
        throw new HttpError(409, "Transición no permitida");
      }

      const cas = await tx.conversation.updateMany({
        where: { id: params.id, status: ConversationStatus.ASIGNADA, assignedToUserId: conv.assignedToUserId },
        data: { assignedToUserId: targetId },
      });
      if (cas.count === 0) throw new HttpError(409, "La conversación cambió; reintentá");

      await tx.conversationStateHistory.create({
        data: {
          conversationId: params.id,
          fromStatus: ConversationStatus.ASIGNADA,
          toStatus: ConversationStatus.ASIGNADA,
          fromAssignedToUserId: conv.assignedToUserId,
          toAssignedToUserId: targetId,
          changedByUserId: actorId,
          note: "Reasignación",
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "CALL_CENTER_CONVERSATION_REASSIGNED",
          entity: "Conversation",
          entityId: params.id,
          detail: {
            fromStatus: from,
            toStatus: ConversationStatus.ASIGNADA,
            fromAssignedToUserId: conv.assignedToUserId,
            toAssignedToUserId: targetId,
          },
        },
      });

      return { id: params.id, status: ConversationStatus.ASIGNADA, assignedToUserId: targetId };
    });

    return NextResponse.json({ data });
  } catch (e) {
    return errorToResponse(e);
  }
}
