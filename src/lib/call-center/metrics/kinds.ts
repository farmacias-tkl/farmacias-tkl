/**
 * Clasificación de las conversaciones por tipo, para la pestaña "Tipos". Nivel DETECTADO:
 * recorrido del bot y palabras. Cuando llegue el tipo de cierre de Emozion será la fuente
 * principal y esto quedará como respaldo.
 *
 * Un tipo principal por conversación, en este orden:
 *  1. Reclamo: cualquier motivo de "Reclamos y pérdidas" (Call Center, envíos, tienda online).
 *  2. Pedido confirmado: el operador da el número de control, avisa que ya se puede retirar,
 *     confirma el retiro o la salida del envío, o hay evidencia de pago. Elegir "Pedir
 *     medicamentos" NO alcanza, y que el operador informe un precio tampoco.
 *     Si el operador cancela el pedido no queda confirmado, salvo con número de control o
 *     pago recibido. El cierre "gracias por confiar", cuando es la única evidencia, no vale
 *     si el operador dejó el pedido en espera. Un pedido postergado (la receta todavía no
 *     es válida) es un pedido sin confirmar, no una venta perdida.
 *  3. El cliente dice, en cualquier momento, que ya lo compró, que ya fue o que cancela:
 *     "Compró presencial en TKL" si en ese mensaje nombra a TKL o a una sucursal, o si avisa
 *     que pasa a pagar después de que le ofrecieron stock; si no, venta perdida (confirmada
 *     si dice otra farmacia o cancela; probable si va a buscar en otra; "no dice dónde" si
 *     no). Confundirse de receta no es una pérdida.
 *  4. No se pudo tomar: el cliente quería pedir (completó el bot o mandó una receta) y el
 *     operador lo derivó a comprar en la sucursal, o avisó que no hay stock.
 *  5. Pedido por receta digital: el mensaje armado de cualquier plataforma de recetas, salvo
 *     que el cliente avise que al final no necesita nada.
 *  6. Pedido sin confirmar: completó el recorrido del bot y no hay nada de lo anterior. El
 *     cliente no respondió o quedó en volver. No suma como pedido. Si no mandó receta ni
 *     adjunto y pregunta por un precio, un producto o un servicio, es una consulta.
 *  7. Consulta: el cliente pregunta por un tema (precio, stock, horarios, cobertura…). Los
 *     botones del bot sin texto no alcanzan, y que un operador haya respondido tampoco.
 *  8. Seguimiento / postventa: pregunta por un pago o un pedido ya hecho.
 *  9. Consulta sin tema reconocible: una pregunta. Una receta o un adjunto solo, sin
 *     pregunta, va a pedido sin confirmar.
 * 10. Saludo / agradecimiento: solo saludos, agradecimientos (también largos) o botones.
 * 11. Sin motivo claro: lo que queda.
 *
 * classifyKind y buildKindsReport son PUROS. loadKindRows es de solo lectura: los textos se
 * evalúan dentro de la consulta y solo salen marcas (sí/no) y la fecha.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { arDayISO, arDayStartUTC, arHour, utcTimestampParam } from "./business-time";
import { BOT_ORDER_COMPLETE_LIKE, PRESCRIPTION_LINK_REGEX } from "./patterns";
import { claimsOf, loadDetectedRows, messageMatches } from "./detected";
import { OWN_PROBLEM_CLAIM_PATTERNS, branchNamesRegex, type MessagePattern } from "./detected-patterns";
import { BOT_ORDER_FLOW_LIKE } from "./management-type";
import { buildMotivesReport, selectMotiveCases, type MotiveFlags } from "./motives";
import type { Motive, MotiveCasesPayload } from "./motives-types";
import { getDerivations, type DerivationTiming } from "./derivation";
import { closureMapOf, closureOutcomeOf, type ClosureMap } from "./closure-outcome";
import { configForDay, loadConfigVersions } from "./config";
import {
  BOT_BUTTONS, BUTTON_HOME, BUTTON_PICKUP,
  CONSULT_COVERAGE, CONSULT_HOURS, CONSULT_ONLINE_STORE, CONSULT_PAYMENT, CONSULT_PRICE, CONSULT_SERVICES, CONSULT_STOCK,
  APOLOGY_MESSAGE, BOUGHT_AT_TKL, CUSTOMER_DECLINED, CUSTOMER_GOES_TO_BRANCH, EMPTY_MESSAGE, NOT_A_LOSS, OPERATOR_OFFERED_STOCK, OPERATOR_CANCELLED, OPERATOR_POSTPONED, OPERATOR_WAITING, ORDER_CLOSING_OPERATOR, ORDER_STRONG_OPERATOR, SALE_LOST_PROBABLE, FOLLOW_UP_CUSTOMER, OPERATOR_IN_PERSON_ONLY, OPERATOR_NO_STOCK,
  ORDER_CONFIRMED_OPERATOR, PAYMENT_CUSTOMER, PRESCRIPTION_ORDER, SALE_LOST_CUSTOMER, SALE_LOST_ELSEWHERE, THANKS_MESSAGE,
  BUTTON_ADVISOR, BUTTON_HOURS, BUTTON_ONLINE_STORE, BUTTON_ORDER, CONSULT_STOCK_PAST, FOLLOW_UP_ARRIVAL, ORDER_FREE_TEXT, PRESCRIPTION_PLATFORM_CAPTURE,
} from "./kinds-patterns";
import {
  CLOSURE_OUTCOME_LIST, CONSULT_KINDS, LOST_KINDS, MAIN_KINDS, NO_TAKE_KINDS, ORDER_KINDS, OUTCOME_MATCHES,
  type ClosureOutcome, type OperatorConfirmed,
  type ConsultKind, type ConversationKind, type KindCounts, type KindsPayload, type LostKind, type NoTakeKind, type OrderKind,
} from "./kinds-types";

const MS_DAY = 86_400_000;

/** Marcas de una conversación. Sin teléfono, nombre ni texto. */
export interface KindRow {
  conversationId: string;
  createdAt: Date;
  /** Para el resultado de cierre del operador: estado, resultado guardado al resolver y etiquetas. */
  resolved: boolean;
  closureTypeName: string | null;
  labels: string[];
  /** Tiene algún motivo de reclamo (de detected.ts). */
  claim: boolean;
  /** Mandó el mensaje armado de una receta digital para pedir. */
  prescription: boolean;
  homeDelivery: boolean;
  pickup: boolean;
  botOrderComplete: boolean;
  /** El operador confirmó el pedido, o hay evidencia de pago. */
  confirmed: boolean;
  /** El cliente dice que ya lo compró, que ya fue o que cancela. */
  saleLost: boolean;
  /** Lo dice nombrando otra farmacia u otro lado, o cancela. */
  saleElsewhere: boolean;
  /** El operador postergó el pedido: la receta todavía no es válida o hay que esperar una fecha. */
  postponed: boolean;
  /** Todavía no compró: avisa que va a buscar en otra farmacia. */
  saleProbable: boolean;
  /** Se confundió de receta o de producto: lo que dice no es una pérdida. */
  notALoss: boolean;
  /**
   * Compró en forma presencial en TKL: en el mismo mensaje en que dice que compró nombra a
   * TKL o a una sucursal, o avisa que pasa a pagar después de que el operador ofreció stock.
   */
  boughtAtTkl: boolean;
  /** Avisa que al final no necesita nada. */
  declined: boolean;
  /** Pregunta por un pago o un pedido ya hecho. */
  followUp: boolean;
  hasHumanResponse: boolean;
  /** El operador avisó que ese medicamento solo se vende en forma presencial. */
  operatorInPersonOnly: boolean;
  /** El operador avisó que no hay stock o que falta del laboratorio. */
  operatorNoStock: boolean;
  /** El operador lo derivó a comprar en la sucursal. */
  operatorDerived: boolean;
  /** Si lo derivó: dentro o fuera del horario de pedidos de la sucursal. null si no hubo derivación. */
  derivation: DerivationTiming | null;
  customerMedia: boolean;
  /** El cliente escribió algo que no es un botón del bot. */
  hasFreeText: boolean;
  /** Todo su texto libre son saludos, agradecimientos o sí/no. */
  onlyEmptyText: boolean;
  hasQuestionMark: boolean;
  services: boolean;
  price: boolean;
  stock: boolean;
  hours: boolean;
  coverage: boolean;
  paymentMethod: boolean;
  onlineStore: boolean;
}

