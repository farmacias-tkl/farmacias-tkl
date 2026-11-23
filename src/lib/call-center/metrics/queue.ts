/**
 * La cola del Call Center: quién está esperando una respuesta ahora.
 *
 * Un EPISODIO EN ESPERA es una conversación cuyo último mensaje público, entre cliente y
 * operador, es del cliente. La definición mira los mensajes, no el estado: casi todas las
 * conversaciones terminan RESUELTA aunque nadie haya respondido.
 *
 * Reglas (revisión r2 de la Fase A):
 *  - no exige que haya salida del bot registrada: los que no la tienen se cuentan aparte;
 *  - no hay ventana de tiempo en el conteo: las abiertas entran con cualquier antigüedad y
 *    las cerradas se abren por antigüedad. Las 72 horas son solo el filtro de la lista;
 *  - "abiertas esperando" y "cerradas sin respuesta" van por separado;
 *  - los candidatos a agradecimiento se cuentan aparte y NO salen de ningún total.
 *
 * Alcance de la consulta: todas las conversaciones abiertas (cualquier fecha) más las
 * creadas desde `since`. Un cliente que vuelve a escribir después de un cierre abre una
 * conversación nueva, así que una conversación vieja y cerrada no recibe mensajes nuevos.
 * El histórico anterior a `since` se consulta aparte (countClosedUnansweredBefore).
 *
 * Ninguna fila lleva teléfono, nombre ni texto del cliente: solo ids internos, horas y marcas.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestampParam } from "./business-time";
import type { AgeBucket, QueueGroupCounts } from "./queue-types";
import { BOT_ACCOUNT_PREFIX } from "./account-label";
import { BOT_ORDER_COMPLETE_LIKE, INSISTING, THANKS_CANDIDATE, QUEUE_LIST_DEFAULT_HOURS, URGENT_CUSTOMER_REGEX, isThanksCandidate } from "./patterns";

const MS_HOUR = 3_600_000;

/** Una conversación en espera, tal como sale de la consulta. */
export interface WaitingRow {
  conversationId: string;
  /** true si el estado no es RESUELTA. */
  open: boolean;
  /** Estado de la conversación, tal como está guardado. Solo para mostrarlo. */
  status: string;
  /**
   * Cuenta de Emozion asignada según el último evento recibido; null si no hay. Solo para
   * mostrarla: una reasignación que no cambia el estado no genera evento y puede quedar vieja.
   */
  externalAssigneeId: string | null;
  createdAt: Date;
  /** Primer mensaje del cliente del bloque sin responder: desde cuándo espera. */
  waitStart: Date;
  /** Último mensaje del cliente: desde acá corre la ventana de 24 horas de WhatsApp. */
  lastCustomerAt: Date;
  /** Ya tuvo al menos un mensaje público de operador (espera la SIGUIENTE respuesta). */
  hasHumanResponse: boolean;
  /** Salida del bot (aproximación a la derivación); null si no está registrada. */
  botExitAt: Date | null;
  botOrderComplete: boolean;
  customerChars: number;
  customerSentMedia: boolean;
  customerSentLink: boolean;
  previousResolvedRecently: boolean;
  /** Algún mensaje del bloque sin responder pide urgencia o avisa que se va (URGENT_CUSTOMER_REGEX). */
  urgent: boolean;
  /** En el bloque sin responder, después del bot: 2 mensajes o más separados por más de 10 minutos. */
  insisting: boolean;
}

export interface QueueItem extends WaitingRow {
  thanksCandidate: boolean;
  waitHours: number;
}

export type { AgeBucket, QueueGroupCounts } from "./queue-types";

export interface QueueSnapshot {
  generatedAt: Date;
  /** Desde qué fecha de creación se incluyen las conversaciones cerradas. */
  closedSince: Date;
  openWaiting: QueueGroupCounts;
  closedUnanswered: QueueGroupCounts;
  /** Abiertas esperando hace más de 72 horas. */
  openOlderThanListWindow: number;
  /** Ordenadas de la espera más vieja a la más nueva. Sin recortar. */
  items: QueueItem[];
}

export function ageBucket(waitStart: Date, now: Date): AgeBucket {
  const hours = (now.getTime() - waitStart.getTime()) / MS_HOUR;
  if (hours < 24) return "lt24h";
  if (hours < 72) return "h24to72";
  if (hours < 24 * 30) return "d3to30";
  return "gt30d";
}

function emptyCounts(): QueueGroupCounts {
  return {
    total: 0, neverHuman: 0, awaitingNext: 0, completedOrders: 0, thanksCandidates: 0, noBotExit: 0,
    byAge: { lt24h: 0, h24to72: 0, d3to30: 0, gt30d: 0 }, oldestWaitStart: null,
  };
}

