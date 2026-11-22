/**
 * Bloque "Ahora" y pestaña "Calidad de datos" de las métricas: lo que las pantallas y la API entregan.
 *
 * toNowPayload es PURO: arma la respuesta a partir de la cola ya calculada. getNowPayload
 * la calcula con una caché en memoria de 60 segundos por instancia, para que el refresco
 * automático de varias pantallas abiertas no repita la consulta. El histórico de cerradas
 * sin respuesta anterior a la ventana recorre todos los mensajes: se guarda una hora.
 *
 * Las listas llevan solo el id interno de la conversación (para el enlace), horas y marcas.
 * Nunca teléfono, nombre ni texto del cliente.
 */
import { prisma } from "@/lib/prisma";
import {
  getQueueSnapshot, countClosedUnansweredBefore,
  type ClosedUnansweredHistory, type QueueGroupCounts, type QueueSnapshot,
} from "./queue";
import { CLOSED_UNANSWERED_DAYS, QUEUE_LIST_DEFAULT_HOURS } from "./patterns";
import { arDayISO, arDayStartUTC, utcTimestampParam } from "./business-time";
import { getClosedUnanswered } from "./closed-unanswered";
import { configForDay, loadConfigVersions, type ConfigVersion } from "./config";
import { criticalWaitMinutesOf, isSystemAccount, type ConfigAccount } from "./config-schema";
import { operatorHours, publicHours } from "./schedule";
import { classifyWait, scheduleState, type WaitContext } from "./wait-level";
import { NOW_CACHE_SECONDS, type ClosedUnansweredReport, type NowGroup, type NowOwner, type NowPayload } from "./now-types";

export { NOW_CACHE_SECONDS } from "./now-types";
export type { NowGroup, NowListItem, NowPayload } from "./now-types";

/** Tope de filas de cada lista. Los conteos no se recortan. */
export const NOW_LIST_MAX_ROWS = 200;
const HISTORY_CACHE_SECONDS = 3600;

const group = (g: QueueGroupCounts): NowGroup => ({ ...g, oldestWaitStart: g.oldestWaitStart ? g.oldestWaitStart.toISOString() : null });

/** Lo que se calcula aparte de la cola. null = no se pudo calcular. */
export interface NowExtras {
  history: ClosedUnansweredHistory | null;
  today: { entered: number; answered: number } | null;
  closed: ClosedUnansweredReport | null;
  /** Horario y umbrales del semáforo. null si no hay configuración vigente hoy. */
  wait: WaitContext | null;
  /** Cuentas de la configuración vigente hoy; vacío si no hay. */
  accounts: readonly ConfigAccount[];
}

/** Responsable de un caso. PURO. */
export function ownerOf(assignee: string | null, accounts: readonly ConfigAccount[]): NowOwner {
  const cfg = assignee ? accounts.find((a) => a.externalId === assignee) : undefined;
  if (!cfg) return { kind: "UNKNOWN" };
  if (isSystemAccount(cfg)) return { kind: "SYSTEM" };
  return { kind: "ACCOUNT", label: cfg.alias ?? `cuenta ${cfg.externalId}` };
}

/** Horario y umbrales con la configuración vigente al momento `now`. PURO. */
export function waitContext(versions: readonly ConfigVersion[], now: Date): WaitContext | null {
  const current = configForDay(versions, arDayISO(now));
  if (!current) return null;
  return {
    pub: publicHours(versions),
    ops: operatorHours(versions),
    goalMinutes: current.data.firstResponseGoalMinutes,
    criticalMinutes: criticalWaitMinutesOf(current.data),
  };
}

/**
 * Arma la respuesta. PURO. Reagrupa la cola ya calculada: los clientes esperando son las
 * abiertas con hasta `windowHours` de espera; las abiertas más viejas van aparte.
 */
