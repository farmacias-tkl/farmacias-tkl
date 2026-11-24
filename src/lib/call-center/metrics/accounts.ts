/**
 * Operadores, por CUENTA de Emozion. Una cuenta no es una persona: puede estar prestada o
 * compartida, y en la v1 se muestra como cuenta (número o alias de la configuración).
 *
 * Qué se informa por cuenta:
 *  - conversaciones con participación (al menos un mensaje público en el período);
 *  - primeras respuestas que dio, con la demora de los casos que tomó. Esa demora es de la
 *    COLA: sin el asignado no se puede saber cuánto esperó el caso antes de que la cuenta lo
 *    viera. No sirve para ordenar cuentas y no se ordena por ella;
 *  - respuestas posteriores: por cada bloque de mensajes seguidos del cliente posterior a
 *    una respuesta de operador, del primer mensaje del bloque al siguiente mensaje público
 *    de operador. La espera no se reinicia si el cliente insiste;
 *  - notas internas;
 *  - actividad observada: primer y último mensaje, y los mensajes A CLIENTES dentro del
 *    horario público, solo dentro del de operadores y fuera de ambos (las notas internas no
 *    entran en ese desglose: suma los mensajes a clientes). Es actividad, no jornada;
 *  - cierres del período: por la fila de cierre del historial (su fecha, el tipo de cierre
 *    guardado en ese momento y la cuenta asignada en ese momento), con el mapa de etiquetas
 *    vigente ese día. No por el estado actual de la conversación.
 *
 * Una conversación con dos cuentas cuenta para las dos y una sola vez en el total.
 *
 * Las cuentas marcadas como de sistema en la configuración vigente no son operadores: si
 * escriben, van en un grupo aparte y no suman en los totales del equipo.
 *
 * buildAccountsReport es PURO. Las dos funciones load* son de solo lectura y no traen
 * teléfono, nombre ni texto.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYNC_NOTE_PREFIX } from "../sync-note";
import { arDayISO, arDayStartUTC, isWithinHours, utcTimestampParam, type DayRanges } from "./business-time";
import { configForDay, type ConfigVersion } from "./config";
import { CLOSURE_OUTCOMES, isSupervisionAccount, isSystemAccount, type ClosureOutcome, type ConfigAccount } from "./config-schema";
import { closureMapOf } from "./closure-outcome";
import { publicHours, operatorHours } from "./schedule";
import { distribution, type Distribution, type EntryFact } from "./attention";

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

/** Un mensaje de operador del período. */
export interface OperatorMessageRow {
  account: string | null;
  conversationId: string;
  sentAt: Date;
  isPrivate: boolean;
}

/** Un bloque de mensajes del cliente posterior a una respuesta de operador. */
export interface FollowupBlockRow {
  conversationId: string;
  /** Primer mensaje del bloque. */
  startedAt: Date;
  /** Siguiente mensaje público de operador; null si el bloque quedó sin respuesta. */
  respondedAt: Date | null;
  /** Cuenta que respondió. */
  account: string | null;
}

export type AccountStatus = "ACTIVA" | "HISTORICA" | "SIN_CONFIGURAR";

