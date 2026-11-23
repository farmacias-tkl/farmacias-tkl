/**
 * Atención y demoras: una fila por conversación CREADA en el período (población "por
 * entrada") y el resumen por día.
 *
 * Definiciones (diccionario en indicators.ts):
 *  - Salida del bot: primer cambio Pendiente → Sin asignar / Asignada. Aproximación a la
 *    derivación; su hora es la de procesamiento del evento.
 *  - Primera respuesta humana: primer mensaje PÚBLICO de operador. Se mide una vez por
 *    conversación (una reapertura no genera otra).
 *  - El reloj de la meta corre desde la salida del bot; sin salida registrada, desde la
 *    creación. Al lado se informa la espera desde el primer mensaje del cliente.
 *  - Medianas y percentiles: solo entre las respondidas. Los pendientes van aparte, con su
 *    antigüedad, en cuatro grupos de la meta (ver business-time.ts).
 *  - Candidatos a agradecimiento: cuentan como pendientes vencidos en el cumplimiento
 *    principal; se informa también la cifra sin ellos.
 *
 * buildAttentionReport es PURO. loadEntryRows es la única función que toca la base, en
 * solo lectura, partiendo de la conversación (índice por conversación de los mensajes).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  arDayISO, arHour, arDayStartUTC, classifyAgainstGoal, isWithinHours, utcTimestampParam,
  type DayRanges, type GoalGroup,
} from "./business-time";
import { configForDay, type ConfigVersion } from "./config";
import { publicHours } from "./schedule";
import { BOT_ORDER_COMPLETE_LIKE, THANKS_CANDIDATE, isThanksCandidate } from "./patterns";
import {
  BOT_ORDER_FLOW_LIKE, CUSTOMER_ORDER_OPTION, MEDUCAR_LINK_REGEX, MEDUCAR_PHRASE_REGEX,
  classifyBotExit, classifyManagementType, type BotExitPath, type ManagementType,
} from "./management-type";

const MS_MIN = 60_000;

/** Una conversación del período, tal como sale de la consulta. Sin datos del cliente. */
export interface EntryRow {
  conversationId: string;
  createdAt: Date;
  firstCustomerAt: Date | null;
  botExitAt: Date | null;
  botOrderCompleteAt: Date | null;
  firstHumanAt: Date | null;
  /** Cuenta de Emozion que dio la primera respuesta. */
  firstHumanAccount: string | null;
  orderFlow: boolean;
  firstCustomerMessageIsMeducar: boolean;
  customerChars: number;
  customerSentMedia: boolean;
  customerSentLink: boolean;
  previousResolvedRecently: boolean;
}

/** Una conversación ya clasificada. */
export interface EntryFact extends EntryRow {
  day: string;          // día de Buenos Aires de la creación
  hour: number;         // hora de Buenos Aires de la creación
  managementType: ManagementType;
  botExitPath: BotExitPath;
  /** Desde cuándo corre el reloj: salida del bot o, si no hay, creación. */
  clockStart: Date;
  thanksCandidate: boolean;
  /** Minutos de reloj hasta la primera respuesta; null si sigue pendiente. */
  clockMinutes: number | null;
  /** Minutos desde el primer mensaje del cliente; null si pendiente o sin mensaje del cliente. */
  fromFirstMessageMinutes: number | null;
  /** Minutos de reloj en el bot; null sin salida registrada. */
  botMinutes: number | null;
  /** Meta: null si no había configuración vigente ese día, o si la meta no aplica (noPublicHoursSameDay). */
  goal: { group: GoalGroup; businessMinutes: number; goalMinutes: number } | null;
  /**
   * Salió del bot un día sin horario público (domingo o feriado) y se respondió ese mismo
   * día. La meta pública no aplica: no cuenta como cumplida con cero minutos hábiles. Queda
   * fuera del cumplimiento y de la mediana hábil, y se informa aparte con su espera real.
   * Si ese día no se respondió, sigue en la meta y el reloj corre desde que abre el horario.
   */
  noPublicHoursSameDay: boolean;
  answeredSameDay: boolean;
  enteredInPublicHours: boolean | null;
}

export interface Distribution {
  /** Cantidad de valores sobre los que se calculó. */
  n: number;
  median: number | null;
  p90: number | null;
}

