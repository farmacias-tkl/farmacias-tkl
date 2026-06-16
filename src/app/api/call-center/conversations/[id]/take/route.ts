/**
 * POST /api/call-center/conversations/[id]/take
 *
 * Tomar una conversación: SIN_ASIGNAR → ASIGNADA, assignedToUserId = operador actor.
 * Subconjunto de la whitelist (transitions.ts); la whitelist no se toca.
 *
 * Concurrencia: la validación de estado se hace DENTRO del $transaction y el cambio
 * se aplica con compare-and-swap (updateMany con la precondición en el WHERE). Si dos
 * operadores toman la misma SIN_ASIGNAR a la vez, el segundo cae en count 0 → 409 limpio.
 */
import { NextRequest, NextResponse } from "next/server";
import { ConversationStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canActOnCallCenter } from "@/lib/permissions";
import { canTransition } from "@/lib/call-center/transitions";
import { HttpError, errorToResponse } from "@/lib/call-center/http-error";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canActOnCallCenter(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const actorId = session.user.id;

  try {
    const data = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.findUnique({
        where: { id: params.id },
        select: { id: true, status: true, assignedToUserId: true },
      });
      if (!conv) throw new HttpError(404, "Conversación no encontrada");

      const from = conv.status;
      if (from !== ConversationStatus.SIN_ASIGNAR) {
        throw new HttpError(409, `Solo se puede tomar una conversación SIN_ASIGNAR (estado actual: ${from})`);
      }
      if (!canTransition(from, ConversationStatus.ASIGNADA)) {
        throw new HttpError(409, "Transición no permitida");
      }

      const cas = await tx.conversation.updateMany({
        where: { id: params.id, status: ConversationStatus.SIN_ASIGNAR, assignedToUserId: null },
        data: { status: ConversationStatus.ASIGNADA, assignedToUserId: actorId },
      });
      if (cas.count === 0) throw new HttpError(409, "La conversación ya fue tomada por otro operador");

      await tx.conversationStateHistory.create({
        data: {
          conversationId: params.id,
          fromStatus: ConversationStatus.SIN_ASIGNAR,
          toStatus: ConversationStatus.ASIGNADA,
          toAssignedToUserId: actorId,
          changedByUserId: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "CALL_CENTER_CONVERSATION_TAKEN",
          entity: "Conversation",
          entityId: params.id,
          detail: { fromStatus: from, toStatus: ConversationStatus.ASIGNADA, toAssignedToUserId: actorId },
        },
      });

      return { id: params.id, status: ConversationStatus.ASIGNADA, assignedToUserId: actorId };
    });

    return NextResponse.json({ data });
  } catch (e) {
    return errorToResponse(e);
  }
}
