/**
 * Tipos de la respuesta del bloque "Ahora" y su intervalo de refresco. Archivo aparte, sin
 * imports de servidor, para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { QueueGroupCounts } from "./queue-types";

/** Segundos de caché del bloque en el servidor y de refresco en la pantalla. */
export const NOW_CACHE_SECONDS = 60;

export interface NowListItem {
  conversationId: string;
  open: boolean;
  /** ISO. Desde cuándo espera: primer mensaje del cliente del bloque sin responder. */
  waitStart: string;
  waitMinutes: number;
  hasHumanResponse: boolean;
  botOrderComplete: boolean;
  thanksCandidate: boolean;
  noBotExit: boolean;
}

export interface NowGroup extends Omit<QueueGroupCounts, "oldestWaitStart"> {
  oldestWaitStart: string | null;
}

export interface NowPayload {
  generatedAt: string;
  /** Evidencia de actualización. null si no hay ningún evento o mensaje. */
  freshness: { lastWebhookAt: string | null; lastMessageAt: string | null };
  openWaiting: NowGroup;
  closedUnanswered: NowGroup;
  /** Desde qué fecha de creación se cuentan las cerradas en closedUnanswered. */
  closedSince: string;
  /** Cerradas sin respuesta anteriores a esa fecha. null si no se pudo calcular. */
  closedBefore: { total: number; neverHuman: number; awaitingNext: number; completedOrders: number } | null;
  /** Abiertas esperando hace más de la ventana de la lista. */
  openOlderThanListWindow: number;
  /** Pedidos completos en el bot sin respuesta de una persona: abiertas + cerradas de la ventana. */
  completedOrdersWaiting: number;
  list: NowListItem[];
  /** Horas de la ventana de la lista para las cerradas (las abiertas van todas). */
  listWindowHours: number;
  /** Filas que cumplen el filtro de la lista, antes del tope. */
  listTotal: number;
}