type Flags = Omit<KindRow, "conversationId" | "createdAt" | "resolved" | "closureTypeName" | "labels">;

/** Una conversación con las marcas de las dos clasificaciones: la de tipos y la de motivos de contacto. */
export type KindMotiveRow = KindRow & MotiveFlags;

/** Reclamo como motivo de contacto: un problema propio del cliente (ver detected-patterns.ts). */
export const STRICT_CLAIM_PATTERNS: readonly MessagePattern[] = OWN_PROBLEM_CLAIM_PATTERNS;

function consultKind(r: Flags): ConsultKind {
  if (r.services) return "SERVICIOS";
  if (r.price) return "PRECIO";
  if (r.stock) return "STOCK";
  if (r.hours) return "HORARIOS";
  if (r.coverage) return "COBERTURA";
  if (r.paymentMethod) return "PAGO";
  if (r.onlineStore) return "TIENDA_ONLINE";
  return "OTRAS";
}

/** PURO. */
export function classifyKind(r: Flags): ConversationKind {
  if (r.claim) return { main: "RECLAMO", sub: null };
  if (r.confirmed) {
    return { main: "PEDIDO", sub: r.homeDelivery ? "DOMICILIO" : r.pickup ? "RETIRO" : r.prescription ? "RECETA" : "SIN_MODALIDAD" };
  }
  if (r.postponed) return { main: "PEDIDO_SIN_CONFIRMAR", sub: null };
  if (r.boughtAtTkl) return { main: "COMPRO_TKL", sub: null };
  if (r.saleLost && !r.notALoss) return { main: "VENTA_PERDIDA", sub: r.saleElsewhere ? "OTRO_LADO" : "NO_DICE_DONDE" };
  if (r.saleProbable && !r.notALoss) return { main: "VENTA_PERDIDA", sub: "PROBABLE" };
  // Quería pedir: completó el recorrido del bot o mandó una receta para pedir.
  const orderIntent = r.botOrderComplete || r.prescription;
  if (orderIntent && r.operatorInPersonOnly) return { main: "NO_SE_PUDO_TOMAR", sub: "DERIVADO_MEDICAMENTO" };
  if (orderIntent && r.operatorDerived) return { main: "NO_SE_PUDO_TOMAR", sub: r.derivation === "EN_HORARIO" ? "DERIVADO_EN_HORARIO" : "DERIVADO_PRESENCIAL" };
  if (orderIntent && r.operatorNoStock) return { main: "NO_SE_PUDO_TOMAR", sub: "SIN_STOCK" };
  if (r.prescription && !r.declined) return { main: "PEDIDO", sub: "RECETA" };
  // Un tema escrito por el cliente. Los botones del bot sin texto no alcanzan.
  const topic = r.services || r.price || r.stock || r.hours || r.coverage || r.paymentMethod || r.onlineStore;
  if (r.botOrderComplete) {
    // Entró por "Pedir medicamentos" sin mandar receta ni adjunto y pregunta por un producto: es una consulta.
    if (!r.customerMedia && (r.services || r.price || r.stock)) return { main: "CONSULTA", sub: consultKind(r) };
    return { main: "PEDIDO_SIN_CONFIRMAR", sub: null };
  }
  if (topic) return { main: "CONSULTA", sub: consultKind(r) };
  if (r.followUp) return { main: "SEGUIMIENTO", sub: null };
  // Una pregunta sin tema reconocible.
  if (r.hasQuestionMark) return { main: "CONSULTA", sub: "OTRAS" };
  // Una receta o un adjunto solo, sin pregunta: es un pedido que nadie confirmó, no una consulta.
  if (r.customerMedia) return { main: "PEDIDO_SIN_CONFIRMAR", sub: null };
  if (!r.hasFreeText || r.onlyEmptyText) return { main: "SALUDO", sub: null };
  return { main: "SIN_MOTIVO", sub: null };
}

