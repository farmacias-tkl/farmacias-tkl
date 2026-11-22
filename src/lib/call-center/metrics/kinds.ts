/**
 * Clasificación de las conversaciones por tipo, para la pestaña "Tipos". Nivel DETECTADO:
 * recorrido del bot y palabras. Cuando llegue el tipo de cierre de Emozion será la fuente
 * principal y esto quedará como respaldo.
 *
 * Un tipo principal por conversación, en este orden:
 *  1. Reclamo: cualquier motivo de "Reclamos y pérdidas" (Call Center, envíos, tienda online).
 *  2. Pedido: receta de Meducar, o evidencia de pago o de coordinación de retiro o envío.
 *     Elegir "Pedir medicamentos" en el bot NO alcanza: muchos entran por ahí a preguntar.
 *  3. Pedido sin confirmar: completó el recorrido del bot pero no hay pago ni coordinación.
 *     Va aparte y no suma como pedido.
 *  4. Sin contenido: solo saludos, agradecimientos o botones, sin adjuntos. Va aparte.
 *  5. Consulta, con subtipo por palabras. Un adjunto sin otra evidencia es una consulta.
 *  6. Sin clasificar: lo que queda, visible para revisar el criterio.
 *
 * classifyKind y buildKindsReport son PUROS. loadKindRows es de solo lectura: los textos se
 * evalúan dentro de la consulta y solo salen marcas (sí/no) y la fecha.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { arDayISO, arDayStartUTC, arHour, utcTimestampParam } from "./business-time";
import { BOT_ORDER_COMPLETE_LIKE } from "./patterns";
import { BOT_ORDER_FLOW_LIKE, CUSTOMER_ORDER_OPTION, MEDUCAR_LINK_REGEX, MEDUCAR_PHRASE_REGEX } from "./management-type";
import { claimsOf, loadDetectedRows } from "./detected";
import {
  BOT_BUTTONS, BUTTON_ADVISOR, BUTTON_HOME, BUTTON_HOURS, BUTTON_ONLINE_STORE, BUTTON_PICKUP,
  CONSULT_COVERAGE, CONSULT_HOURS, CONSULT_ONLINE_STORE, CONSULT_PAYMENT, CONSULT_PRICE, CONSULT_STOCK,
  COORDINATION_OPERATOR, EMPTY_MESSAGE, PAYMENT_CUSTOMER, PAYMENT_OPERATOR,
} from "./kinds-patterns";
import {
  CONSULT_KINDS, MAIN_KINDS, ORDER_KINDS,
  type ConsultKind, type ConversationKind, type KindCounts, type KindsPayload, type OrderKind,
} from "./kinds-types";

const MS_DAY = 86_400_000;

/** Marcas de una conversación. Sin teléfono, nombre ni texto. */
export interface KindRow {
  conversationId: string;
  createdAt: Date;
  /** Tiene algún motivo de reclamo (de detected.ts). */
  claim: boolean;
  meducar: boolean;
  /** Pasó por el recorrido de pedido del bot. */
  orderMenu: boolean;
  homeDelivery: boolean;
  pickup: boolean;
  botOrderComplete: boolean;
  hasHumanResponse: boolean;
  payment: boolean;
  coordination: boolean;
  customerMedia: boolean;
  /** El cliente escribió algo que no es un botón del bot. */
  hasFreeText: boolean;
  /** Todo su texto libre son saludos, agradecimientos o sí/no. */
  onlyEmptyText: boolean;
  hasQuestionMark: boolean;
  buttonHours: boolean;
  buttonOnlineStore: boolean;
  buttonAdvisor: boolean;
  price: boolean;
  stock: boolean;
  hours: boolean;
  coverage: boolean;
  paymentMethod: boolean;
  onlineStore: boolean;
}

type Flags = Omit<KindRow, "conversationId" | "createdAt">;

function consultKind(r: Flags): ConsultKind {
  if (r.price) return "PRECIO";
  if (r.stock) return "STOCK";
  if (r.buttonHours || r.hours) return "HORARIOS";
  if (r.coverage) return "COBERTURA";
  if (r.paymentMethod) return "PAGO";
  if (r.buttonOnlineStore || r.onlineStore) return "TIENDA_ONLINE";
  return "OTRAS";
}

/** PURO. */
export function classifyKind(r: Flags): ConversationKind {
  if (r.claim) return { main: "RECLAMO", sub: null };
  if (r.meducar) return { main: "PEDIDO", sub: "MEDUCAR" };
  if (r.payment || r.coordination) {
    return { main: "PEDIDO", sub: r.homeDelivery ? "DOMICILIO" : r.pickup ? "RETIRO" : "SIN_MODALIDAD" };
  }
  if (r.orderMenu && r.botOrderComplete) return { main: "PEDIDO_SIN_CONFIRMAR", sub: null };
  if (!r.customerMedia && (!r.hasFreeText || r.onlyEmptyText) && !r.buttonHours && !r.buttonOnlineStore && !r.buttonAdvisor) {
    return { main: "SIN_CONTENIDO", sub: null };
  }
  const topic = r.price || r.stock || r.buttonHours || r.hours || r.coverage || r.paymentMethod || r.buttonOnlineStore || r.onlineStore;
  if (topic || r.hasQuestionMark || r.buttonAdvisor || r.customerMedia || r.hasHumanResponse || r.orderMenu) {
    return { main: "CONSULTA", sub: consultKind(r) };
  }
  return { main: "SIN_CLASIFICAR", sub: null };
}

const zeroCounts = (): KindCounts => Object.fromEntries(MAIN_KINDS.map((k) => [k, 0])) as KindCounts;

