import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  upsertConversationFromEmozion,
  upsertMessageFromEmozion,
  applyStatusChangedFromEmozion,
  applyConversationUpdatedFromEmozion,
} from "./ingest";
import { parseTransientSourceUrls } from "./attachment-source";
import { safeErrorCode } from "./safe-error";
import { loadClosureLabels, loadSystemAccounts } from "./closure-labels";
import type { NormalizedConversation, NormalizedMessage, NormalizedStatusEvent, NormalizedUpdateEvent } from "./emozion-types";

/**
 * Processor del webhook Emozion (Sprint 4B, commit 4/4). Toma un WebhookEvent (RECEIVED),
 * lo transforma en dominio llamando a ingest.ts, y cierra el circuito.
 *
 * ATOMICIDAD (firme): el dominio va en UNA transacción; la marca del WebhookEvent
 * (PROCESSED/ERROR) y el SyncLog se escriben DESPUÉS, FUERA de esa transacción. Si el
 * dominio falla → rollback del dominio (nada parcial), pero el WebhookEvent ERROR + el
 * SyncLog ERROR sobreviven (la marca de "qué pasó" nunca se pierde con el rollback).
 *
 * SyncLog SOLO en fallo (ERROR/PARTIAL): el éxito ya queda en WebhookEvent
 * (status PROCESSED + processedAt); una fila de SyncLog por webhook exitoso era
 * redundante y hacía crecer la tabla sin lectores.
 *
 * Fuera-de-orden: SIN reconsulta a Emozion. message_created sin conversación previa y sin
 * datos de conversación en el payload → ERROR (needsRetry), dominio intacto. La reconsulta
 * es mejora futura (no se usa el token de Emozion acá).
 */

type DomainOutcome = "processed" | "needsRetry" | "insufficientData" | "error";

/**
 * Códigos FIJOS de ProcessError (B6.3-C2b): lo único que llega a los sumideros
 * (WebhookEvent.error / SyncLog) vía safeErrorCode. Sin texto libre ni valores.
 */
type ProcessErrorCode =
  | "PAYLOAD_MISSING"
  | "CONVERSATION_PAYLOAD_INVALID"
  | "MESSAGE_PAYLOAD_INVALID"
  | "STATUS_PAYLOAD_INVALID"
  | "UPDATE_PAYLOAD_INVALID"
  | "MESSAGE_OUT_OF_ORDER"
  | "STATUS_OUT_OF_ORDER"
  | "UPDATE_OUT_OF_ORDER"
  | "CONCURRENT_DUPLICATE"
  | "EVENT_TYPE_UNSUPPORTED";

class ProcessError extends Error {
  constructor(public readonly outcome: DomainOutcome, public readonly code: ProcessErrorCode) {
    super(code);
    this.name = "ProcessError";
  }
}

export interface ProcessResult {
  status: "PROCESSED" | "ERROR";
  outcome: DomainOutcome;
  warnings: string[];
  error: string | null;
}

/**
 * Únicos @unique cuya violación (P2002) es idempotencia VÁLIDA de evento (mismo evento
 * repetido / dos webhooks concurrentes del mismo evento). Cualquier otro target —en
 * particular Customer.phone (carrera de clientes recurrentes)— NO es idempotencia: marca
 * ERROR, no se pierde el evento.
 *
 * sourceExternalId (B2.2): ConversationAttachment.sourceExternalId. El loop find-create-if-absent
 * cubre el caso normal; este target es la RED para la carrera concurrente (dos tx pasan el
 * findUnique viendo el adjunto ausente y ambas create → una gana, la otra P2002 → idempotente).
 * No colisiona por substring con otros constraints (Customer.phone, etc. siguen ERROR).
 */
export const DOMAIN_IDEMPOTENCY_TARGETS = ["externalConversationId", "externalMessageId", "sourceExternalId"] as const;

/**
 * Targets de un P2002, normalizados a string[]. Prisma devuelve `meta.target` como array
 * de columnas o como string (nombre de constraint) según versión/DB → soportamos ambas.
 * Devuelve [] si es P2002 sin target (conservador), null si NO es P2002.
 */
export function getUniqueViolationTarget(e: unknown): string[] | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const t = (e.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(t)) return t.map((x) => String(x));
  if (typeof t === "string") return [t];
  return [];
}

