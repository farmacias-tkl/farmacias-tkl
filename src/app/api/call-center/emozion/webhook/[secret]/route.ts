/**
 * POST /api/call-center/emozion/webhook/[secret]  — Receptor del webhook de Emozion.
 * Sprint 4B, commit 3/4: RECEPTOR SEGURO + persiste WebhookEvent. NO procesa dominio
 * (eso es el commit 4/4: un processor que toma los WebhookEvent y llama a ingest.ts).
 *
 * Seguridad (no hay firma/HMAC en Emozion — confirmado): el secreto va en la URL.
 *  - secret incorrecto → 404 genérico (no confirmar que la ruta existe).
 *  - secret correcto → SIEMPRE persistir + 200, para no disparar reintentos de Emozion
 *    por eventos que simplemente no procesamos (account ajeno / evento fuera de whitelist).
 *  - 5xx solo si no se pudo ni persistir el WebhookEvent (ahí el retry de Emozion es la red).
 *
 * PII: el payload persistido es el MÍNIMO NORMALIZADO que producen los mappers puros del
 * commit 2 (sin custom_attributes/DNI/data_url). El body crudo del request NUNCA se guarda,
 * ni como fallback "para debug". Los logs nunca incluyen payload, body ni el secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  readEnvelope,
  normalizeConversation,
  normalizeMessage,
  normalizeStatusEvent,
  SUPPORTED_EVENTS,
} from "@/lib/call-center/emozion-mappers";

export const runtime = "nodejs";

const ACCOUNT_ID = 22;

export async function POST(req: NextRequest, { params }: { params: { secret: string } }) {
  const expected = process.env.EMOZION_WEBHOOK_SECRET;
  if (!expected) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  // 404 genérico: la única defensa es que el secret sea secreto; no revelar la ruta.
  if (params.secret !== expected) return new NextResponse("Not Found", { status: 404 });

  // Secret válido → a partir de acá SIEMPRE persistimos y respondemos 200 (salvo fallo de persistencia).
  const raw = await req.json().catch(() => null);
  const env = raw && typeof raw === "object" ? readEnvelope(raw) : { event: null, accountId: null, conversation: null, message: null };

  const eventType = env.event ?? "unknown";
  const accountId = env.accountId;
  const externalConversationId = env.conversation?.uuid ?? null;

  let status: "RECEIVED" | "IGNORED" | "ERROR" = "RECEIVED";
  let error: string | null = null;
  let payload: unknown = null;
  let externalMessageId: string | null = env.message?.source_id ?? null; // lectura plana; el fallback "emozion-message:<id>" es propiedad del mapper

  if (!raw || typeof raw !== "object") {
    status = "IGNORED";
    error = "payload no parseable";
  } else if (accountId !== ACCOUNT_ID) {
    status = "IGNORED";
    error = `account_id ${String(accountId)} != ${ACCOUNT_ID}`;
  } else if (!(SUPPORTED_EVENTS as readonly string[]).includes(eventType)) {
    status = "IGNORED";
    error = `evento fuera de whitelist: ${eventType}`;
  } else if (eventType === "conversation_created") {
    const r = normalizeConversation(env.conversation);
    if (r.outcome === "processed") payload = { event: eventType, conversation: r.data };
    else { status = "ERROR"; error = `conversación incompleta: ${r.warnings.join("; ")}`; }
  } else if (eventType === "message_created") {
    const r = normalizeMessage(env.message);
    if (r.outcome === "processed") {
      payload = { event: eventType, externalConversationId, message: r.data };
      externalMessageId = r.data!.externalMessageId; // mapper = fuente única del fallback de id
    } else if (r.outcome === "ignored") {
      status = "IGNORED";
      error = "activity (message_type 2) — no se procesa";
    } else {
      status = "ERROR";
      error = `mensaje incompleto: ${r.warnings.join("; ")}`;
    }
  } else if (eventType === "conversation_status_changed") {
    const r = normalizeStatusEvent(env.conversation);
    if (r.outcome === "processed") payload = { event: eventType, statusEvent: r.data };
    else { status = "ERROR"; error = `status change incompleto: ${r.warnings.join("; ")}`; }
  }

  // FALLBACK SEGURO: si no hubo payload mínimo normalizado, NO se guarda el body crudo.
  // Solo metadata + status IGNORED/ERROR. Las Dates del normalizado se serializan a ISO.
  const payloadJson = payload ? JSON.parse(JSON.stringify(payload)) : undefined;

  try {
    const ev = await prisma.webhookEvent.create({
      data: {
        source: "EMOZION",
        eventType,
        accountId: accountId ?? 0, // 0 = desconocido (payload no parseable)
        externalConversationId,
        externalMessageId,
        payload: payloadJson,
        status,
        attempts: 0,
        error,
      },
      select: { id: true },
    });
    // Log sin payload/body/secret.
    console.log("[emozion-webhook]", JSON.stringify({ eventId: ev.id, eventType, accountId, externalConversationId, externalMessageId, status, error }));
    return NextResponse.json({ ok: true, status }, { status: 200 });
  } catch (e) {
    // No se pudo ni persistir → 5xx para que Emozion reintente.
    console.error("[emozion-webhook] persist failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
