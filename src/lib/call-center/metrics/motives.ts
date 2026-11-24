/**
 * "Motivos de contacto": para qué escribió el cliente. Nivel DETECTADO: recorrido del bot y
 * palabras; puede requerir revisión.
 *
 * Un motivo principal por conversación: la necesidad que originó el contacto. Una cancelación
 * o un reclamo posterior no lo reemplaza. Orden:
 *  1. Reclamo, si el PRIMER mensaje escrito del cliente ya es un reclamo y antes no había
 *     empezado un pedido en el bot.
 *  2. Solicitar un pedido: una solicitud explícita de compra, aunque nadie haya respondido.
 *     Cuenta una receta digital (el mensaje armado o el enlace de una plataforma), los datos
 *     completos del recorrido de PEDIDO del bot (el mensaje final solo, sin haber entrado por
 *     "Pedir medicamentos", no alcanza: también cierra el camino "Asesor"), o un pedido en
 *     texto libre. Tocar "Pedir medicamentos"
 *     NO alcanza solo: hace falta además un adjunto, o texto propio que no sea una pregunta
 *     ni un tema de consulta (lo más parecido a un producto escrito que se puede detectar).
 *  3. Consultar un pedido o pago existente: "¿a qué hora llega?" es seguimiento, no reclamo.
 *  4. Hacer una consulta: un tema reconocido, una pregunta, o las opciones informativas del
 *     bot (sucursales y horarios, tienda online).
 *  5. Reclamo, si aparece más adelante y no hay ninguno de los motivos anteriores.
 *  6. Solo saludo o agradecimiento: escribió, y todo lo que escribió son saludos o gracias.
 *  7. Motivo no identificado: lo que queda, con la razón.
 *
 * "Receta digital" no es un motivo: es una característica del contacto.
 *
 * PURO.
 */
import { arDayISO, arHour } from "./business-time";
import { CONSULT_KINDS, MAIN_KINDS, type ConsultKind, type MainKind } from "./kinds-types";
import {
  MOTIVES, MOTIVE_CASES_MAX_ROWS, ORDER_SIGNALS, UNKNOWN_REASONS,
  type ConversationMotive, type Motive, type MotiveCase, type MotiveCounts, type MotivesPayload, type OrderSignal, type UnknownReason,
} from "./motives-types";

/** Marcas de una conversación que hacen falta para el motivo. Sin teléfono, nombre ni texto. */
export interface MotiveFlags {
  /** El primer mensaje escrito del cliente (no un botón) ya es un reclamo, sin un pedido empezado antes en el bot. */
  firstClaim: boolean;
  /** Algún mensaje del cliente es un reclamo, con la regla de esta pestaña (seguimiento aparte). */
  strictClaim: boolean;
  /** Mensaje armado de una receta digital para pedir. */
  prescription: boolean;
  /** Enlace de una plataforma de recetas. */
  prescriptionLink: boolean;
  /** Plataforma reconocida por el dominio del enlace; null si no hay enlace reconocido. */
  prescriptionPlatform: string | null;
  /**
   * El bot cerró su recorrido con el mensaje final. OJO: ese mensaje también cierra el camino
   * "Asesor", así que solo vale como "datos completos del pedido" junto con `orderButton`.
   */
  botOrderComplete: boolean;
  /** Tocó "Pedir medicamentos" o entró al recorrido de pedido. */
  orderButton: boolean;
  /** Pide en texto libre. */
  orderText: boolean;
  /** Pregunta por un pago o un pedido ya hecho (la misma marca que usa "Tipos"). */
  followUp: boolean;
  /** Pregunta cuándo o a qué hora llega el pedido, o dónde está: seguimiento, no reclamo. */
  followUpArrival: boolean;
  /** Tocó "Asesor". */
  advisorButton: boolean;
  /** Tocó "Suc. y Horarios" o "Tienda online": el bot contesta con la información. */
  infoHours: boolean;
  infoOnline: boolean;
  /** Mandó algún mensaje (botón, texto o adjunto). */
  hasCustomerMessage: boolean;
  customerMedia: boolean;
  hasFreeText: boolean;
  onlyEmptyText: boolean;
  hasQuestionMark: boolean;
  services: boolean;
  price: boolean;
  stock: boolean;
  hours: boolean;
  coverage: boolean;
  paymentMethod: boolean;
  onlineStore: boolean;
  /** Pregunta por stock en pasado o condicional ("tenían", "tendrían"). */
  stockPast?: boolean;
}

function consultOf(r: MotiveFlags): ConsultKind {
  if (r.services) return "SERVICIOS";
  if (r.price) return "PRECIO";
  if (r.stock || r.stockPast) return "STOCK";
  if (r.hours || r.infoHours) return "HORARIOS";
  if (r.coverage) return "COBERTURA";
  if (r.paymentMethod) return "PAGO";
  if (r.onlineStore || r.infoOnline) return "TIENDA_ONLINE";
  return "OTRAS";
}

/** La señal más fuerte de que es una solicitud de pedido; null si no lo es. PURO. */
export function orderSignalOf(r: MotiveFlags): OrderSignal | null {
  if (r.prescription || r.prescriptionLink) return "RECETA";
  // El mensaje final del bot vale solo si el cliente había entrado por el recorrido de pedido.
  if (r.botOrderComplete && r.orderButton) return "DATOS_COMPLETOS";
  if (r.orderText) return "TEXTO";
  const topic = r.services || r.price || r.stock || r.stockPast === true || r.hours || r.coverage || r.paymentMethod || r.onlineStore;
  const ownContent = r.hasFreeText && !r.onlyEmptyText && !topic && !r.hasQuestionMark;
  if (r.orderButton && (r.customerMedia || ownContent)) return "BOTON_Y_CONTENIDO";
  return null;
}