export interface AccountReportRow {
  /** Número de la cuenta en Emozion; null si el mensaje llegó sin remitente. */
  account: string | null;
  /** Alias de la configuración, si tiene. */
  alias: string | null;
  status: AccountStatus;
  /** La usa otra persona que su titular: no se atribuye a nadie. */
  borrowed: boolean;
  conversations: number;
  /**
   * Cierres del período que esta cuenta tenía asignados al resolverse, por resultado de cierre
   * confirmado por el operador. Cada conversación cuenta una sola vez, por su último cierre
   * del período. null si no se cargaron los cierres.
   */
  closures: AccountClosures | null;
  /** Primeras respuestas que dio a conversaciones que habían entrado un día anterior. */
  firstResponsesLaterDay: number;
  /**
   * Evolución por día de Buenos Aires, solo los días con algo: mensajes a clientes,
   * conversaciones atendidas y respuestas posteriores (por el día en que empezó el bloque del
   * cliente). Sirve para ver si una demora fue puntual o se repite. No es un ranking.
   */
  daily: AccountDay[];
  publicMessages: number;
  privateNotes: number;
  /** Demora de reloj de los casos que tomó, desde la salida del bot. Es demora de la cola. */
  firstResponses: Distribution;
  followups: Distribution;
  activity: {
    firstMessageAt: Date | null;
    lastMessageAt: Date | null;
    daysWithActivity: number;
    /** Mensajes a clientes por horario; las notas internas no entran. null si no hay horario configurado. */
    inPublicHours: number | null;
    inOperatorHoursOnly: number | null;
    outsideAllHours: number | null;
  };
}

export interface AccountsReport {
  generatedAt: Date;
  accounts: AccountReportRow[];
  /** Cuentas de sistema con mensajes en el período: aparte, fuera de los totales del equipo. */
  systemAccounts: AccountReportRow[];
  /** Cuentas de supervisión: no son operadores. Se muestran aparte y no suman en el equipo. */
  supervisionAccounts: AccountReportRow[];
  team: {
    /** Cada conversación una sola vez, aunque hayan participado varias cuentas. */
    conversations: number;
    conversationsWithSeveralAccounts: number;
    firstResponses: Distribution;
    followups: Distribution;
    /** Bloques del cliente que quedaron sin respuesta. */
    followupsUnanswered: number;
    privateNotes: number;
    /** Primeras respuestas dadas a conversaciones que habían entrado un día anterior. */
    firstResponsesLaterDay: number;
  };
  /** Cierres del período, de todo el equipo, con su cobertura. null si no se cargaron. */
  closures: PeriodClosures | null;
  /** Cuentas configuradas como activas que no tuvieron mensajes en el período. */
  activeWithoutMessages: Array<{ account: string; alias: string | null; borrowed: boolean }>;
}

interface Acc {
  conversations: Set<string>;
  days: Set<string>;
  publicMessages: number;
  privateNotes: number;
  first: Date | null;
  last: Date | null;
  inPublic: number;
  inOperatorOnly: number;
  outside: number;
  hoursKnown: boolean;
  firstResponses: number[];
  followups: number[];
  byDay: Map<string, { publicMessages: number; conversations: Set<string>; waits: number[] }>;
}

const KEY_NULL = "\u0000sin-remitente";

export interface AccountDay {
  day: string;
  publicMessages: number;
  conversations: number;
  /** Respuestas posteriores a bloques que empezaron ese día: cantidad y mediana de reloj. */
  followups: number;
  followupMedian: number | null;
}

/** Cierres de una cuenta o de un grupo: por resultado, más los que no se pueden leer. */
export interface AccountClosures {
  /** Conversaciones cerradas en el período. */
  closed: number;
  byOutcome: Record<ClosureOutcome, number>;
  /** Sin tipo de cierre guardado en el momento del cierre. */
  untyped: number;
  /** Sin tipo guardado y con etiquetas de cierre de resultados distintos: no se elige uno. */
  ambiguous: number;
}

/** Una fila RESUELTA del historial dentro del período: lo que se guardó EN ESE MOMENTO. */
export interface PeriodClosureRow {
  conversationId: string;
  closedAt: Date;
  closureTypeName: string | null;
  /** Etiquetas vistas hasta ese cierre. */
  labelsSeen: readonly string[];
  /** Asignado en ese momento; null si se resolvió sin asignado. */
  account: string | null;
  /** "USER" | "AGENT_BOT" | null (sin dato: evento anterior a que se guardara el tipo). */
  assigneeType: string | null;
}

