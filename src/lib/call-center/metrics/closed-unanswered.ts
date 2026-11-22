/**
 * "Cerradas sin responder": conversaciones resueltas cuyo último mensaje público, entre
 * cliente y operador, es del cliente, y en las que ese último bloque del cliente pedía algo.
 *
 * El último bloque son los mensajes del cliente posteriores a la última respuesta pública
 * de un operador; si nunca hubo respuesta, todos los del cliente. Entra en la lista si tiene:
 *  - un pedido: la frase de pedido con receta, o pedido completo en el bot sin que nadie lo tomara;
 *  - un adjunto (receta o comprobante) sin respuesta posterior del operador;
 *  - una consulta o pregunta que el bot no contestó.
 *
 * Quedan AFUERA los agradecimientos y los cierres naturales, los avisos de "ya compré / ya
 * fui" (van a ventas perdidas detectadas), los que no son clientes (proveedores, currículums,
 * publicidad; se informa solo la cantidad) y las consultas que el bot ya contestó.
 *
 * Es nivel DETECTADO: depende de palabras. No toma los reclamos escritos sin signo de
 * pregunta ni palabras de consulta.
 *
 * classifyClosedBlock y buildClosedUnanswered son PUROS. loadClosedBlockRows es de solo
 * lectura: los textos se evalúan dentro de la consulta y solo salen marcas (sí/no) y horas.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestampParam } from "./business-time";
import {
  ALREADY_BOUGHT_REGEX, BLOCK_ATTACHMENT_MEDIA_TYPES, BOT_INFO_ANSWER_LIKES, BOT_ORDER_COMPLETE_LIKE,
  CLOSED_UNANSWERED_DAYS, CLOSING_MESSAGE_REGEX, NOT_CUSTOMER_REGEX, ORDER_REQUEST_REGEX, QUESTION_REGEX,
} from "./patterns";
import type { ClosedReason, ClosedUnansweredReport } from "./now-types";

const MS_DAY = 86_400_000;

/** Una conversación cerrada cuyo último mensaje público es del cliente: solo marcas y horas. */
export interface ClosedBlockRow {
  conversationId: string;
  /** Último mensaje del cliente. */
  lastCustomerAt: Date;
  hasHumanResponse: boolean;
  botOrderComplete: boolean;
  /** El bot dio una respuesta informativa (sucursales y horarios, tienda online). */
  botInfoAnswer: boolean;
  blockHasAttachment: boolean;
  blockHasQuestion: boolean;
  blockHasOrderRequest: boolean;
  blockAlreadyBought: boolean;
  blockNotCustomer: boolean;
  /** El último mensaje del cliente es un agradecimiento o un cierre. */
  lastMessageIsClosing: boolean;
}

export type ClosedBlockClass = ClosedReason | "NOT_CUSTOMER" | "ALREADY_BOUGHT" | "BOT_ANSWERED" | "NONE";

/** Clasifica el último bloque. El orden importa: la primera regla que se cumple gana. PURO. */
export function classifyClosedBlock(r: ClosedBlockRow): ClosedBlockClass {
  if (r.blockNotCustomer) return "NOT_CUSTOMER";
  if (r.blockAlreadyBought) return "ALREADY_BOUGHT";
  if (r.blockHasOrderRequest || (!r.hasHumanResponse && r.botOrderComplete)) return "ORDER";
  if (r.blockHasAttachment) return "ATTACHMENT";
  if (r.blockHasQuestion) return !r.hasHumanResponse && r.botInfoAnswer ? "BOT_ANSWERED" : "QUESTION";
  return "NONE";
}

/** Arma el resumen y la lista, del último mensaje más nuevo al más viejo. PURO. */
export function buildClosedUnanswered(rows: readonly ClosedBlockRow[], days: number = CLOSED_UNANSWERED_DAYS): ClosedUnansweredReport {
  const out: ClosedUnansweredReport = { days, total: 0, question: 0, order: 0, attachment: 0, notCustomers: 0, items: [] };
  for (const r of rows) {
    const c = classifyClosedBlock(r);
    if (c === "NOT_CUSTOMER") { out.notCustomers++; continue; }
    if (c !== "ORDER" && c !== "ATTACHMENT" && c !== "QUESTION") continue;
    out.total++;
    if (c === "ORDER") out.order++;
    else if (c === "ATTACHMENT") out.attachment++;
    else out.question++;
    out.items.push({ conversationId: r.conversationId, lastCustomerAt: r.lastCustomerAt.toISOString(), reason: c });
  }
  out.items.sort((a, b) => (a.lastCustomerAt < b.lastCustomerAt ? 1 : -1));
  return out;
}

