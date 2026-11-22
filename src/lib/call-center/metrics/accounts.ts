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
 *  - actividad observada: primer y último mensaje y mensajes dentro del horario público,
 *    solo dentro del de operadores y fuera de ambos. Es actividad, no jornada.
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
import { arDayISO, arDayStartUTC, isWithinHours, utcTimestampParam, type DayRanges } from "./business-time";
import { configForDay, type ConfigVersion } from "./config";
import { isSystemAccount, type ConfigAccount } from "./config-schema";
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
  publicMessages: number;
  privateNotes: number;
  /** Demora de reloj de los casos que tomó, desde la salida del bot. Es demora de la cola. */
  firstResponses: Distribution;
  followups: Distribution;
  activity: {
    firstMessageAt: Date | null;
    lastMessageAt: Date | null;
    daysWithActivity: number;
    /** null si no hay horario configurado. */
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
  team: {
    /** Cada conversación una sola vez, aunque hayan participado varias cuentas. */
    conversations: number;
    conversationsWithSeveralAccounts: number;
    firstResponses: Distribution;
    followups: Distribution;
    /** Bloques del cliente que quedaron sin respuesta. */
    followupsUnanswered: number;
    privateNotes: number;
  };
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
}

const KEY_NULL = "\u0000sin-remitente";

/** Informe por cuenta. PURO. `facts` son las conversaciones creadas en el período (attention.ts). */
export function buildAccountsReport(
  input: { messages: readonly OperatorMessageRow[]; followups: readonly FollowupBlockRow[]; facts: readonly EntryFact[] },
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
        inPublic: 0, inOperatorOnly: 0, outside: 0, hoursKnown: true, firstResponses: [], followups: [],
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

  const accountsByConversation = new Map<string, Set<string>>();
  let teamNotes = 0;

  for (const m of input.messages) {
    const a = get(m.account);
    const day = arDayISO(m.sentAt);
    a.days.add(day);
    if (!a.first || m.sentAt < a.first) a.first = m.sentAt;
    if (!a.last || m.sentAt > a.last) a.last = m.sentAt;
    const system = isSystem(m.account);
    if (m.isPrivate) { a.privateNotes++; if (!system) teamNotes++; }
    else {
      a.publicMessages++;
      a.conversations.add(m.conversationId);
    }
    if (!m.isPrivate && !system) {
      const set = accountsByConversation.get(m.conversationId) ?? new Set<string>();
      set.add(m.account ?? KEY_NULL);
      accountsByConversation.set(m.conversationId, set);
    }
    // Actividad por horario: con el horario vigente el día del mensaje.
    if (!configForDay(opts.versions, day)) a.hoursKnown = false;
    else if (isWithinHours(m.sentAt, pub)) a.inPublic++;
    else if (isWithinHours(m.sentAt, ops)) a.inOperatorOnly++;
    else a.outside++;
  }

  const teamFirst: number[] = [];
  for (const f of input.facts) {
    if (f.clockMinutes === null) continue;
    if (!isSystem(f.firstHumanAccount)) teamFirst.push(f.clockMinutes);
    get(f.firstHumanAccount).firstResponses.push(f.clockMinutes);
  }

  const teamFollowups: number[] = [];
  let followupsUnanswered = 0;
  for (const b of input.followups) {
    if (!b.respondedAt) { followupsUnanswered++; continue; }
    const minutes = Math.max(0, (b.respondedAt.getTime() - b.startedAt.getTime()) / MS_MIN);
    if (!isSystem(b.account)) teamFollowups.push(minutes);
    get(b.account).followups.push(minutes);
  }

  const all: AccountReportRow[] = [...byKey.entries()].map(([key, a]) => {
    const account = key === KEY_NULL ? null : key;
    const cfg = account ? configured.get(account) : undefined;
    return {
      account,
      alias: cfg?.alias ?? null,
      status: !cfg ? "SIN_CONFIGURAR" : cfg.historical || !cfg.active ? "HISTORICA" : "ACTIVA",
      borrowed: cfg?.borrowed ?? false,
      conversations: a.conversations.size,
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

  const accounts = all.filter((a) => !isSystem(a.account));
  const systemAccounts = all.filter((a) => isSystem(a.account));

  const seen = new Set(all.map((a) => a.account));
  const activeWithoutMessages = [...configured.values()]
    .filter((c) => c.active && !c.historical && !isSystemAccount(c) && !seen.has(c.externalId))
    .map((c) => ({ account: c.externalId, alias: c.alias, borrowed: c.borrowed }));

  return {
    generatedAt: opts.now,
    accounts,
    systemAccounts,
    team: {
      conversations: accountsByConversation.size,
      conversationsWithSeveralAccounts: [...accountsByConversation.values()].filter((s) => s.size > 1).length,
      firstResponses: distribution(teamFirst),
      followups: distribution(teamFollowups),
      followupsUnanswered,
      privateNotes: teamNotes,
    },
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
