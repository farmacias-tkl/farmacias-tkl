/**
 * POST /api/call-center/conversations/[id]/close  — body: { note? }
 *
 * Cerrar: ASIGNADA → RESUELTA. Setea closedAt = now y CONSERVA assignedToUserId (último
 * operador responsable, necesario para métricas "resueltas por operador" — ver el ciclo
 * de vida en transitions.ts). RESUELTA NO es terminal: reabre por mensaje entrante en el
 * futuro (no en este sprint). Subconjunto de la whitelist.
 *
 * Concurrencia: validación dentro del $transaction; cambio por compare-and-swap → 409 si cambió.
 */
import { NextRequest, NextResponse } from "next/server";
import { ConversationStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canActOnCallCenter } from "@/lib/permissions";
import { canTransition } from "@/lib/call-center/transitions";
import { HttpError, errorToResponse } from "@/lib/call-center/http-error";

const schema = z.object({ note: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canActOnCallCenter(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const note = parsed.success ? parsed.data.note : undefined;
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
        throw new HttpError(409, `Solo se puede cerrar una conversación ASIGNADA (estado actual: ${from})`);
      }
      if (!canTransition(from, ConversationStatus.RESUELTA)) {
        throw new HttpError(409, "Transición no permitida");
      }

      const now = new Date();
      // Conserva assignedToUserId (no se nullea al cerrar).
      const cas = await tx.conversation.updateMany({
        where: { id: params.id, status: ConversationStatus.ASIGNADA, assignedToUserId: conv.assignedToUserId },
        data: { status: ConversationStatus.RESUELTA, closedAt: now },
      });
      if (cas.count === 0) throw new HttpError(409, "La conversación cambió; reintentá");

      await tx.conversationStateHistory.create({
        data: {
          conversationId: params.id,
          fromStatus: ConversationStatus.ASIGNADA,
          toStatus: ConversationStatus.RESUELTA,
          fromAssignedToUserId: conv.assignedToUserId,
          toAssignedToUserId: conv.assignedToUserId, // conservado
          changedByUserId: actorId,
          note,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "CALL_CENTER_CONVERSATION_CLOSED",
          entity: "Conversation",
          entityId: params.id,
          detail: {
            fromStatus: from,
            toStatus: ConversationStatus.RESUELTA,
            assignedToUserId: conv.assignedToUserId,
            note: note ?? null,
          },
        },
      });

      return { id: params.id, status: ConversationStatus.RESUELTA, assignedToUserId: conv.assignedToUserId, closedAt: now };
    });

    return NextResponse.json({ data });
  } catch (e) {
    return errorToResponse(e);
  }
}