const zeroCounts = (): KindCounts => Object.fromEntries(MAIN_KINDS.map((k) => [k, 0])) as KindCounts;

/** Informe del período. PURO. */
export function buildKindsReport(rows: readonly KindRow[], opts: { now: Date; from: string; to: string; closureMap?: ClosureMap }): KindsPayload {
  const closureMap = opts.closureMap ?? new Map<string, ClosureOutcome>();
  const operator: OperatorConfirmed = {
    confirmed: 0, compared: 0, agree: 0,
    byOutcome: Object.fromEntries(CLOSURE_OUTCOME_LIST.map((o) => [o, 0])) as Record<ClosureOutcome, number>,
    matrix: Object.fromEntries(CLOSURE_OUTCOME_LIST.map((o) => [o, zeroCounts()])) as Record<ClosureOutcome, KindCounts>,
  };
  const total = zeroCounts();
  const orders = Object.fromEntries(ORDER_KINDS.map((k) => [k, 0])) as Record<OrderKind, number>;
  const lost = Object.fromEntries(LOST_KINDS.map((k) => [k, 0])) as Record<LostKind, number>;
  const noTake = Object.fromEntries(NO_TAKE_KINDS.map((k) => [k, 0])) as Record<NoTakeKind, number>;
  let consultsAnswered = 0;
  let derivedWithoutBranch = 0;
  const consults = Object.fromEntries(CONSULT_KINDS.map((k) => [k, 0])) as Record<ConsultKind, number>;
  const byDay = new Map<string, KindCounts>();
  const byHour = Array.from({ length: 24 }, zeroCounts);

  for (const r of rows) {
    const kind = classifyKind(r);
    total[kind.main]++;
    if (kind.main === "PEDIDO") orders[kind.sub as OrderKind]++;
    if (kind.main === "VENTA_PERDIDA") lost[kind.sub as LostKind]++;
    if (kind.main === "NO_SE_PUDO_TOMAR") noTake[kind.sub as NoTakeKind]++;
    if (kind.sub === "DERIVADO_PRESENCIAL" && r.derivation === "SIN_SUCURSAL") derivedWithoutBranch++;
    if (kind.main === "CONSULTA") { consults[kind.sub as ConsultKind]++; if (r.hasHumanResponse) consultsAnswered++; }
    const closure = closureOutcomeOf(r, closureMap);
    if (closure) {
      operator.confirmed++;
      operator.byOutcome[closure.outcome]++;
      operator.matrix[closure.outcome][kind.main]++;
      if (closure.outcome !== "OTRO") {
        operator.compared++;
        if (OUTCOME_MATCHES[closure.outcome].includes(kind.main)) operator.agree++;
      }
    }
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
    lost,
    noTake,
    derivedWithoutBranch,
    consults,
    consultsAnswered,
    operator: closureMap.size > 0 ? operator : null,
    byDay: [...byDay.keys()].sort().map((day) => ({ day, ...byDay.get(day)! })),
    byHour,
  };
}

