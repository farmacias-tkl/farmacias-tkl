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
  conversationExternalId,
  SUPPORTED_EVENTS,
} from "@/lib/call-center/emozion-mappers";
import { processWebhookEvent } from "@/lib/call-center/processor";
import { buildAttachmentCapture } from "@/lib/call-center/attachment-debug";

export const runtime = "nodejs";

const ACCOUNT_ID = 22;

// ───────────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO: EMOZION_DEBUG_CAPTURE (APAGADO por defecto). Cuando === "true", en vez del
// payload mínimo normalizado, WebhookEvent.payload guarda una vista ESTRUCTURAL del body
// real (nombres de claves, tipos, ids técnicos y la RUTA donde viven account_id /
// conversation id). Sirve para mapear un fork de Chatwoot cuyos campos están en otra ruta.
// NUNCA copia contenido ni PII (content/body/phone/name/email/identifier/custom_attributes/
// data_url/URLs): de esos solo nombre de clave + tipo. Es seguro dejarlo en el código
// (gateado); activar solo durante una prueba controlada y apagar después.
// ───────────────────────────────────────────────────────────────────────────────────
const PII_KEYS = new Set([
  "content", "body", "phone_number", "phone", "name", "email", "identifier",
  "custom_attributes", "additional_attributes", "data_url", "thumb_url",
  "source_url", "avatar_url", "thumbnail", "title", "description",
  // origen transitorio de copia (B6.1) — defensa en profundidad (no son keys del payload
  // Emozion, pero se listan por si algún objeto interno se mezclara en el capture):
  "sourceFetchUrl", "source_fetch_url", "sourcefetchurl",
]);

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function keysOf(o: unknown): string[] {
  return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as object) : [];
}
/** id técnico capturable: number, o string corto sin espacios (uuid/id). NO texto libre. */
function isIdLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.length > 0 && v.length <= 64 && !/\s/.test(v);
  return false;
}
/** Busca claves cuyo NOMBRE matchea nameRe; captura VALOR solo si es id técnico y no-PII. */
function findByKeyName(root: unknown, nameRe: RegExp): Array<{ path: string; type: string; value?: unknown }> {
  const hits: Array<{ path: string; type: string; value?: unknown }> = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object" || hits.length >= 40) return;
    if (Array.isArray(node)) { node.slice(0, 5).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (nameRe.test(k)) {
        const piiKey = PII_KEYS.has(k.toLowerCase());
        hits.push({ path: p, type: typeOf(v), ...(!piiKey && isIdLike(v) ? { value: v } : {}) });
      }
      if (v && typeof v === "object") walk(v, p, depth + 1);
    }
  };
  walk(root, "", 0);
  return hits;
}
/** Reporta las RUTAS donde aparece un valor técnico exacto (p.ej. el account_id 22). */
function findValuePaths(root: unknown, target: number): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object" || hits.length >= 20) return;
    if (Array.isArray(node)) { node.slice(0, 5).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (v === target || (typeof v === "string" && v === String(target))) hits.push(p);
      else if (v && typeof v === "object") walk(v, p, depth + 1);
    }
  };
  walk(root, "", 0);
  return hits;
}