/** PURO. */
export function classifyMotive(r: MotiveFlags): ConversationMotive {
  const orderSignal = orderSignalOf(r);
  const topic = r.services || r.price || r.stock || r.stockPast === true || r.hours || r.coverage || r.paymentMethod || r.onlineStore;
  const consult = topic || r.hasQuestionMark || r.infoHours || r.infoOnline;
  const followUp = r.followUp || r.followUpArrival;
  const present: Record<Motive, boolean> = {
    PEDIDO: orderSignal !== null, CONSULTA: consult, SEGUIMIENTO: followUp, RECLAMO: r.strictClaim || r.firstClaim, SALUDO: false, NO_IDENTIFICADO: false,
  };

  let main: Motive;
  let unknownReason: UnknownReason | null = null;
  if (r.firstClaim) main = "RECLAMO";
  else if (orderSignal) main = "PEDIDO";
  else if (followUp) main = "SEGUIMIENTO";
  else if (consult) main = "CONSULTA";
  else if (r.strictClaim) main = "RECLAMO";
  else if (r.hasFreeText && r.onlyEmptyText && !r.customerMedia && !r.orderButton && !r.advisorButton) main = "SALUDO";
  else {
    main = "NO_IDENTIFICADO";
    unknownReason = !r.hasCustomerMessage ? "SIN_MENSAJES"
      : r.orderButton ? "BOTON_PEDIDO"
      : r.customerMedia ? "ADJUNTO"
      : r.advisorButton ? "ASESOR"
      : !r.hasFreeText ? "SOLO_BOTONES"
      : "TEXTO";
  }
  const has = r.prescription || r.prescriptionLink;
  return {
    main,
    extra: MOTIVES.filter((m) => m !== main && present[m]),
    consult: main === "CONSULTA" ? consultOf(r) : null,
    orderSignal: main === "PEDIDO" ? orderSignal : null,
    unknownReason,
    prescription: { has, platform: has ? r.prescriptionPlatform ?? "otra" : null },
  };
}

const zero = (): MotiveCounts => Object.fromEntries(MOTIVES.map((m) => [m, 0])) as MotiveCounts;

/** Informe del período. `kindOf` da el tipo de la clasificación anterior, para medir el cambio. PURO. */
export function buildMotivesReport<R extends MotiveFlags & { createdAt: Date }>(rows: readonly R[], kindOf: (r: R) => MainKind): MotivesPayload {
  const total = zero();
  const extra = zero();
  const consults = Object.fromEntries(CONSULT_KINDS.map((k) => [k, 0])) as Record<ConsultKind, number>;
  const orderSignals = Object.fromEntries(ORDER_SIGNALS.map((k) => [k, 0])) as Record<OrderSignal, number>;
  const unknownReasons = Object.fromEntries(UNKNOWN_REASONS.map((k) => [k, 0])) as Record<UnknownReason, number>;
  const platforms = new Map<string, number>();
  let withPrescription = 0;
  const byDay = new Map<string, MotiveCounts>();
  const byHour = Array.from({ length: 24 }, zero);
  const fromKind = Object.fromEntries(MAIN_KINDS.map((k) => [k, zero()])) as Record<MainKind, MotiveCounts>;

  for (const r of rows) {
    const m = classifyMotive(r);
    total[m.main]++;
    for (const e of m.extra) extra[e]++;
    if (m.consult) consults[m.consult]++;
    if (m.orderSignal) orderSignals[m.orderSignal]++;
    if (m.unknownReason) unknownReasons[m.unknownReason]++;
    if (m.prescription.has) { withPrescription++; platforms.set(m.prescription.platform!, (platforms.get(m.prescription.platform!) ?? 0) + 1); }
    const day = arDayISO(r.createdAt);
    const d = byDay.get(day) ?? zero();
    d[m.main]++;
    byDay.set(day, d);
    byHour[arHour(r.createdAt)][m.main]++;
    fromKind[kindOf(r)][m.main]++;
  }

  return {
    conversations: rows.length,
    total, extra, consults, orderSignals, unknownReasons,
    prescription: {
      has: withPrescription,
      byPlatform: [...platforms.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)),
    },
    byDay: [...byDay.keys()].sort().map((day) => ({ day, ...byDay.get(day)! })),
    byHour,
    fromKind,
  };
}

/** Las conversaciones con un motivo principal, de la más nueva a la más vieja, con el total antes del tope. PURO. */
export function selectMotiveCases<R extends MotiveFlags & { conversationId: string; createdAt: Date }>(
  rows: readonly R[], motive: Motive, maxRows: number = MOTIVE_CASES_MAX_ROWS,
): { total: number; cases: MotiveCase[] } {
  const all = rows
    .map((r) => ({ r, m: classifyMotive(r) }))
    .filter((x) => x.m.main === motive)
    .sort((a, b) => b.r.createdAt.getTime() - a.r.createdAt.getTime());
  return {
    total: all.length,
    cases: all.slice(0, maxRows).map(({ r, m }) => ({
      conversationId: r.conversationId, createdAt: r.createdAt.toISOString(), extra: m.extra,
      consult: m.consult, orderSignal: m.orderSignal, unknownReason: m.unknownReason, prescription: m.prescription.has,
    })),
  };
}