export interface PeriodClosures {
  total: AccountClosures;
  /** Parte de los cierres con un resultado legible: (cerradas − sin tipo − ambiguas) / cerradas. null sin cierres. */
  coverage: number | null;
  /** Se resolvieron sin cuenta asignada: no se atribuyen a nadie. */
  withoutAccount: AccountClosures;
  /** Se resolvieron con un bot como asignado: nadie las había tomado. */
  byBot: AccountClosures;
  /** Por cuenta asignada al resolver (personas). */
  byAccount: Map<string, AccountClosures>;
}

const emptyClosures = (): AccountClosures => ({
  closed: 0, untyped: 0, ambiguous: 0,
  byOutcome: Object.fromEntries(CLOSURE_OUTCOMES.map((o) => [o, 0])) as Record<ClosureOutcome, number>,
});

/**
 * Cierres del período. PURO. Una conversación cuenta una vez, por su último cierre del
 * período. El resultado sale del tipo de cierre guardado en esa fila, leído con el mapa de
 * etiquetas vigente el día del cierre; si la fila no guardó tipo, de las etiquetas vistas
 * hasta ese cierre, solo si todas las de cierre dicen el mismo resultado.
 */
export function buildPeriodClosures(rows: readonly PeriodClosureRow[], versions: readonly ConfigVersion[]): PeriodClosures {
  const last = new Map<string, PeriodClosureRow>();
  for (const r of rows) {
    const prev = last.get(r.conversationId);
    if (!prev || r.closedAt.getTime() >= prev.closedAt.getTime()) last.set(r.conversationId, r);
  }
  const out: PeriodClosures = { total: emptyClosures(), coverage: null, withoutAccount: emptyClosures(), byBot: emptyClosures(), byAccount: new Map() };
  for (const r of last.values()) {
    const map = closureMapOf(configForDay(versions, arDayISO(r.closedAt))?.data);
    let outcome: ClosureOutcome | null = (r.closureTypeName !== null ? map.get(r.closureTypeName) : undefined) ?? null;
    let ambiguous = false;
    if (!outcome) {
      const seen = new Set(r.labelsSeen.map((l) => map.get(l)).filter((o): o is ClosureOutcome => !!o));
      if (seen.size === 1) outcome = [...seen][0];
      else if (seen.size > 1) ambiguous = true;
    }
    const group = r.assigneeType === "AGENT_BOT" ? out.byBot
      : r.account === null ? out.withoutAccount
      : out.byAccount.get(r.account) ?? out.byAccount.set(r.account, emptyClosures()).get(r.account)!;
    for (const g of [out.total, group]) {
      g.closed++;
      if (outcome) g.byOutcome[outcome]++;
      else if (ambiguous) g.ambiguous++;
      else g.untyped++;
    }
  }
  const t = out.total;
  out.coverage = t.closed > 0 ? (t.closed - t.untyped - t.ambiguous) / t.closed : null;
  return out;
}