/**
 * ¿Una abierta antigua parece cerrada? Sí cuando el último mensaje del cliente es un
 * agradecimiento o un cierre y el bloque no trae una consulta, un pedido ni un adjunto:
 * probablemente quedó resuelta y abierta por error. En cualquier otro caso sigue pendiente.
 * PURO. Es nivel DETECTADO.
 */
export function isProbablyClosed(r: ClosedBlockRow): boolean {
  if (!r.lastMessageIsClosing && !r.blockAlreadyBought) return false;
  const c = classifyClosedBlock(r);
  return c === "NONE" || c === "ALREADY_BOUGHT";
}

/**
 * Cerradas creadas desde `createdSince` cuyo último mensaje público es del cliente y es
 * posterior a `lastCustomerSince`. Solo lectura. No selecciona teléfono, nombre ni texto.
 */
export async function loadClosedBlockRows(createdSince: Date, lastCustomerSince: Date): Promise<ClosedBlockRow[]> {
  return loadBlockRows(
    Prisma.sql`c.status = 'RESUELTA' AND c."createdAt" >= ${utcTimestampParam(createdSince)}::timestamp`,
    Prisma.sql`AND a.last_cust >= ${utcTimestampParam(lastCustomerSince)}::timestamp`,
  );
}

/**
 * Abiertas (cualquier antigüedad) cuyo último mensaje público es del cliente: las mismas
 * marcas, para clasificar las antiguas. Solo lectura.
 */
export async function loadOpenBlockRows(): Promise<ClosedBlockRow[]> {
  return loadBlockRows(Prisma.sql`c.status <> 'RESUELTA'`, Prisma.empty);
}

async function loadBlockRows(scopeWhere: Prisma.Sql, extraWhere: Prisma.Sql): Promise<ClosedBlockRow[]> {
  const media = Prisma.join([...BLOCK_ATTACHMENT_MEDIA_TYPES]);
  const [info1, info2] = BOT_INFO_ANSWER_LIKES;
  return prisma.$queryRaw<ClosedBlockRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id FROM "Conversation" c
      WHERE ${scopeWhere}
    ), agg AS (
      SELECT m."conversationId" AS cid,
        max(m."sentAt") FILTER (WHERE m.author = 'OPERATOR' AND NOT m."isPrivate") AS last_op,
        max(m."sentAt") FILTER (WHERE m.author = 'CUSTOMER') AS last_cust,
        coalesce(bool_or(m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}), false) AS done,
        coalesce(bool_or(m.author = 'BOT' AND (m.body LIKE ${info1} OR m.body LIKE ${info2})), false) AS bot_info
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      GROUP BY 1
    )
    SELECT
      a.cid AS "conversationId",
      a.last_cust AS "lastCustomerAt",
      (a.last_op IS NOT NULL) AS "hasHumanResponse",
      a.done AS "botOrderComplete",
      a.bot_info AS "botInfoAnswer",
      coalesce(bool_or(m."mediaType" IN (${media})), false) AS "blockHasAttachment",
      coalesce(bool_or(m.body ~* ${QUESTION_REGEX}), false) AS "blockHasQuestion",
      coalesce(bool_or(m.body ~* ${ORDER_REQUEST_REGEX}), false) AS "blockHasOrderRequest",
      coalesce(bool_or(m.body ~* ${ALREADY_BOUGHT_REGEX}), false) AS "blockAlreadyBought",
      coalesce(bool_or(m.body ~* ${NOT_CUSTOMER_REGEX}), false) AS "blockNotCustomer",
      coalesce((array_agg(m.body ORDER BY m."sentAt" DESC, m.id DESC))[1] ~* ${CLOSING_MESSAGE_REGEX}, false) AS "lastMessageIsClosing"
    FROM agg a
    JOIN "ConversationMessage" m ON m."conversationId" = a.cid AND m.author = 'CUSTOMER'
      AND (a.last_op IS NULL OR m."sentAt" > a.last_op)
    WHERE a.last_cust IS NOT NULL AND (a.last_op IS NULL OR a.last_cust > a.last_op)
      ${extraWhere}
    GROUP BY a.cid, a.last_cust, a.last_op, a.done, a.bot_info
  `);
}

/** "Cerradas sin responder" de los últimos días, al momento `now`. */
export async function getClosedUnanswered(now: Date, createdSince: Date, days: number = CLOSED_UNANSWERED_DAYS): Promise<ClosedUnansweredReport> {
  return buildClosedUnanswered(await loadClosedBlockRows(createdSince, new Date(now.getTime() - days * MS_DAY)), days);
}