/** Percentil con interpolación lineal (igual que percentile_cont de Postgres). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(values: readonly number[]): Distribution {
  return { n: values.length, median: percentile(values, 0.5), p90: percentile(values, 0.9) };
}

export interface GoalSummary {
  goalMinutes: number | null;
  answeredWithin: number;
  answeredLate: number;
  pendingOverdue: number;
  pendingWithin: number;
  /** answeredWithin / (answeredWithin + answeredLate + pendingOverdue). null sin denominador. */
  compliance: number | null;
  /** Lo mismo sin los candidatos a agradecimiento. */
  complianceExcludingThanks: number | null;
  /** Candidatos a agradecimiento entre los pendientes vencidos. */
  thanksCandidatesOverdue: number;
  /** Respondidas con 0 minutos hábiles (antes de abrir la atención). */
  answeredBeforeOpening: number;
}

export interface PendingSummary {
  total: number;
  thanksCandidates: number;
  completedOrders: number;
  /** Inicio del reloj del pendiente más viejo. */
  oldestClockStart: Date | null;
  /** Mediana de la antigüedad de los pendientes, en minutos de reloj hasta `now`. */
  medianAgeMinutes: number | null;
}

export interface AttentionSummary {
  entries: number;
  byManagementType: Record<ManagementType, number>;
  byBotExitPath: Record<BotExitPath, { conversations: number; botTime: Distribution; answered: number }>;
  answered: number;
  /** Medianas SOLO entre respondidas. */
  firstResponseClock: Distribution;
  /** null si no había configuración vigente para ninguna conversación del grupo. */
  firstResponseBusiness: Distribution | null;
  fromFirstMessage: Distribution;
  pending: PendingSummary;
  goal: GoalSummary | null;
  unansweredSameDay: {
    total: number;
    /** null si no había horario configurado. */
    enteredInPublicHours: number | null;
    completedOrders: number;
  };
  /** Pedidos y Meducar creados desde las 17:00: cuántos y cuántos respondidos el mismo día. */
  lateOrders: { total: number; answeredSameDay: number };
  /** Conversaciones sin configuración vigente el día de entrada: quedan fuera de la meta. */
  withoutConfig: number;
  /**
   * Respondidas el mismo día en que salieron del bot, cuando ese día no tenía horario público:
   * la meta no aplica. Con su espera de reloj, que es la espera real del cliente.
   */
  noPublicHours: { answered: number; clock: Distribution };
}

export interface AttentionDay extends AttentionSummary {
  day: string;
  /** El día todavía no terminó al momento del corte. */
  inProgress: boolean;
  /**
   * Salieron del bot dentro del horario público y al cierre de ese día no tenían respuesta.
   * null si no hay horario configurado o el horario de ese día todavía no cerró.
   */
  pendingAtClose: { leftBotInHours: number; pending: number } | null;
  /** Entradas por hora de Buenos Aires (24 posiciones). */
  byHour: number[];
}

export interface AttentionReport {
  generatedAt: Date;
  from: string;
  to: string;
  total: AttentionSummary;
  days: AttentionDay[];
  /** Hay al menos una versión de configuración vigente en el período. */
  hasConfig: boolean;
}