/** Informe por cuenta. PURO. `facts` son las conversaciones creadas en el período (attention.ts). */
export function buildAccountsReport(
  input: {
    messages: readonly OperatorMessageRow[]; followups: readonly FollowupBlockRow[]; facts: readonly EntryFact[];
    /** Filas de cierre del historial dentro del período. null u omitido si no se pudieron cargar. */
    closures?: readonly PeriodClosureRow[] | null;
  },
  opts: { now: Date; versions: readonly ConfigVersion[] },
): AccountsReport {
  const pub: DayRanges = publicHours(opts.versions);
  const ops: DayRanges = operatorHours(opts.versions);
  const byKey = new Map<string, Acc>();
  const get = (account: string | null): Acc => {
    const key = account ?? KEY_NULL;
    let a = byKey.get(key);
    if (!a) {
      a = {
        conversations: new Set(), days: new Set(), publicMessages: 0, privateNotes: 0, first: null, last: null,
        inPublic: 0, inOperatorOnly: 0, outside: 0, hoursKnown: true, firstResponses: [], followups: [], byDay: new Map(),
      };
      byKey.set(key, a);
    }
    return a;
  };

  // Configuración vigente al corte: de ahí salen el alias y el estado de cada cuenta.
  const current = configForDay(opts.versions, arDayISO(opts.now));
  const configured = new Map<string, ConfigAccount>((current?.data.accounts ?? []).map((c) => [c.externalId, c]));
  const isSystem = (account: string | null) => {
    const cfg = account ? configured.get(account) : undefined;
    return !!cfg && isSystemAccount(cfg);
  };
  const isSupervision = (account: string | null) => {
    const cfg = account ? configured.get(account) : undefined;
    return !!cfg && isSupervisionAccount(cfg);
  };
  /** Fuera de los totales del equipo: cuentas de sistema y de supervisión. */
  const outsideTeam = (account: string | null) => isSystem(account) || isSupervision(account);

  const dayOf = (a: Acc, day: string) => {
    let d = a.byDay.get(day);
    if (!d) { d = { publicMessages: 0, conversations: new Set(), waits: [] }; a.byDay.set(day, d); }
    return d;
  };
  const accountsByConversation = new Map<string, Set<string>>();
  let teamNotes = 0;

  for (const m of input.messages) {
    const a = get(m.account);
    const day = arDayISO(m.sentAt);
    a.days.add(day);
    if (!a.first || m.sentAt < a.first) a.first = m.sentAt;
    if (!a.last || m.sentAt > a.last) a.last = m.sentAt;
    const system = outsideTeam(m.account);
    if (m.isPrivate) { a.privateNotes++; if (!system) teamNotes++; }
    else {
      a.publicMessages++;
      a.conversations.add(m.conversationId);
      const d = dayOf(a, day);
      d.publicMessages++;
      d.conversations.add(m.conversationId);
      // Actividad por horario, solo de los mensajes a clientes, con el horario vigente ese día.
      if (!configForDay(opts.versions, day)) a.hoursKnown = false;
      else if (isWithinHours(m.sentAt, pub)) a.inPublic++;
      else if (isWithinHours(m.sentAt, ops)) a.inOperatorOnly++;
      else a.outside++;
    }
    if (!m.isPrivate && !system) {
      const set = accountsByConversation.get(m.conversationId) ?? new Set<string>();
      set.add(m.account ?? KEY_NULL);
      accountsByConversation.set(m.conversationId, set);
    }
  }

  const teamFirst: number[] = [];
  const laterDay = new Map<string, number>();
  let teamLaterDay = 0;
  for (const f of input.facts) {
    if (f.clockMinutes === null) continue;
    if (!outsideTeam(f.firstHumanAccount)) teamFirst.push(f.clockMinutes);
    get(f.firstHumanAccount).firstResponses.push(f.clockMinutes);
    if (!f.answeredSameDay) {
      const key = f.firstHumanAccount ?? KEY_NULL;
      laterDay.set(key, (laterDay.get(key) ?? 0) + 1);
      if (!outsideTeam(f.firstHumanAccount)) teamLaterDay++;
    }
  }

  const teamFollowups: number[] = [];
  let followupsUnanswered = 0;
  for (const b of input.followups) {
    if (!b.respondedAt) { followupsUnanswered++; continue; }
    const minutes = Math.max(0, (b.respondedAt.getTime() - b.startedAt.getTime()) / MS_MIN);
    if (!outsideTeam(b.account)) teamFollowups.push(minutes);
    const acc = get(b.account);
    acc.followups.push(minutes);
    dayOf(acc, arDayISO(b.startedAt)).waits.push(minutes);
  }

  // Cuentas con actividad en el período, antes de sumar las que solo aparecen por un cierre.
  const withActivity = new Set(byKey.keys());

  // Cierres del período, por la fila de cierre del historial. La cuenta que cerró aparece
  // aunque no haya escrito en el período.
  const closures = input.closures ? buildPeriodClosures(input.closures, opts.versions) : null;
  if (closures) for (const account of closures.byAccount.keys()) get(account);
  const closuresOf = (account: string | null): AccountClosures | null =>
    !closures ? null : (account !== null ? closures.byAccount.get(account) : undefined) ?? emptyClosures();

  const all: AccountReportRow[] = [...byKey.entries()].map(([key, a]) => {
    const account = key === KEY_NULL ? null : key;
    const cfg = account ? configured.get(account) : undefined;
    return {
      account,
      alias: cfg?.alias ?? null,
      status: !cfg ? "SIN_CONFIGURAR" : cfg.historical || !cfg.active ? "HISTORICA" : "ACTIVA",
      borrowed: cfg?.borrowed ?? false,
      conversations: a.conversations.size,
      closures: closuresOf(account),
      firstResponsesLaterDay: laterDay.get(key) ?? 0,
      daily: [...a.byDay.keys()].sort().map((day) => {
        const d = a.byDay.get(day)!;
        return { day, publicMessages: d.publicMessages, conversations: d.conversations.size, followups: d.waits.length, followupMedian: distribution(d.waits).median };
      }),
      publicMessages: a.publicMessages,
      privateNotes: a.privateNotes,
      firstResponses: distribution(a.firstResponses),
      followups: distribution(a.followups),
      activity: {
        firstMessageAt: a.first,
        lastMessageAt: a.last,
        daysWithActivity: a.days.size,
        inPublicHours: a.hoursKnown ? a.inPublic : null,
        inOperatorHoursOnly: a.hoursKnown ? a.inOperatorOnly : null,
        outsideAllHours: a.hoursKnown ? a.outside : null,
      },
    };
  });
  // Orden estable por número de cuenta: NO por demora ni por volumen (sin ranking).
  all.sort((x, y) => (x.account ?? "￿").localeCompare(y.account ?? "￿", "es", { numeric: true }));

  const accounts = all.filter((a) => !outsideTeam(a.account));
  const systemAccounts = all.filter((a) => isSystem(a.account));
  const supervisionAccounts = all.filter((a) => isSupervision(a.account));

  const seen = new Set([...withActivity].map((k) => (k === KEY_NULL ? null : k)));
  const activeWithoutMessages = [...configured.values()]
    .filter((c) => c.active && !c.historical && !isSystemAccount(c) && !isSupervisionAccount(c) && !seen.has(c.externalId))
    .map((c) => ({ account: c.externalId, alias: c.alias, borrowed: c.borrowed }));

  return {
    generatedAt: opts.now,
    accounts,
    systemAccounts,
    supervisionAccounts,
    team: {
      conversations: accountsByConversation.size,
      conversationsWithSeveralAccounts: [...accountsByConversation.values()].filter((s) => s.size > 1).length,
      firstResponses: distribution(teamFirst),
      followups: distribution(teamFollowups),
      followupsUnanswered,
      privateNotes: teamNotes,
      firstResponsesLaterDay: teamLaterDay,
    },
    closures,
    activeWithoutMessages,
  };
}

