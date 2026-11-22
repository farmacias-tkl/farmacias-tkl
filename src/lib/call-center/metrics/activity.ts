/**
 * Indicadores POR ACTIVIDAD del bloque "Atención y demoras": responden a lo que pasó cada
 * día, sin importar cuándo se creó la conversación. Son otra población que los indicadores
 * "por entrada" (attention.ts), que siguen a las conversaciones creadas en el período: los
 * números de una y otra no se suman ni se comparan entre sí.
 *
 *  - Conversaciones con actividad del cliente: al menos un mensaje del cliente en el día.
 *  - Conversaciones atendidas: al menos un mensaje público de operador en el día.
 *  - Respuestas posteriores: bloques de mensajes seguidos del cliente posteriores a una
 *    respuesta de operador, que EMPEZARON en el día; del primer mensaje del bloque al
 *    siguiente mensaje público de operador. Los bloques sin respuesta van aparte.
 *
 * Una conversación cuenta en cada día en que tuvo actividad: los días no se suman. Para el
 * período se informa aparte la cantidad de conversaciones distintas.
 *
 * buildActivityReport es PURO. loadDailyActivityRows es de solo lectura y no trae teléfono,
 * nombre ni texto.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AR_UTC_OFFSET_MINUTES, arDayISO, utcTimestampParam } from "./business-time";
import { distribution, type Distribution } from "./attention";
import { ACTIVITY_LOOKBACK_DAYS, loadFollowupBlocks, periodBounds, type FollowupBlockRow } from "./accounts";

const MS_MIN = 60_000;

/** Una conversación con actividad pública en un día de Buenos Aires. */
export interface DailyActivityRow {
  day: string;
  conversationId: string;
  /** Al menos un mensaje del cliente ese día. */
  customer: boolean;
  /** Al menos un mensaje público de operador ese día. */
  operator: boolean;
}

export interface FollowupSummary {
  /** Bloques del cliente que empezaron en el día o período. */
  blocks: number;
  answered: number;
  unanswered: number;
  /** Minutos de reloj hasta la respuesta, SOLO entre los bloques respondidos. */
  response: Distribution;
}

export interface ActivityDay {
  day: string;
  activeCustomer: number;
  attended: number;
  followups: FollowupSummary;
}

export interface ActivityReport {
  /** Conversaciones DISTINTAS del período: no es la suma de los días. */
  period: { activeCustomer: number; attended: number };
  followups: FollowupSummary;
  days: ActivityDay[];
  /** Las conversaciones resueltas creadas más de estos días antes del período no se recorren. */
  lookbackDays: number;
}

function summarizeFollowups(blocks: readonly FollowupBlockRow[]): FollowupSummary {
  const minutes: number[] = [];
  for (const b of blocks) {
    if (b.respondedAt) minutes.push(Math.max(0, (b.respondedAt.getTime() - b.startedAt.getTime()) / MS_MIN));
  }
  return { blocks: blocks.length, answered: minutes.length, unanswered: blocks.length - minutes.length, response: distribution(minutes) };
}

/** Informe por actividad. PURO. */
export function buildActivityReport(rows: readonly DailyActivityRow[], followups: readonly FollowupBlockRow[]): ActivityReport {
  const customerAll = new Set<string>();
  const operatorAll = new Set<string>();
  const perDay = new Map<string, { customer: number; operator: number; blocks: FollowupBlockRow[] }>();
  const dayOf = (day: string) => {
    let d = perDay.get(day);
    if (!d) { d = { customer: 0, operator: 0, blocks: [] }; perDay.set(day, d); }
    return d;
  };

  for (const r of rows) {
    const d = dayOf(r.day);
    if (r.customer) { d.customer++; customerAll.add(r.conversationId); }
    if (r.operator) { d.operator++; operatorAll.add(r.conversationId); }
  }
  for (const b of followups) dayOf(arDayISO(b.startedAt)).blocks.push(b);

  return {
    period: { activeCustomer: customerAll.size, attended: operatorAll.size },
    followups: summarizeFollowups(followups),
    days: [...perDay.keys()].sort().map((day) => {
      const d = perDay.get(day)!;
      return { day, activeCustomer: d.customer, attended: d.operator, followups: summarizeFollowups(d.blocks) };
    }),
    lookbackDays: ACTIVITY_LOOKBACK_DAYS,
  };
}

/**
 * Conversaciones con mensajes públicos de cliente u operador entre dos días de Buenos Aires,
 * inclusive: una fila por día y conversación. Solo lectura.
 */
export async function loadDailyActivityRows(fromDay: string, toDayInclusive: string): Promise<DailyActivityRow[]> {
  const { from, to, scopeFrom } = periodBounds(fromDay, toDayInclusive);
  const offset = `${AR_UTC_OFFSET_MINUTES} minutes`;
  return prisma.$queryRaw<DailyActivityRow[]>(Prisma.sql`
    SELECT to_char(m."sentAt" + ${offset}::interval, 'YYYY-MM-DD') AS "day",
           m."conversationId" AS "conversationId",
           bool_or(m.author = 'CUSTOMER') AS "customer",
           bool_or(m.author = 'OPERATOR') AS "operator"
    FROM "ConversationMessage" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE (c.status <> 'RESUELTA' OR c."createdAt" >= ${utcTimestampParam(scopeFrom)}::timestamp)
      AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
      AND (m.author = 'CUSTOMER' OR (m.author = 'OPERATOR' AND NOT m."isPrivate"))
      AND m."sentAt" >= ${utcTimestampParam(from)}::timestamp
      AND m."sentAt" < ${utcTimestampParam(to)}::timestamp
    GROUP BY 1, 2
  `);
}

/** Informe por actividad de un período. */
export async function loadActivityReport(fromDay: string, toDayInclusive: string): Promise<ActivityReport> {
  const [rows, followups] = await Promise.all([
    loadDailyActivityRows(fromDay, toDayInclusive),
    loadFollowupBlocks(fromDay, toDayInclusive),
  ]);
  return buildActivityReport(rows, followups);
}