/**
 * ¿El P2002 es de un @unique de idempotencia de dominio (externalConversationId/
 * externalMessageId)? Acepta tanto el nombre de columna como el de constraint
 * ("Conversation_externalConversationId_key"). Target ausente → false (ERROR conservador).
 */
export function isDomainIdempotencyUniqueViolation(e: unknown): boolean {
  const targets = getUniqueViolationTarget(e);
  if (!targets || targets.length === 0) return false;
  return targets.every((t) => DOMAIN_IDEMPOTENCY_TARGETS.some((col) => t === col || t.includes(col)));
}

// El payload persistido serializa Dates a ISO (JSON). Re-hidratamos antes de pasar a ingest.
const toDate = (v: unknown): Date | null => (v ? new Date(v as string) : null);
function hydrateConversation(c: any): NormalizedConversation {
  if (!c || typeof c !== "object") throw new ProcessError("error", "CONVERSATION_PAYLOAD_INVALID");
  return { ...c, firstResponseAt: toDate(c.firstResponseAt), closedAt: toDate(c.closedAt), externalCreatedAt: toDate(c.externalCreatedAt), assigneeEventAt: toDate(c.assigneeEventAt) };
}
function hydrateMessage(m: any): NormalizedMessage {
  if (!m || typeof m !== "object") throw new ProcessError("error", "MESSAGE_PAYLOAD_INVALID");
  return { ...m, sentAt: m.sentAt ? new Date(m.sentAt) : new Date(0) };
}
function hydrateStatusEvent(s: any): NormalizedStatusEvent {
  if (!s || typeof s !== "object") throw new ProcessError("error", "STATUS_PAYLOAD_INVALID");
  return { ...s, closedAt: toDate(s.closedAt), assigneeEventAt: toDate(s.assigneeEventAt) };
}

function hydrateUpdateEvent(u: any): NormalizedUpdateEvent {
  if (!u || typeof u !== "object" || typeof u.externalConversationId !== "string") throw new ProcessError("error", "UPDATE_PAYLOAD_INVALID");
  return {
    externalConversationId: u.externalConversationId,
    resolved: u.resolved === true,
    assigneePresent: u.assigneePresent === true,
    externalAssigneeId: typeof u.externalAssigneeId === "string" ? u.externalAssigneeId : null,
    externalAssigneeType: u.externalAssigneeType === "USER" || u.externalAssigneeType === "AGENT_BOT" ? u.externalAssigneeType : null,
    closureTypeId: typeof u.closureTypeId === "string" ? u.closureTypeId : null,
    closureTypeName: typeof u.closureTypeName === "string" ? u.closureTypeName : null,
    eventAt: toDate(u.eventAt),
    assigneeEventAt: toDate(u.assigneeEventAt),
    labels: Array.isArray(u.labels) ? u.labels.filter((l: unknown): l is string => typeof l === "string") : null,
  };
}

/** Veces que se corre la transacción de un evento cuando choca con otro simultáneo. */
const TX_ATTEMPTS = 3;

/**
 * Eventos que quedaron PENDIENTES y se pueden reintentar: llegaron antes que el alta de su
 * conversación, o chocaron con otro simultáneo. Conservan su contenido. No entran acá los
 * errores viejos de otro formato, ni los que fallaron por otra causa.
 */
export const RETRYABLE_ERROR_CODES = ["MESSAGE_OUT_OF_ORDER", "STATUS_OUT_OF_ORDER", "UPDATE_OUT_OF_ORDER", "CONCURRENT_DUPLICATE"] as const;
export const RETRY_MAX_ATTEMPTS = 5;
export const RETRY_WINDOW_HOURS = 48;

/**
 * Reintenta los eventos pendientes de UNA conversación, del más viejo al más nuevo. Se llama
 * después de procesar bien otro evento de esa conversación (que pudo haberla creado). Cada
 * dato respeta el orden de los eventos, así que aplicar tarde uno viejo no pisa lo nuevo.
 *
 * Solo repara datos de la ingesta: no envía nada a Emozion ni dispara ninguna acción.
 * Pasados RETRY_MAX_ATTEMPTS intentos o RETRY_WINDOW_HOURS horas, el evento queda en ERROR.
 */