/** Arma el resumen a partir de las filas en espera. PURO: se prueba sin base. */
export function buildQueueSnapshot(rows: readonly WaitingRow[], now: Date, closedSince: Date): QueueSnapshot {
  const openWaiting = emptyCounts();
  const closedUnanswered = emptyCounts();
  let openOlderThanListWindow = 0;

  const items: QueueItem[] = rows.map((r) => ({
    ...r,
    thanksCandidate: isThanksCandidate(r),
    waitHours: Math.max(0, (now.getTime() - r.waitStart.getTime()) / MS_HOUR),
  }));
  items.sort((a, b) => a.waitStart.getTime() - b.waitStart.getTime());

  for (const it of items) {
    const g = it.open ? openWaiting : closedUnanswered;
    g.total++;
    if (it.hasHumanResponse) g.awaitingNext++;
    else g.neverHuman++;
    if (!it.hasHumanResponse && it.botOrderComplete) g.completedOrders++;
    if (it.thanksCandidate) g.thanksCandidates++;
    if (it.botExitAt === null) g.noBotExit++;
    g.byAge[ageBucket(it.waitStart, now)]++;
    if (g.oldestWaitStart === null || it.waitStart < g.oldestWaitStart) g.oldestWaitStart = it.waitStart;
    if (it.open && it.waitHours > QUEUE_LIST_DEFAULT_HOURS) openOlderThanListWindow++;
  }

  return { generatedAt: now, closedSince, openWaiting, closedUnanswered, openOlderThanListWindow, items };
}

/**
 * Filtro de PANTALLA de la lista: todas las abiertas (cualquier antigüedad) y las cerradas
 * cuya espera empezó dentro de la ventana. No cambia ningún conteo.
 */
export function itemsForList(snapshot: QueueSnapshot, windowHours: number = QUEUE_LIST_DEFAULT_HOURS): QueueItem[] {
  return snapshot.items.filter((it) => it.open || it.waitHours <= windowHours);
}

interface RawWaitingRow {
  id: string;
  open: boolean;
  status: string;
  assignee: string | null;
  createdAt: Date;
  waitStart: Date;
  lastCustomerAt: Date;
  hasHuman: boolean;
  botExitAt: Date | null;
  done: boolean | null;
  custChars: number | bigint | null;
  custMedia: boolean | null;
  custLink: boolean | null;
  prevResolved: boolean;
  urgent: boolean | null;
  insisting: boolean | null;
}

/**
 * Conversaciones en espera: todas las abiertas más las creadas desde `closedSince`.
 * Solo lectura. Parte de la conversación y usa el índice por conversación de los mensajes.
 */