/** Vista estructural sanitizada del body (sin contenido/PII) para diagnosticar el mapeo. */
function buildDebugCapture(raw: any, env: ReturnType<typeof readEnvelope>): unknown {
  const msg: any = env.message;
  const conv: any = env.conversation;
  const sender: any = msg?.sender ?? null;
  const meta: any = conv?.meta ?? null;
  return {
    _debug: "EMOZION_DEBUG_CAPTURE — estructura sanitizada, SIN contenido ni PII",
    eventTypeDetected: env.event,
    topLevelKeys: keysOf(raw),
    messageKeys: keysOf(msg),
    conversationKeys: keysOf(conv),
    senderKeys: keysOf(sender),
    metaKeys: keysOf(meta),
    presence: {
      tieneContact: !!(conv?.meta?.sender ?? raw?.contact),
      tieneConversation: !!conv,
      tieneSender: !!sender,
      tieneAttachments: Array.isArray(msg?.attachments) && msg.attachments.length > 0,
      tieneAccount: !!(raw?.account ?? raw?.account_id),
    },
    // ids técnicos del mensaje (NO PII): valores tal cual para diagnosticar el mapeo.
    messageIds: msg ? {
      id: msg.id ?? null,
      source_id: msg.source_id ?? null,
      message_type: msg.message_type ?? null,
      content_type: msg.content_type ?? null,
      created_at: msg.created_at ?? null, // timestamp técnico (diagnostica el sentAt=1970)
      sender_id: sender?.id ?? null,
      sender_type: sender?.type ?? null,
      sender_role: sender?.role ?? null,
    } : null,
    // Búsquedas dirigidas que resuelven el bug: dónde viven account_id y el id de conversación.
    search: {
      accountId22At: findValuePaths(raw, ACCOUNT_ID),
      conversationLikeFields: findByKeyName(raw, /conversation|chat|ticket|thread/i),
      accountLikeFields: findByKeyName(raw, /account|workspace|inbox/i),
    },
    // B2.0 — estructura PII-safe de attachments (SOLO message_created; nunca valores).
    // buildAttachmentCapture es accesorio y NUNCA lanza (try/catch interno); su falla no
    // afecta el WebhookEvent de dominio (esto corre fuera de la tx, en el receptor).
    ...(env.event === "message_created" ? { attachments: buildAttachmentCapture(msg?.attachments) } : {}),
  };
}

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
  // Fork real: el id de conversación es numérico (no uuid) → String(id) vía el helper del mapper.
  const externalConversationId = conversationExternalId(env.conversation);

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
      // Incluimos la conversación normalizada SI viene embebida (Chatwoot la trae en
      // message_created): permite al processor crear la conversación mínima si el mensaje
      // llega fuera de orden. Si no viene → conversation: null → el processor hará needsRetry.
      const rc = normalizeConversation(env.conversation);
      payload = {
        event: eventType,
        externalConversationId,
        message: r.data,
        conversation: rc.outcome === "processed" ? rc.data : null,
      };
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

  // DIAGNÓSTICO (gateado, apagado por defecto): si EMOZION_DEBUG_CAPTURE==="true", guardamos
  // la vista ESTRUCTURAL sanitizada (sin contenido/PII) en vez del payload normalizado. El
  // resto del flujo no cambia (se persiste y, si RECEIVED, se intenta procesar como siempre).
  if (process.env.EMOZION_DEBUG_CAPTURE === "true" && raw && typeof raw === "object") {
    payload = buildDebugCapture(raw, env);
  }

  // FALLBACK SEGURO: si no hubo payload mínimo normalizado, NO se guarda el body crudo.
  // Solo metadata + status IGNORED/ERROR. Las Dates del normalizado se serializan a ISO.
  const payloadJson = payload ? JSON.parse(JSON.stringify(payload)) : undefined;

  let eventId: string;
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
    eventId = ev.id;
    // Log sin payload/body/secret.
    console.log("[emozion-webhook]", JSON.stringify({ eventId: ev.id, eventType, accountId, externalConversationId, externalMessageId, status, error }));
  } catch (e) {
    // No se pudo ni persistir → 5xx para que Emozion reintente (única red de seguridad).
    console.error("[emozion-webhook] persist failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Procesamiento síncrono: solo para eventos RECEIVED (IGNORED/ERROR no tienen dominio que
  // procesar). Aunque el processor falle, respondemos 200 — el evento ya está persistido y
  // queda como ERROR para reproceso. El processor maneja su propia atomicidad y errores.
  if (status === "RECEIVED") {
    try {
      const result = await processWebhookEvent(eventId);
      console.log("[emozion-webhook] processed", JSON.stringify({ eventId, eventType, status: result.status, outcome: result.outcome }));
    } catch (e) {
      console.error("[emozion-webhook] processor threw:", e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json({ ok: true, status }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
