/**
 * Bloque "Ahora" de las métricas: lo que la pantalla y la API entregan.
 *
 * toNowPayload es PURO: arma la respuesta a partir de la cola ya calculada. getNowPayload
 * la calcula con una caché en memoria de 60 segundos por instancia, para que el refresco
 * automático de varias pantallas abiertas no repita la consulta. El histórico de cerradas
 * sin respuesta anterior a la ventana recorre todos los mensajes: se guarda una hora.
 *
 * La lista lleva solo el id interno de la conversación (para el enlace), horas y marcas.
 * Nunca teléfono, nombre ni texto del cliente.
 */
import { prisma } from "@/lib/prisma";
import {
  getQueueSnapshot, countClosedUnansweredBefore, itemsForList,
  type ClosedUnansweredHistory, type QueueGroupCounts, type QueueSnapshot,
} from "./queue";
import { QUEUE_LIST_DEFAULT_HOURS } from "./patterns";
import { NOW_CACHE_SECONDS, type NowGroup, type NowPayload } from "./now-types";

export { NOW_CACHE_SECONDS } from "./now-types";
export type { NowGroup, NowListItem, NowPayload } from "./now-types";

/** Tope de filas de la lista. Los conteos no se recortan. */
export const NOW_LIST_MAX_ROWS = 200;
const HISTORY_CACHE_SECONDS = 3600;

const group = (g: QueueGroupCounts): NowGroup => ({ ...g, oldestWaitStart: g.oldestWaitStart ? g.oldestWaitStart.toISOString() : null });

/** Arma la respuesta. PURO. */
export function toNowPayload(
  snapshot: QueueSnapshot,
  history: ClosedUnansweredHistory | null,
  freshness: { lastWebhookAt: Date | null; lastMessageAt: Date | null },
  listWindowHours: number = QUEUE_LIST_DEFAULT_HOURS,
  maxRows: number = NOW_LIST_MAX_ROWS,
): NowPayload {
  const listed = itemsForList(snapshot, listWindowHours);
  return {
    generatedAt: snapshot.generatedAt.toISOString(),
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
    openOlderThanListWindow: snapshot.openOlderThanListWindow,
    completedOrdersWaiting: snapshot.openWaiting.completedOrders + snapshot.closedUnanswered.completedOrders,
    // itemsForList ya viene de la espera más vieja a la más nueva: el tope deja las más viejas.
    list: listed.slice(0, maxRows).map((it) => ({
      conversationId: it.conversationId,
      open: it.open,
      waitStart: it.waitStart.toISOString(),
      waitMinutes: Math.round(it.waitHours * 60),
      hasHumanResponse: it.hasHumanResponse,
      botOrderComplete: it.botOrderComplete,
      thanksCandidate: it.thanksCandidate,
      noBotExit: it.botExitAt === null,
    })),
    listWindowHours,
    listTotal: listed.length,
  };
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

  const [snapshot, freshness] = await Promise.all([getQueueSnapshot(now), loadFreshness()]);

  // Histórico: se recalcula como mucho una vez por hora. Si falla, la pantalla lo muestra como
  // no disponible en lugar de caerse entera.
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

  const payload = toNowPayload(snapshot, history, freshness);
  nowCache = { at: now.getTime(), payload };
  return payload;
}