/** Clasifica una fila: tipo de gestión, vía de salida, demoras y grupo de la meta. PURO. */
export function toEntryFact(row: EntryRow, now: Date, versions: readonly ConfigVersion[], pub: DayRanges): EntryFact {
  const day = arDayISO(row.createdAt);
  const clockStart = row.botExitAt ?? row.createdAt;
  const clockDay = arDayISO(clockStart);
  const version = configForDay(versions, clockDay);
  const answered = row.firstHumanAt;
  const noPublicHoursSameDay = version !== null && pub(clockDay).length === 0 && answered !== null && arDayISO(answered) === clockDay;
  return {
    ...row,
    day,
    hour: arHour(row.createdAt),
    managementType: classifyManagementType(row),
    botExitPath: classifyBotExit(row.botExitAt, row.botOrderCompleteAt),
    clockStart,
    thanksCandidate: isThanksCandidate({
      hasHumanResponse: answered !== null,
      previousResolvedRecently: row.previousResolvedRecently,
      customerChars: row.customerChars,
      customerSentMedia: row.customerSentMedia,
      customerSentLink: row.customerSentLink,
      botOrderComplete: row.botOrderCompleteAt !== null,
    }),
    clockMinutes: answered ? Math.max(0, (answered.getTime() - clockStart.getTime()) / MS_MIN) : null,
    fromFirstMessageMinutes: answered && row.firstCustomerAt
      ? Math.max(0, (answered.getTime() - row.firstCustomerAt.getTime()) / MS_MIN)
      : null,
    botMinutes: row.botExitAt ? Math.max(0, (row.botExitAt.getTime() - row.createdAt.getTime()) / MS_MIN) : null,
    noPublicHoursSameDay,
    goal: version && !noPublicHoursSameDay
      ? {
          ...classifyAgainstGoal(clockStart, answered, now, version.data.firstResponseGoalMinutes, pub),
          goalMinutes: version.data.firstResponseGoalMinutes,
        }
      : null,
    answeredSameDay: answered !== null && arDayISO(answered) === day,
    enteredInPublicHours: configForDay(versions, day) ? isWithinHours(row.createdAt, pub) : null,
  };
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Resumen de un grupo de conversaciones. PURO. */
export function summarize(facts: readonly EntryFact[], now: Date): AttentionSummary {
  const byManagementType: Record<ManagementType, number> = { MEDUCAR: 0, PEDIDO: 0, OTROS: 0 };
  const paths: BotExitPath[] = ["PEDIDO_COMPLETO", "SIN_MENSAJE_FINAL", "SIN_REGISTRO"];
  const botTimes: Record<BotExitPath, number[]> = { PEDIDO_COMPLETO: [], SIN_MENSAJE_FINAL: [], SIN_REGISTRO: [] };
  const byPath = Object.fromEntries(paths.map((p) => [p, { conversations: 0, answered: 0 }])) as Record<BotExitPath, { conversations: number; answered: number }>;

  const clock: number[] = [];
  const business: number[] = [];
  const fromFirst: number[] = [];
  const pendingAges: number[] = [];
  let answered = 0;
  let withoutConfig = 0;
  const pending: PendingSummary = { total: 0, thanksCandidates: 0, completedOrders: 0, oldestClockStart: null, medianAgeMinutes: null };
  const g = { answeredWithin: 0, answeredLate: 0, pendingOverdue: 0, pendingWithin: 0, thanksOverdue: 0, beforeOpening: 0, withGoal: 0 };
  const goalMinutesSeen = new Set<number>();
  const unanswered = { total: 0, inHours: 0, inHoursKnown: 0, completedOrders: 0 };
  const late = { total: 0, answeredSameDay: 0 };
  const offHoursClock: number[] = [];

  for (const f of facts) {
    byManagementType[f.managementType]++;
    byPath[f.botExitPath].conversations++;
    if (f.botMinutes !== null) botTimes[f.botExitPath].push(f.botMinutes);

    if (f.firstHumanAt) {
      answered++;
      byPath[f.botExitPath].answered++;
      clock.push(f.clockMinutes!);
      if (f.fromFirstMessageMinutes !== null) fromFirst.push(f.fromFirstMessageMinutes);
      if (f.goal) business.push(f.goal.businessMinutes);
    } else {
      pending.total++;
      if (f.thanksCandidate) pending.thanksCandidates++;
      if (f.botOrderCompleteAt) pending.completedOrders++;
      if (!pending.oldestClockStart || f.clockStart < pending.oldestClockStart) pending.oldestClockStart = f.clockStart;
      pendingAges.push(Math.max(0, (now.getTime() - f.clockStart.getTime()) / MS_MIN));
    }

    if (f.goal) {
      g.withGoal++;
      goalMinutesSeen.add(f.goal.goalMinutes);
      if (f.goal.group === "ANSWERED_WITHIN_GOAL") { g.answeredWithin++; if (f.goal.businessMinutes === 0) g.beforeOpening++; }
      else if (f.goal.group === "ANSWERED_LATE") g.answeredLate++;
      else if (f.goal.group === "PENDING_OVERDUE") { g.pendingOverdue++; if (f.thanksCandidate) g.thanksOverdue++; }
      else g.pendingWithin++;
    } else if (f.noPublicHoursSameDay) {
      offHoursClock.push(f.clockMinutes!);
    } else {
      withoutConfig++;
    }

    if (!f.answeredSameDay) {
      unanswered.total++;
      if (f.botOrderCompleteAt) unanswered.completedOrders++;
      if (f.enteredInPublicHours !== null) { unanswered.inHoursKnown++; if (f.enteredInPublicHours) unanswered.inHours++; }
    }
    if (f.managementType !== "OTROS" && f.hour >= 17) {
      late.total++;
      if (f.answeredSameDay) late.answeredSameDay++;
    }
  }

  pending.medianAgeMinutes = percentile(pendingAges, 0.5);
  const denominator = g.answeredWithin + g.answeredLate + g.pendingOverdue;
  return {
    entries: facts.length,
    byManagementType,
    byBotExitPath: Object.fromEntries(paths.map((p) => [p, { ...byPath[p], botTime: distribution(botTimes[p]) }])) as AttentionSummary["byBotExitPath"],
    answered,
    firstResponseClock: distribution(clock),
    firstResponseBusiness: g.withGoal > 0 ? distribution(business) : null,
    fromFirstMessage: distribution(fromFirst),
    pending,
    goal: g.withGoal > 0
      ? {
          // Si la meta cambió dentro del período no hay un único valor que mostrar.
          goalMinutes: goalMinutesSeen.size === 1 ? [...goalMinutesSeen][0] : null,
          answeredWithin: g.answeredWithin,
          answeredLate: g.answeredLate,
          pendingOverdue: g.pendingOverdue,
          pendingWithin: g.pendingWithin,
          compliance: ratio(g.answeredWithin, denominator),
          complianceExcludingThanks: ratio(g.answeredWithin, denominator - g.thanksOverdue),
          thanksCandidatesOverdue: g.thanksOverdue,
          answeredBeforeOpening: g.beforeOpening,
        }
      : null,
    unansweredSameDay: {
      total: unanswered.total,
      enteredInPublicHours: unanswered.inHoursKnown === unanswered.total ? unanswered.inHours : null,
      completedOrders: unanswered.completedOrders,
    },
    lateOrders: late,
    withoutConfig,
    noPublicHours: { answered: offHoursClock.length, clock: distribution(offHoursClock) },
  };
}

/** Cierre del horario público de un día: fin de su última franja. null si ese día no hay atención. */
export function publicCloseOf(day: string, pub: DayRanges): Date | null {
  const ranges = pub(day);
  if (ranges.length === 0) return null;
  return new Date(arDayStartUTC(day).getTime() + ranges[ranges.length - 1].to * MS_MIN);
}

/** Informe del período a partir de las filas. PURO. `from` y `to` son días de Buenos Aires, inclusive. */
export function buildAttentionReport(
  rows: readonly EntryRow[],
  opts: { now: Date; from: string; to: string; versions: readonly ConfigVersion[] },
): AttentionReport {
  const pub = publicHours(opts.versions);
  const facts = rows.map((r) => toEntryFact(r, opts.now, opts.versions, pub));
  const today = arDayISO(opts.now);

  const byDay = new Map<string, EntryFact[]>();
  for (const f of facts) {
    const list = byDay.get(f.day);
    if (list) list.push(f); else byDay.set(f.day, [f]);
  }

  const days: AttentionDay[] = [...byDay.keys()].sort().map((day) => {
    const list = byDay.get(day)!;
    const byHour = new Array<number>(24).fill(0);
    for (const f of list) byHour[f.hour]++;

    let pendingAtClose: AttentionDay["pendingAtClose"] = null;
    const close = configForDay(opts.versions, day) ? publicCloseOf(day, pub) : null;
    if (close && close.getTime() <= opts.now.getTime()) {
      const leftInHours = list.filter((f) => f.botExitAt && arDayISO(f.botExitAt) === day && isWithinHours(f.botExitAt, pub));
      pendingAtClose = {
        leftBotInHours: leftInHours.length,
        pending: leftInHours.filter((f) => !f.firstHumanAt || f.firstHumanAt.getTime() > close.getTime()).length,
      };
    }
    return { day, inProgress: day >= today, pendingAtClose, byHour, ...summarize(list, opts.now) };
  });

  return {
    generatedAt: opts.now,
    from: opts.from,
    to: opts.to,
    total: summarize(facts, opts.now),
    days,
    hasConfig: facts.some((f) => f.goal !== null || f.noPublicHoursSameDay),
  };
}

interface RawEntryRow {
  id: string;
  createdAt: Date;
  firstCustomerAt: Date | null;
  botExitAt: Date | null;
  botOrderCompleteAt: Date | null;
  firstHumanAt: Date | null;
  firstHumanAccount: string | null;
  orderFlow: boolean | null;
  meducar: boolean | null;
  custChars: number | null;
  custMedia: boolean | null;
  custLink: boolean | null;
  prevResolved: boolean;
}

/**
 * Conversaciones creadas entre dos días de Buenos Aires, inclusive. Solo lectura.
 * No selecciona teléfono, nombre ni texto: los textos se evalúan dentro de la consulta y
 * solo salen marcas (sí/no), horas y el número de la cuenta que respondió.
 */
export async function loadEntryRows(fromDay: string, toDayInclusive: string): Promise<EntryRow[]> {
  const from = arDayStartUTC(fromDay);
  const to = new Date(arDayStartUTC(toDayInclusive).getTime() + 24 * 60 * MS_MIN);
  const prevHours = `${THANKS_CANDIDATE.previousResolvedWithinHours} hours`;

  const rows = await prisma.$queryRaw<RawEntryRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id, c."customerId", c."createdAt"
      FROM "Conversation" c
      WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
    ), agg AS (
      SELECT m."conversationId" AS cid,
        min(m."sentAt") FILTER (WHERE m.author = 'CUSTOMER') AS first_cust,
        min(m."sentAt") FILTER (WHERE m.author = 'OPERATOR' AND NOT m."isPrivate") AS first_op,
        min(m."sentAt") FILTER (WHERE m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_COMPLETE_LIKE}) AS done_at,
        bool_or((m.author = 'CUSTOMER' AND m.body = ${CUSTOMER_ORDER_OPTION})
             OR (m.author = 'BOT' AND m.body LIKE ${BOT_ORDER_FLOW_LIKE})) AS order_flow,
        coalesce(sum(length(coalesce(m.body, ''))) FILTER (WHERE m.author = 'CUSTOMER'), 0)::int AS cust_chars,
        bool_or(m.author = 'CUSTOMER' AND (m.body IS NULL OR m."mediaType" IS NOT NULL)) AS cust_media,
        bool_or(m.author = 'CUSTOMER' AND m.body ~* 'https?://') AS cust_link
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      GROUP BY 1
    )
    SELECT
      s.id,
      s."createdAt" AS "createdAt",
      a.first_cust AS "firstCustomerAt",
      (SELECT min(h."changedAt") FROM "ConversationStateHistory" h
        WHERE h."conversationId" = s.id AND h."fromStatus" = 'PENDIENTE'
          AND h."toStatus" IN ('SIN_ASIGNAR', 'ASIGNADA')) AS "botExitAt",
      a.done_at AS "botOrderCompleteAt",
      a.first_op AS "firstHumanAt",
      (SELECT m."externalSenderId" FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND m.author = 'OPERATOR' AND NOT m."isPrivate"
        ORDER BY m."sentAt", m.id LIMIT 1) AS "firstHumanAccount",
      a.order_flow AS "orderFlow",
      (SELECT (m.author = 'CUSTOMER' AND m.body ~* ${MEDUCAR_LINK_REGEX} AND m.body ~* ${MEDUCAR_PHRASE_REGEX})
        FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id
        ORDER BY m."sentAt", m.id LIMIT 1) AS "meducar",
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
    LEFT JOIN agg a ON a.cid = s.id
  `);

  return rows.map((r) => ({
    conversationId: r.id,
    createdAt: r.createdAt,
    firstCustomerAt: r.firstCustomerAt,
    botExitAt: r.botExitAt,
    botOrderCompleteAt: r.botOrderCompleteAt,
    firstHumanAt: r.firstHumanAt,
    firstHumanAccount: r.firstHumanAccount,
    orderFlow: r.orderFlow === true,
    firstCustomerMessageIsMeducar: r.meducar === true,
    customerChars: Number(r.custChars ?? 0),
    customerSentMedia: r.custMedia === true,
    customerSentLink: r.custLink === true,
    previousResolvedRecently: r.prevResolved,
  }));
}