export async function loadWaitingRows(closedSince: Date): Promise<WaitingRow[]> {
  const prevHours = `${THANKS_CANDIDATE.previousResolvedWithinHours} hours`;
  const rows = await prisma.$queryRaw<RawWaitingRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id, c.status, c."customerId", c."createdAt",
        -- Clave de cuenta del asignado: un bot lleva prefijo (assigneeAccount).
        CASE WHEN c."externalAssigneeType" = 'AGENT_BOT' THEN ${BOT_ACCOUNT_PREFIX} || c."externalAssigneeId" ELSE c."externalAssigneeId" END AS "externalAssigneeId"
      FROM "Conversation" c
      WHERE c.status <> 'RESUELTA' OR c."createdAt" >= ${utcTimestampParam(closedSince)}::timestamp
    ), agg AS (
      SELECT m."conversationId" AS cid,
        max(m."sentAt") FILTER (WHERE m.author = 'OPERATOR' AND NOT m."isPrivate") AS last_op,
        max(m."sentAt") FILTER (WHERE m.author = 'CUSTOMER') AS last_cust,
        coalesce(sum(length(coalesce(m.body, ''))) FILTER (WHERE m.author = 'CUSTOMER'), 0)::int AS cust_chars,
        bool_or(m.author = 'CUSTOMER' AND (m.body IS NULL OR m."mediaType" IS NOT NULL)) AS cust_media,
        bool_or(m.author = 'CUSTOMER' AND m.body ~* 'https?://') AS cust_link,
        bool_or(m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}) AS done,
        min(m."sentAt") FILTER (WHERE m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}) AS done_at
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      GROUP BY 1
    )
    SELECT
      s.id,
      (s.status <> 'RESUELTA') AS "open",
      EXISTS (SELECT 1 FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND m.author = 'CUSTOMER' AND (a.last_op IS NULL OR m."sentAt" > a.last_op)
          AND m.body ~* ${URGENT_CUSTOMER_REGEX}) AS "urgent",
      (SELECT count(*) >= ${INSISTING.minMessages} AND max(m."sentAt") - min(m."sentAt") > ${`${INSISTING.minMinutesApart} minutes`}::interval
        FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND m.author = 'CUSTOMER' AND (a.last_op IS NULL OR m."sentAt" > a.last_op)
          AND a.done_at IS NOT NULL AND m."sentAt" > a.done_at) AS "insisting",
      s.status::text AS "status",
      s."externalAssigneeId" AS "assignee",
      s."createdAt" AS "createdAt",
      (SELECT min(m."sentAt") FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND m.author = 'CUSTOMER'
          AND (a.last_op IS NULL OR m."sentAt" > a.last_op)) AS "waitStart",
      a.last_cust AS "lastCustomerAt",
      (a.last_op IS NOT NULL) AS "hasHuman",
      (SELECT min(h."changedAt") FROM "ConversationStateHistory" h
        WHERE h."conversationId" = s.id AND h."fromStatus" = 'PENDIENTE'
          AND h."toStatus" IN ('SIN_ASIGNAR', 'ASIGNADA')) AS "botExitAt",
      a.done AS "done",
      a.cust_chars AS "custChars",
      a.cust_media AS "custMedia",
      a.cust_link AS "custLink",
      EXISTS (
        SELECT 1 FROM "Conversation" p
        JOIN "ConversationStateHistory" h ON h."conversationId" = p.id AND h."toStatus" = 'RESUELTA'
        WHERE p."customerId" = s."customerId" AND p.id <> s.id
          AND h."changedAt" BETWEEN s."createdAt" - ${prevHours}::interval AND s."createdAt"
      ) AS "prevResolved"
    FROM scope s
    JOIN agg a ON a.cid = s.id
    WHERE a.last_cust IS NOT NULL AND (a.last_op IS NULL OR a.last_cust > a.last_op)
  `);

  return rows.map((r) => ({
    conversationId: r.id,
    open: r.open,
    status: r.status,
    externalAssigneeId: r.assignee,
    createdAt: r.createdAt,
    waitStart: r.waitStart,
    lastCustomerAt: r.lastCustomerAt,
    hasHumanResponse: r.hasHuman,
    botExitAt: r.botExitAt,
    botOrderComplete: r.done === true,
    customerChars: Number(r.custChars ?? 0),
    customerSentMedia: r.custMedia === true,
    customerSentLink: r.custLink === true,
    previousResolvedRecently: r.prevResolved,
    urgent: r.urgent === true,
    insisting: r.insisting === true,
  }));
}

/** Ventana por defecto de conversaciones cerradas que entran en la cola. */
export const QUEUE_CLOSED_SINCE_DAYS = 30;

/** La cola al momento `now`. */
export async function getQueueSnapshot(now: Date = new Date(), closedSinceDays: number = QUEUE_CLOSED_SINCE_DAYS): Promise<QueueSnapshot> {
  const closedSince = new Date(now.getTime() - closedSinceDays * 24 * MS_HOUR);
  return buildQueueSnapshot(await loadWaitingRows(closedSince), now, closedSince);
}

export interface ClosedUnansweredHistory {
  before: Date;
  total: number;
  neverHuman: number;
  awaitingNext: number;
  /** Sin respuesta de una persona y con pedido completo en el bot. */
  completedOrders: number;
}

/**
 * Cerradas sin respuesta ANTERIORES a la ventana de la cola: para que el conteo completo
 * siga visible aunque la lista no las muestre. Recorre todo el histórico de mensajes: se
 * consulta con caché larga, nunca en cada refresco.
 */
export async function countClosedUnansweredBefore(before: Date): Promise<ClosedUnansweredHistory> {
  const rows = await prisma.$queryRaw<Array<{ total: number; neverHuman: number; awaitingNext: number; completedOrders: number }>>(Prisma.sql`
    WITH agg AS (
      SELECT m."conversationId" AS cid,
        max(m."sentAt") FILTER (WHERE m.author = 'OPERATOR' AND NOT m."isPrivate") AS last_op,
        max(m."sentAt") FILTER (WHERE m.author = 'CUSTOMER') AS last_cust,
        bool_or(m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}) AS done
      FROM "ConversationMessage" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c.status = 'RESUELTA' AND c."createdAt" < ${utcTimestampParam(before)}::timestamp
      GROUP BY 1
    )
    SELECT
      count(*)::int AS "total",
      (count(*) FILTER (WHERE last_op IS NULL))::int AS "neverHuman",
      (count(*) FILTER (WHERE last_op IS NOT NULL))::int AS "awaitingNext",
      (count(*) FILTER (WHERE last_op IS NULL AND done))::int AS "completedOrders"
    FROM agg
    WHERE last_cust IS NOT NULL AND (last_op IS NULL OR last_cust > last_op)
  `);
  const r = rows[0] ?? { total: 0, neverHuman: 0, awaitingNext: 0, completedOrders: 0 };
  return { before, ...r };
}