export function toNowPayload(
  snapshot: QueueSnapshot,
  extras: NowExtras,
  freshness: { lastWebhookAt: Date | null; lastMessageAt: Date | null },
  windowHours: number = QUEUE_LIST_DEFAULT_HOURS,
  maxRows: number = NOW_LIST_MAX_ROWS,
): NowPayload {
  // snapshot.items viene de la espera más vieja a la más nueva.
  const open = snapshot.items.filter((it) => it.open);
  const waiting = open.filter((it) => it.waitHours <= windowHours);
  const stale = open.filter((it) => it.waitHours > windowHours);
  const neverHuman = waiting.filter((it) => !it.hasHumanResponse);
  const { history, today, closed, wait, accounts } = extras;
  const now = snapshot.generatedAt;
  // El semáforo se calcula para todos los que esperan, no solo para los que entran en la lista.
  const items = waiting.map((it) => ({
    conversationId: it.conversationId,
    status: it.status,
    owner: ownerOf(it.externalAssigneeId, accounts),
    createdAt: it.createdAt.toISOString(),
    waitStart: it.waitStart.toISOString(),
    waitMinutes: Math.round(it.waitHours * 60),
    ...(wait ? classifyWait(it, now, wait) : { level: null, businessMinutes: null }),
    hasHumanResponse: it.hasHumanResponse,
    botOrderComplete: it.botOrderComplete,
    thanksCandidate: it.thanksCandidate,
  }));

  return {
    generatedAt: snapshot.generatedAt.toISOString(),
    windowHours,
    schedule: wait ? { ...scheduleState(now, wait), goalMinutes: wait.goalMinutes, criticalMinutes: wait.criticalMinutes } : null,
    waiting: {
      total: waiting.length,
      neverHuman: neverHuman.length,
      awaitingNext: waiting.length - neverHuman.length,
      completedOrders: neverHuman.filter((it) => it.botOrderComplete).length,
      critical: wait ? items.filter((it) => it.level === "CRITICO").length : null,
      oldestWaitStart: waiting.length ? waiting[0].waitStart.toISOString() : null,
    },
    today,
    list: items.slice(0, maxRows),
    listTotal: waiting.length,
    stale: {
      total: stale.length,
      oldestWaitStart: stale.length ? stale[0].waitStart.toISOString() : null,
      items: stale.slice(0, maxRows).map((it) => ({ conversationId: it.conversationId, waitStart: it.waitStart.toISOString() })),
    },
    closedUnanswered: closed
      ? { days: closed.days, total: closed.total, question: closed.question, order: closed.order, attachment: closed.attachment, items: closed.items.slice(0, maxRows) }
      : null,
    quality: {
      freshness: {
        lastWebhookAt: freshness.lastWebhookAt ? freshness.lastWebhookAt.toISOString() : null,
        lastMessageAt: freshness.lastMessageAt ? freshness.lastMessageAt.toISOString() : null,
      },
      openWaiting: group(snapshot.openWaiting),
      closedUnanswered: group(snapshot.closedUnanswered),
      closedSince: snapshot.closedSince.toISOString(),
      closedBefore: history
        ? { total: history.total, neverHuman: history.neverHuman, awaitingNext: history.awaitingNext, completedOrders: history.completedOrders }
        : null,
      notCustomers: closed ? closed.notCustomers : null,
      notCustomersDays: closed ? closed.days : CLOSED_UNANSWERED_DAYS,
    },
  };
}

/**
 * Conversaciones creadas hoy (día de Buenos Aires) y, de esas, las que ya tienen al menos
 * una respuesta pública de un operador. Es una sola población. Solo lectura.
 */
export async function loadToday(now: Date): Promise<{ entered: number; answered: number }> {
  const from = arDayStartUTC(arDayISO(now));
  const rows = await prisma.$queryRaw<Array<{ entered: number; answered: number }>>`
    SELECT count(*)::int AS "entered",
      (count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "ConversationMessage" m
        WHERE m."conversationId" = c.id AND m.author = 'OPERATOR' AND NOT m."isPrivate")))::int AS "answered"
    FROM "Conversation" c
    WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp
  `;
  return rows[0] ?? { entered: 0, answered: 0 };
}

async function loadFreshness(): Promise<{ lastWebhookAt: Date | null; lastMessageAt: Date | null }> {
  const [webhook, message] = await Promise.all([
    prisma.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    // Los mensajes no tienen índice por fecha: se busca entre los de las conversaciones tocadas hace poco.
    prisma.$queryRaw<Array<{ last: Date | null }>>`
      SELECT max(m."sentAt") AS last
      FROM "ConversationMessage" m
      WHERE m."conversationId" IN (SELECT c.id FROM "Conversation" c ORDER BY c."updatedAt" DESC LIMIT 200)
    `,
  ]);
  return { lastWebhookAt: webhook?.receivedAt ?? null, lastMessageAt: message[0]?.last ?? null };
}

let nowCache: { at: number; payload: NowPayload } | null = null;
let historyCache: { at: number; before: number; value: ClosedUnansweredHistory } | null = null;

/** El bloque "Ahora", con caché de NOW_CACHE_SECONDS por instancia. */
export async function getNowPayload(now: Date = new Date()): Promise<NowPayload> {
  if (nowCache && now.getTime() - nowCache.at < NOW_CACHE_SECONDS * 1000) return nowCache.payload;

  const [snapshot, freshness, today, versions] = await Promise.all([
    getQueueSnapshot(now), loadFreshness(), loadToday(now).catch(() => null),
    loadConfigVersions().then((r) => r.versions).catch(() => [] as ConfigVersion[]),
  ]);
  const wait = waitContext(versions, now);
  const accounts = configForDay(versions, arDayISO(now))?.data.accounts ?? [];

  // Si una parte falla, la pantalla la muestra como no disponible en lugar de caerse entera.
  const closed = await getClosedUnanswered(now, snapshot.closedSince).catch(() => null);

  // Histórico: se recalcula como mucho una vez por hora.
  let history: ClosedUnansweredHistory | null = null;
  if (historyCache && now.getTime() - historyCache.at < HISTORY_CACHE_SECONDS * 1000) {
    history = historyCache.value;
  } else {
    try {
      history = await countClosedUnansweredBefore(snapshot.closedSince);
      historyCache = { at: now.getTime(), before: snapshot.closedSince.getTime(), value: history };
    } catch {
      history = null;
    }
  }

  const payload = toNowPayload(snapshot, { history, today, closed, wait, accounts }, freshness);
  nowCache = { at: now.getTime(), payload };
  return payload;
}
