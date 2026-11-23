/**
 * Evolución de la cola: cuántas conversaciones estaban pendientes en distintos momentos del
 * turno, y qué pasó en los últimos 60 minutos.
 *
 * "Pendiente a una hora dada" usa SIEMPRE la misma regla: la conversación estaba abierta, su
 * último mensaje público (entre cliente y operador) era del cliente y esperaba hace hasta
 * `windowHours` horas. Es la regla de los pendientes recientes de "Ahora" y de "pendientes al
 * empezar el turno". No incluye los posibles pendientes antiguos, que dependen de una
 * clasificación por palabras que no se reconstruye hacia atrás.
 *
 * La variación sale de comparar ese número en dos momentos, no de restar entradas menos
 * respuestas: en el medio hay reaperturas, cierres y clientes que vuelven a escribir.
 *
 * Una sola consulta trae las horas de los mensajes y de los cambios de estado; los puntos se
 * calculan en memoria (buildQueueTrend, PURO) y se guardan TREND_CACHE_SECONDS. Las filas
 * llevan solo horas y estados: ni ids, ni teléfono, ni nombre, ni texto.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestampParam } from "./business-time";
import { QUEUE_LIST_DEFAULT_HOURS } from "./patterns";
import type { NowTrend } from "./now-types";

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
const SCOPE_DAYS = 30;

/** Segundos de caché de la evolución de la cola: solo alimenta el gráfico. */
export const TREND_CACHE_SECONDS = 300;
/** Minutos entre un punto y el siguiente. */
export const TREND_STEP_MINUTES = 30;

/** Una conversación con actividad reciente. Las horas van en milisegundos y ordenadas de menor a mayor. */
export interface TrendRow {
  /** Mensajes del cliente. */
  customer: readonly number[];
  /** Mensajes públicos de operador. */
  operator: readonly number[];
  /** Cambios de estado: hora y estado al que pasó, en el mismo orden. */
  statusAt: readonly number[];
  statusTo: readonly string[];
}

/** Último valor menor o igual a `t`; -Infinity si no hay. `xs` ordenado. */
function lastAtOrBefore(xs: readonly number[], t: number): number {
  let out = -Infinity;
  for (const x of xs) { if (x > t) break; out = x; }
  return out;
}

/** ¿Estaba pendiente a la hora `t`? PURO. */
export function pendingAt(row: TrendRow, t: number, windowHours: number = QUEUE_LIST_DEFAULT_HOURS): boolean {
  const lastCustomer = lastAtOrBefore(row.customer, t);
  if (lastCustomer === -Infinity) return false;
  const lastOperator = lastAtOrBefore(row.operator, t);
  if (lastOperator >= lastCustomer) return false;
  // Estado a esa hora: el del último cambio anterior. Sin ninguno, la conversación todavía no existía.
  let status: string | null = null;
  for (let i = 0; i < row.statusAt.length && row.statusAt[i] <= t; i++) status = row.statusTo[i];
  if (status === null || status === "RESUELTA") return false;
  // Espera desde el primer mensaje del cliente posterior a la última respuesta.
  const waitStart = row.customer.find((x) => x > lastOperator)!;
  return t - waitStart <= windowHours * MS_HOUR;
}

/**
 * Arma la evolución. PURO. Un punto cada `stepMinutes` desde `from` y uno final en `now`.
 * `newConversations` (creadas en los últimos 60 minutos) se cuenta aparte porque una
 * conversación nueva puede no tener todavía mensajes de cliente ni de operador.
 */
export function buildQueueTrend(
  rows: readonly TrendRow[],
  opts: { now: Date; from: Date; fromIsShift: boolean; newConversations: number; stepMinutes?: number; windowHours?: number },
): NowTrend {
  const now = opts.now.getTime();
  const step = (opts.stepMinutes ?? TREND_STEP_MINUTES) * MS_MIN;
  const windowHours = opts.windowHours ?? QUEUE_LIST_DEFAULT_HOURS;
  const count = (t: number) => rows.reduce((n, r) => n + (pendingAt(r, t, windowHours) ? 1 : 0), 0);
  const times: number[] = [];
  for (let t = opts.from.getTime(); t < now; t += step) times.push(t);
  times.push(now);
  const hourAgo = now - MS_HOUR;
  return {
    generatedAt: opts.now.toISOString(),
    from: opts.from.toISOString(),
    fromIsShift: opts.fromIsShift,
    stepMinutes: opts.stepMinutes ?? TREND_STEP_MINUTES,
    points: times.map((t) => ({ at: new Date(t).toISOString(), pending: count(t) })),
    lastHour: {
      newConversations: opts.newConversations,
      answered: rows.filter((r) => r.operator.some((x) => x > hourAgo && x <= now)).length,
      pendingBefore: count(hourAgo),
      pendingNow: count(now),
    },
  };
}