type RawKindRow = Omit<KindMotiveRow, "claim" | "hasFreeText" | "onlyEmptyText" | "operatorDerived" | "derivation" | "hasCustomerMessage"> & {
  freeMessages: number; emptyMessages: number; customerMessages: number;
};

/** Conversaciones creadas entre dos días de Buenos Aires, inclusive, con sus marcas. Solo lectura. */
export async function loadKindRows(fromDay: string, toDayInclusive: string): Promise<KindMotiveRow[]> {
  const from = arDayStartUTC(fromDay);
  const to = new Date(arDayStartUTC(toDayInclusive).getTime() + MS_DAY);
  // Los nombres de las sucursales salen de la tabla, no del código.
  const branches = await prisma.branch.findMany({ select: { name: true } });
  const branchRegex = branchNamesRegex(branches.map((b) => b.name));
  const tkl = branchRegex ? `${BOUGHT_AT_TKL}|\\m(${branchRegex})\\M` : BOUGHT_AT_TKL;

  const [rows, detected, derivations] = await Promise.all([
    prisma.$queryRaw<RawKindRow[]>(kindRowsQuery(from, to, tkl)),
    loadDetectedRows(fromDay, toDayInclusive),
    getDerivations(fromDay, toDayInclusive),
  ]);
  const derivationOf = new Map(derivations.map((d) => [d.conversationId, d.timing]));

  const withClaim = new Set(detected.rows.filter((r) => claimsOf(r).length > 0).map((r) => r.conversationId));
  return rows.map(({ freeMessages, emptyMessages, customerMessages, ...r }) => ({
    ...r,
    claim: withClaim.has(r.conversationId),
    operatorDerived: derivationOf.has(r.conversationId),
    derivation: derivationOf.get(r.conversationId) ?? null,
    hasFreeText: freeMessages > 0,
    onlyEmptyText: freeMessages > 0 && emptyMessages === freeMessages,
    hasCustomerMessage: customerMessages > 0,
  }));
}