/** Informe del período. PURO. */
export function buildKindsReport(rows: readonly KindRow[], opts: { now: Date; from: string; to: string }): KindsPayload {
  const total = zeroCounts();
  const orders = Object.fromEntries(ORDER_KINDS.map((k) => [k, 0])) as Record<OrderKind, number>;
  const consults = Object.fromEntries(CONSULT_KINDS.map((k) => [k, 0])) as Record<ConsultKind, number>;
  const byDay = new Map<string, KindCounts>();
  const byHour = Array.from({ length: 24 }, zeroCounts);

  for (const r of rows) {
    const kind = classifyKind(r);
    total[kind.main]++;
    if (kind.main === "PEDIDO") orders[kind.sub as OrderKind]++;
    if (kind.main === "CONSULTA") consults[kind.sub as ConsultKind]++;
    const day = arDayISO(r.createdAt);
    const d = byDay.get(day) ?? zeroCounts();
    d[kind.main]++;
    byDay.set(day, d);
    byHour[arHour(r.createdAt)][kind.main]++;
  }

  return {
    generatedAt: opts.now.toISOString(),
    from: opts.from,
    to: opts.to,
    source: "DETECTADO",
    conversations: rows.length,
    total,
    orders,
    consults,
    byDay: [...byDay.keys()].sort().map((day) => ({ day, ...byDay.get(day)! })),
    byHour,
  };
}

type RawKindRow = Omit<KindRow, "claim" | "hasFreeText" | "onlyEmptyText"> & { freeMessages: number; emptyMessages: number };

/** Conversaciones creadas entre dos días de Buenos Aires, inclusive, con sus marcas. Solo lectura. */
export async function loadKindRows(fromDay: string, toDayInclusive: string): Promise<KindRow[]> {
  const from = arDayStartUTC(fromDay);
  const to = new Date(arDayStartUTC(toDayInclusive).getTime() + MS_DAY);
  const buttons = Prisma.join([...BOT_BUTTONS]);
  const cust = Prisma.sql`m.author = 'CUSTOMER'`;
  const op = Prisma.sql`m.author = 'OPERATOR' AND NOT m."isPrivate"`;
  // Texto libre del cliente: lo que escribió, sin los botones del bot.
  const free = Prisma.sql`m.author = 'CUSTOMER' AND m.body IS NOT NULL AND m.body NOT IN (${buttons})`;
  const flag = (cond: Prisma.Sql) => Prisma.sql`coalesce(bool_or(${cond}), false)`;

  const [rows, detected] = await Promise.all([
    prisma.$queryRaw<RawKindRow[]>(Prisma.sql`
      SELECT c.id AS "conversationId", c."createdAt" AS "createdAt",
        coalesce((SELECT (x.author = 'CUSTOMER' AND x.body ~* ${MEDUCAR_LINK_REGEX} AND x.body ~* ${MEDUCAR_PHRASE_REGEX})
          FROM "ConversationMessage" x WHERE x."conversationId" = c.id ORDER BY x."sentAt", x.id LIMIT 1), false) AS "meducar",
        ${flag(Prisma.sql`(${cust} AND m.body = ${CUSTOMER_ORDER_OPTION}) OR (m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_FLOW_LIKE})`)} AS "orderMenu",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_HOME}`)} AS "homeDelivery",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_PICKUP}`)} AS "pickup",
        ${flag(Prisma.sql`m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}`)} AS "botOrderComplete",
        ${flag(op)} AS "hasHumanResponse",
        ${flag(Prisma.sql`(${op} AND m.body ~* ${PAYMENT_OPERATOR}) OR (${cust} AND m.body ~* ${PAYMENT_CUSTOMER})`)} AS "payment",
        ${flag(Prisma.sql`${op} AND m.body ~* ${COORDINATION_OPERATOR}`)} AS "coordination",
        ${flag(Prisma.sql`${cust} AND (m.body IS NULL OR m."mediaType" IS NOT NULL)`)} AS "customerMedia",
        (count(*) FILTER (WHERE ${free}))::int AS "freeMessages",
        (count(*) FILTER (WHERE ${free} AND m.body ~* ${EMPTY_MESSAGE}))::int AS "emptyMessages",
        ${flag(Prisma.sql`${free} AND m.body LIKE '%?%'`)} AS "hasQuestionMark",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_HOURS}`)} AS "buttonHours",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_ONLINE_STORE}`)} AS "buttonOnlineStore",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_ADVISOR}`)} AS "buttonAdvisor",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_PRICE}`)} AS "price",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_STOCK}`)} AS "stock",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_HOURS}`)} AS "hours",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_COVERAGE}`)} AS "coverage",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_PAYMENT}`)} AS "paymentMethod",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_ONLINE_STORE}`)} AS "onlineStore"
      FROM "Conversation" c
      LEFT JOIN "ConversationMessage" m ON m."conversationId" = c.id
      WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
      GROUP BY c.id, c."createdAt"
    `),
    loadDetectedRows(fromDay, toDayInclusive),
  ]);

  const withClaim = new Set(detected.rows.filter((r) => claimsOf(r).length > 0).map((r) => r.conversationId));
  return rows.map(({ freeMessages, emptyMessages, ...r }) => ({
    ...r,
    claim: withClaim.has(r.conversationId),
    hasFreeText: freeMessages > 0,
    onlyEmptyText: freeMessages > 0 && emptyMessages === freeMessages,
  }));
}

const CACHE_MAX_ENTRIES = 20;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; payload: KindsPayload }>();

/** Informe del período, con caché de un minuto por período. */
export async function getKindsPayload(from: string, to: string, now: Date = new Date()): Promise<KindsPayload> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.payload;

  const payload = buildKindsReport(await loadKindRows(from, to), { now, from, to });

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= CACHE_MS) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}