interface RawTrendRow { customer: number[] | null; operator: number[] | null; statusAt: number[] | null; statusTo: string[] | null }

/**
 * Horas de los mensajes y de los cambios de estado de las conversaciones que tuvieron algún
 * mensaje de cliente u operador desde `activeSince`. Solo lectura. Los mensajes no tienen
 * índice por fecha: se parte de las conversaciones abiertas y de las creadas en los últimos
 * SCOPE_DAYS días.
 */
export async function loadTrendRows(activeSince: Date, now: Date): Promise<TrendRow[]> {
  const scopeFrom = utcTimestampParam(new Date(now.getTime() - SCOPE_DAYS * MS_DAY));
  const raw = await prisma.$queryRaw<RawTrendRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id FROM "Conversation" c
      WHERE c.status <> 'RESUELTA' OR c."createdAt" >= ${scopeFrom}::timestamp
    ), msgs AS (
      SELECT m."conversationId" AS cid,
        array_agg((extract(epoch FROM m."sentAt") * 1000)::float8 ORDER BY m."sentAt") FILTER (WHERE m.author = 'CUSTOMER') AS customer,
        array_agg((extract(epoch FROM m."sentAt") * 1000)::float8 ORDER BY m."sentAt") FILTER (WHERE m.author = 'OPERATOR') AS operator
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      WHERE m.author = 'CUSTOMER' OR (m.author = 'OPERATOR' AND NOT m."isPrivate")
      GROUP BY 1
      HAVING max(m."sentAt") >= ${utcTimestampParam(activeSince)}::timestamp
    )
    SELECT g.customer AS "customer", g.operator AS "operator",
      (SELECT array_agg((extract(epoch FROM h."changedAt") * 1000)::float8 ORDER BY h."changedAt", h.id)
        FROM "ConversationStateHistory" h WHERE h."conversationId" = g.cid) AS "statusAt",
      (SELECT array_agg(h."toStatus"::text ORDER BY h."changedAt", h.id)
        FROM "ConversationStateHistory" h WHERE h."conversationId" = g.cid) AS "statusTo"
    FROM msgs g
  `);
  return raw.map((r) => ({
    customer: (r.customer ?? []).map(Number), operator: (r.operator ?? []).map(Number),
    statusAt: (r.statusAt ?? []).map(Number), statusTo: r.statusTo ?? [],
  }));
}

let cache: { at: number; from: number; value: NowTrend } | null = null;

/**
 * La evolución de la cola desde `from` (inicio del turno de operadores o comienzo del día),
 * con caché de TREND_CACHE_SECONDS por instancia.
 */
export async function getQueueTrend(now: Date, from: Date, fromIsShift: boolean): Promise<NowTrend> {
  if (cache && cache.from === from.getTime() && now.getTime() - cache.at < TREND_CACHE_SECONDS * 1000) return cache.value;
  // Para decidir si algo estaba pendiente en el primer punto hace falta ver hasta `windowHours` antes.
  const first = Math.min(from.getTime(), now.getTime() - MS_HOUR);
  const activeSince = new Date(first - QUEUE_LIST_DEFAULT_HOURS * MS_HOUR);
  const [rows, newConversations] = await Promise.all([
    loadTrendRows(activeSince, now),
    prisma.conversation.count({ where: { createdAt: { gte: new Date(now.getTime() - MS_HOUR) } } }),
  ]);
  const value = buildQueueTrend(rows, { now, from, fromIsShift, newConversations });
  cache = { at: now.getTime(), from: from.getTime(), value };
  return value;
}