/** La consulta de loadKindRows, aparte para poder medirla. `tkl`: expresión que reconoce a TKL y sus sucursales. */
export function kindRowsQuery(from: Date, to: Date, tkl: string): Prisma.Sql {
  const buttons = Prisma.join([...BOT_BUTTONS]);
  const cust = Prisma.sql`m.author = 'CUSTOMER'`;
  const op = Prisma.sql`m.author = 'OPERATOR' AND NOT m."isPrivate"`;
  // Texto libre del cliente: lo que escribió, sin los botones del bot.
  const free = Prisma.sql`m.author = 'CUSTOMER' AND m.body IS NOT NULL AND m.body NOT IN (${buttons})`;
  const flag = (cond: Prisma.Sql) => Prisma.sql`coalesce(bool_or(${cond}), false)`;
  // Un saludo, un sí/no, una disculpa suelta o un agradecimiento (también largo) sin pregunta: no tiene contenido.
  const empty = Prisma.sql`(m.body ~* ${EMPTY_MESSAGE} OR m.body ~* ${APOLOGY_MESSAGE} OR (m.body ~* ${THANKS_MESSAGE} AND m.body NOT LIKE '%?%'))`;
  // Evidencia firme (número de control, pago recibido) y evidencia de venta en general.
  const strong = Prisma.sql`(${op} AND m.body ~* ${ORDER_STRONG_OPERATOR}) OR (${cust} AND m.body ~* ${PAYMENT_CUSTOMER})`;
  const evidence = Prisma.sql`${op} AND m.body ~* ${ORDER_CONFIRMED_OPERATOR}`;
  const closing = Prisma.sql`${op} AND m.body ~* ${ORDER_CLOSING_OPERATOR}`;
  // Primer mensaje escrito del cliente (no un botón): ¿ya es un reclamo? No cuenta si antes
  // había empezado un pedido en el bot: ahí el contacto lo originó el pedido.
  const firstClaim = Prisma.sql`coalesce((
    SELECT ${messageMatches(STRICT_CLAIM_PATTERNS)} AND NOT EXISTS (
      SELECT 1 FROM "ConversationMessage" o
      WHERE o."conversationId" = c.id AND o."sentAt" < m."sentAt"
        AND ((o.author = 'CUSTOMER' AND o.body = ${BUTTON_ORDER}) OR (o.author = 'BOT' AND (o.body LIKE ${BOT_ORDER_FLOW_LIKE} OR o.body LIKE ${BOT_ORDER_COMPLETE_LIKE}))))
    FROM "ConversationMessage" m
    WHERE m."conversationId" = c.id AND m.author = 'CUSTOMER' AND m.body IS NOT NULL AND m.body NOT IN (${buttons})
    ORDER BY m."sentAt", m.id LIMIT 1), false)`;
  return Prisma.sql`
      SELECT c.id AS "conversationId", c."createdAt" AS "createdAt",
        (c.status = 'RESUELTA') AS "resolved", c."closureTypeName" AS "closureTypeName", c."externalLabels" AS "labels",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${PRESCRIPTION_ORDER}`)} AS "prescription",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_HOME}`)} AS "homeDelivery",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_PICKUP}`)} AS "pickup",
        ${flag(Prisma.sql`m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}`)} AS "botOrderComplete",
        (${flag(strong)} OR (NOT ${flag(Prisma.sql`${op} AND m.body ~* ${OPERATOR_CANCELLED}`)}
          AND (${flag(evidence)} OR (${flag(closing)} AND NOT ${flag(Prisma.sql`${op} AND m.body ~* ${OPERATOR_WAITING}`)})))) AS "confirmed",
        ${flag(Prisma.sql`${op} AND m.body ~* ${OPERATOR_POSTPONED}`)} AS "postponed",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${SALE_LOST_PROBABLE}`)} AS "saleProbable",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${NOT_A_LOSS}`)} AS "notALoss",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${SALE_LOST_CUSTOMER} AND m.body !~* ${SALE_LOST_PROBABLE}`)} AS "saleLost",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${SALE_LOST_ELSEWHERE} AND m.body !~* ${SALE_LOST_PROBABLE}`)} AS "saleElsewhere",
        (${flag(Prisma.sql`${cust} AND m.body ~* ${SALE_LOST_CUSTOMER} AND m.body ~* ${tkl}`)}
          OR (${flag(Prisma.sql`${cust} AND m.body ~* ${CUSTOMER_GOES_TO_BRANCH}`)} AND ${flag(Prisma.sql`${op} AND m.body ~* ${OPERATOR_OFFERED_STOCK}`)})) AS "boughtAtTkl",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${CUSTOMER_DECLINED}`)} AS "declined",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${FOLLOW_UP_CUSTOMER}`)} AS "followUp",
        ${flag(op)} AS "hasHumanResponse",
        ${flag(Prisma.sql`${op} AND m.body ~* ${OPERATOR_IN_PERSON_ONLY}`)} AS "operatorInPersonOnly",
        ${flag(Prisma.sql`${op} AND m.body ~* ${OPERATOR_NO_STOCK}`)} AS "operatorNoStock",
        ${flag(Prisma.sql`${cust} AND (m.body IS NULL OR m."mediaType" IS NOT NULL)`)} AS "customerMedia",
        (count(*) FILTER (WHERE ${free}))::int AS "freeMessages",
        (count(*) FILTER (WHERE ${free} AND ${empty}))::int AS "emptyMessages",
        ${flag(Prisma.sql`${free} AND m.body LIKE '%?%'`)} AS "hasQuestionMark",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_SERVICES}`)} AS "services",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_PRICE}`)} AS "price",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_STOCK}`)} AS "stock",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_HOURS}`)} AS "hours",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_COVERAGE}`)} AS "coverage",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_PAYMENT}`)} AS "paymentMethod",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_ONLINE_STORE}`)} AS "onlineStore",
        ${firstClaim} AS "firstClaim",
        ${flag(Prisma.sql`${free} AND ${messageMatches(STRICT_CLAIM_PATTERNS)}`)} AS "strictClaim",
        ${flag(Prisma.sql`${cust} AND m.body ~* ${PRESCRIPTION_LINK_REGEX}`)} AS "prescriptionLink",
        (min(substring(lower(m.body) from ${PRESCRIPTION_PLATFORM_CAPTURE})) FILTER (WHERE ${cust})) AS "prescriptionPlatform",
        ${flag(Prisma.sql`(${cust} AND m.body = ${BUTTON_ORDER}) OR (m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_FLOW_LIKE})`)} AS "orderButton",
        ${flag(Prisma.sql`${free} AND m.body ~* ${ORDER_FREE_TEXT}`)} AS "orderText",
        ${flag(Prisma.sql`${free} AND m.body ~* ${FOLLOW_UP_ARRIVAL}`)} AS "followUpArrival",
        ${flag(Prisma.sql`${free} AND m.body ~* ${CONSULT_STOCK_PAST}`)} AS "stockPast",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_ADVISOR}`)} AS "advisorButton",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_HOURS}`)} AS "infoHours",
        ${flag(Prisma.sql`${cust} AND m.body = ${BUTTON_ONLINE_STORE}`)} AS "infoOnline",
        (count(*) FILTER (WHERE ${cust}))::int AS "customerMessages"
      FROM "Conversation" c
      LEFT JOIN "ConversationMessage" m ON m."conversationId" = c.id
      WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
      GROUP BY c.id, c."createdAt", c.status, c."closureTypeName", c."externalLabels"
    `;
}