export async function retryPendingEvents(externalConversationId: string, excludeId: string | null = null, now: Date = new Date()): Promise<{ retried: number; processed: number }> {
  const pending = await prisma.webhookEvent.findMany({
    where: {
      externalConversationId,
      status: "ERROR",
      attempts: { lt: RETRY_MAX_ATTEMPTS },
      receivedAt: { gte: new Date(now.getTime() - RETRY_WINDOW_HOURS * 3_600_000) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: RETRYABLE_ERROR_CODES.map((code) => ({ error: { contains: code } })),
    },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true },
  });
  let processed = 0;
  for (const ev of pending) {
    const r = await processWebhookEvent(ev.id);
    if (r.status === "PROCESSED") processed++;
  }
  return { retried: pending.length, processed };
}

export async function processWebhookEvent(webhookEventId: string): Promise<ProcessResult> {
  const ev = await prisma.webhookEvent.findUnique({
    where: { id: webhookEventId },
    select: { id: true, eventType: true, payload: true, transientSourceUrls: true, receivedAt: true },
  });
  if (!ev) return { status: "ERROR", outcome: "error", warnings: [], error: "WebhookEvent no encontrado" };

  const warnings: string[] = [];
  // Etiquetas de cierre y cuentas de sistema de la configuración vigente: solo hacen falta
  // para estos dos eventos.
  const usesConfig = ev.eventType === "conversation_status_changed" || ev.eventType === "conversation_updated";
  const closureLabels = usesConfig ? await loadClosureLabels() : new Set<string>();
  const systemAccounts = usesConfig ? await loadSystemAccounts() : new Set<string>();
  let domainOk = false;
  let outcome: DomainOutcome = "processed";
  let errorMsg: string | null = null;

  // ── (1) Transacción de dominio SOLO ──────────────────────────────────────────────
  // Una colisión de un @unique de dominio revierte TODA la transacción: no alcanza para dar
  // el evento por procesado, porque otro evento pudo crear la conversación y este traía un
  // mensaje distinto. Se vuelve a correr: ahora encuentra lo que el otro creó y aplica lo
  // suyo. Las operaciones son idempotentes, así que repetir no duplica.
  for (let attempt = 1; attempt <= TX_ATTEMPTS && !domainOk; attempt++) {
  warnings.length = 0;
  errorMsg = null;
  try {
    await prisma.$transaction(async (tx) => {
      const payload = ev.payload as any;
      if (!payload || typeof payload !== "object") throw new ProcessError("error", "PAYLOAD_MISSING");

      switch (ev.eventType) {
        case "conversation_created": {
          const r = await upsertConversationFromEmozion(tx, hydrateConversation(payload.conversation));
          warnings.push(...r.warnings);
          break;
        }
        case "message_created": {
          // externalConversationId puede ser null (mensaje sin conversación embebida):
          // no llamar findUnique con null (tiraría error); va directo a la rama de orden.
          let conv = payload.externalConversationId
            ? await tx.conversation.findUnique({
                where: { externalConversationId: payload.externalConversationId },
                select: { id: true },
              })
            : null;
          if (!conv) {
            // fuera de orden: crear mínima SOLO si el payload trae la conversación normalizada.
            if (payload.conversation) {
              const rc = await upsertConversationFromEmozion(tx, hydrateConversation(payload.conversation));
              warnings.push(...rc.warnings);
              conv = { id: rc.conversationId };
            } else {
              // message_created fuera de orden y sin datos de conversación en el payload.
              throw new ProcessError("needsRetry", "MESSAGE_OUT_OF_ORDER");
            }
          }
          // B6.3-C2: origen transitorio de adjuntos (fuera de payload). capturedAt = receivedAt
          // → el TTL mide la edad real de la URL aunque el evento se reprocese más tarde.
          const sourceCtx = parseTransientSourceUrls(ev.transientSourceUrls, ev.receivedAt);
          const r = await upsertMessageFromEmozion(tx, conv.id, hydrateMessage(payload.message), sourceCtx);
          warnings.push(...r.warnings);
          break;
        }
        case "conversation_status_changed": {
          const r = await applyStatusChangedFromEmozion(tx, hydrateStatusEvent(payload.statusEvent), closureLabels, systemAccounts);
          warnings.push(...r.warnings);
          // status change sobre conversación inexistente (fuera de orden).
          if (r.outcome === "needsRetry") throw new ProcessError("needsRetry", "STATUS_OUT_OF_ORDER");
          break;
        }
        case "conversation_updated": {
          // Solo tipo de cierre, asignado y etiquetas: sin mensajes, sin cambio de estado, sin filas nuevas.
          const r = await applyConversationUpdatedFromEmozion(tx, hydrateUpdateEvent(payload.updateEvent), closureLabels, systemAccounts);
          warnings.push(...r.warnings);
          // Llegó antes que el alta de la conversación: queda pendiente, no se da por procesado.
          if (r.outcome === "needsRetry") throw new ProcessError("needsRetry", "UPDATE_OUT_OF_ORDER");
          break;
        }
        default:
          throw new ProcessError("error", "EVENT_TYPE_UNSUPPORTED");
      }
    });
    domainOk = true;
    outcome = "processed";
    if (attempt > 1) warnings.push("reintentado tras una colisión con otro evento simultáneo: el efecto quedó aplicado");
  } catch (e) {
    // Cualquier colisión de un @unique (también la del teléfono del cliente, cuando dos eventos
    // crean al mismo cliente a la vez) es una carrera con otro evento: se reintenta.
    if (getUniqueViolationTarget(e) !== null && attempt < TX_ATTEMPTS) continue;
    if (isDomainIdempotencyUniqueViolation(e)) {
      // Sigue chocando después de los intentos: NO se marca procesado. Queda pendiente con su
      // contenido y se reintenta con el próximo evento de la conversación.
      outcome = "needsRetry";
      errorMsg = safeErrorCode(new ProcessError("needsRetry", "CONCURRENT_DUPLICATE"), "processor.tx");
    } else if (getUniqueViolationTarget(e) !== null) {
      // P2002 de OTRO constraint (p.ej. Customer.phone — carrera de cliente recurrente) o
      // sin target → NO idempotente. NO se marca PROCESSED: fluye como ERROR por la misma
      // estructura de atomicidad (la marca se escribe FUERA de la tx rolleada, abajo).
      // B6.3-C2b: código seguro (incluye P2002 + target solo si son nombres de columna).
      outcome = "error";
      errorMsg = safeErrorCode(e, "processor.tx");
    } else if (e instanceof ProcessError) {
      outcome = e.outcome;
      errorMsg = safeErrorCode(e, "processor.tx"); // "processor.tx|ProcessError|<código fijo>|"
    } else {
      // B6.3-C2b: NUNCA e.message (Prisma incluye los args: URLs de origen, texto de clientes).
      outcome = "error";
      errorMsg = safeErrorCode(e, "processor.tx");
    }
    break;
  }
  }

  // ── (2) FUERA de la transacción de dominio: marca (+ SyncLog solo en fallo) ──
  if (domainOk) {
    await prisma.webhookEvent.update({
      where: { id: ev.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        payload: Prisma.JsonNull, // minimización: el dato ya vive en el dominio
        // B6.3-C2: origen transitorio anulado en el MISMO update. DbNull (SQL NULL), NO JsonNull:
        // los barridos e invariantes usan `IS NULL`.
        transientSourceUrls: Prisma.DbNull,
        error: warnings.length ? warnings.join("; ").slice(0, 500) : null,
      },
      select: { id: true },
    });
    return { status: "PROCESSED", outcome, warnings, error: null };
  }

  // dominio falló / needsRetry / insufficientData → ERROR; payload SE CONSERVA para reproceso.
  // transientSourceUrls también se conserva (lo limpia el barrido TTL de 72h, C3).
  await prisma.webhookEvent.update({
    where: { id: ev.id },
    data: { status: "ERROR", attempts: { increment: 1 }, error: (errorMsg ?? "error").slice(0, 500) },
  });
  await prisma.syncLog.create({
    data: {
      source: "EMOZION",
      status: outcome === "needsRetry" || outcome === "insufficientData" ? "PARTIAL" : "ERROR",
      message: `webhook ${ev.eventType}: ${outcome}`,
      rowsProcessed: 0,
      warnings: errorMsg ? [errorMsg] : undefined,
      syncDate: new Date(),
      triggeredBy: "WEBHOOK",
    },
  });
  return { status: "ERROR", outcome, warnings, error: errorMsg };
}