/**
 * Cuántos días hacia atrás se buscan conversaciones para los mensajes del período. Los
 * mensajes no tienen índice por fecha: se parte de la conversación. Un cliente que vuelve
 * después de un cierre abre una conversación nueva, así que una conversación recibe
 * mensajes durante pocos días.
 */
export const ACTIVITY_LOOKBACK_DAYS = 30;

export function periodBounds(fromDay: string, toDayInclusive: string) {
  const from = arDayStartUTC(fromDay);
  const to = new Date(arDayStartUTC(toDayInclusive).getTime() + MS_DAY);
  const scopeFrom = new Date(from.getTime() - ACTIVITY_LOOKBACK_DAYS * MS_DAY);
  return { from, to, scopeFrom };
}

/** Mensajes de operador (públicos y notas) enviados entre dos días de Buenos Aires, inclusive. */
export async function loadOperatorMessages(fromDay: string, toDayInclusive: string): Promise<OperatorMessageRow[]> {
  const { from, to, scopeFrom } = periodBounds(fromDay, toDayInclusive);
  return prisma.$queryRaw<OperatorMessageRow[]>(Prisma.sql`
    SELECT m."externalSenderId" AS "account", m."conversationId" AS "conversationId",
           m."sentAt" AS "sentAt", m."isPrivate" AS "isPrivate"
    FROM "ConversationMessage" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE (c.status <> 'RESUELTA' OR c."createdAt" >= ${utcTimestampParam(scopeFrom)}::timestamp)
      AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
      AND m.author = 'OPERATOR'
      AND m."sentAt" >= ${utcTimestampParam(from)}::timestamp
      AND m."sentAt" < ${utcTimestampParam(to)}::timestamp
  `);
}