const CACHE_MAX_ENTRIES = 20;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; payload: KindsPayload }>();

/** Informe del período, con caché de un minuto por período. */
export async function getKindsPayload(from: string, to: string, now: Date = new Date()): Promise<KindsPayload> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.payload;

  const t0 = Date.now();
  const [rows, { versions }] = await Promise.all([loadKindRows(from, to), loadConfigVersions()]);
  const t1 = Date.now();
  // Las etiquetas de cierre son las de la configuración vigente hoy.
  const closureMap = closureMapOf(configForDay(versions, arDayISO(now))?.data);
  const payload: KindsPayload = { ...buildKindsReport(rows, { now, from, to, closureMap }), motives: buildMotivesReport(rows, (r) => classifyKind(r).main) };

  // Duración, para seguir el tiempo de carga de "Motivos de contacto" y "Reclamos y pérdidas". Solo números.
  console.log("[call-center/metrics/kinds] ms", JSON.stringify({ consulta: t1 - t0, calculo: Date.now() - t1, total: Date.now() - t0, filas: rows.length, desde: from, hasta: to }));
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= CACHE_MS) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}

/** Conversaciones de un motivo de contacto en el período. Sin caché: se pide a demanda. Solo lectura. */
export async function getMotiveCases(from: string, to: string, motive: Motive, now: Date = new Date()): Promise<MotiveCasesPayload> {
  const rows = await loadKindRows(from, to);
  return { motive, from, to, generatedAt: now.toISOString(), ...selectMotiveCases(rows, motive) };
}