/**
 * Filas RESUELTA del historial con fecha dentro del período, sin las correcciones de estado
 * contra Emozion (no son cierres). Solo lectura: fecha, tipo de cierre, etiquetas y asignado.
 */
export async function loadPeriodClosures(fromDay: string, toDayInclusive: string): Promise<PeriodClosureRow[]> {
  const { from, to } = periodBounds(fromDay, toDayInclusive);
  const rows = await prisma.conversationStateHistory.findMany({
    where: { toStatus: "RESUELTA", changedAt: { gte: from, lt: to }, NOT: { note: { startsWith: SYNC_NOTE_PREFIX } } },
    select: { conversationId: true, changedAt: true, closureTypeName: true, externalLabelsSeen: true, externalAssigneeId: true, externalAssigneeType: true },
  });
  return rows.map((r) => ({
    conversationId: r.conversationId, closedAt: r.changedAt, closureTypeName: r.closureTypeName,
    labelsSeen: r.externalLabelsSeen, account: r.externalAssigneeId, assigneeType: r.externalAssigneeType,
  }));
}

/**
 * Bloques del cliente posteriores a una respuesta de operador que EMPEZARON en el período.
 * Solo mensajes públicos de cliente y operador (ni bot ni notas internas).
 */
export async function loadFollowupBlocks(fromDay: string, toDayInclusive: string): Promise<FollowupBlockRow[]> {
  const { from, to, scopeFrom } = periodBounds(fromDay, toDayInclusive);
  return prisma.$queryRaw<FollowupBlockRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id FROM "Conversation" c
      WHERE (c.status <> 'RESUELTA' OR c."createdAt" >= ${utcTimestampParam(scopeFrom)}::timestamp)
        AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
    ), m AS (
      SELECT cm."conversationId" AS cid, cm.author, cm."sentAt",
        lag(cm.author) OVER w AS prev_author,
        min(cm."sentAt") FILTER (WHERE cm.author = 'OPERATOR')
          OVER (PARTITION BY cm."conversationId" ORDER BY cm."sentAt", cm.id
                ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS next_op
      FROM "ConversationMessage" cm
      JOIN scope s ON s.id = cm."conversationId"
      WHERE cm.author IN ('CUSTOMER', 'OPERATOR') AND NOT cm."isPrivate"
      WINDOW w AS (PARTITION BY cm."conversationId" ORDER BY cm."sentAt", cm.id)
    )
    SELECT m.cid AS "conversationId", m."sentAt" AS "startedAt", m.next_op AS "respondedAt",
      (SELECT o."externalSenderId" FROM "ConversationMessage" o
        WHERE o."conversationId" = m.cid AND o.author = 'OPERATOR' AND NOT o."isPrivate" AND o."sentAt" = m.next_op
        ORDER BY o.id LIMIT 1) AS "account"
    FROM m
    WHERE m.author = 'CUSTOMER' AND m.prev_author = 'OPERATOR'
      AND m."sentAt" >= ${utcTimestampParam(from)}::timestamp
      AND m."sentAt" < ${utcTimestampParam(to)}::timestamp
  `);
}
