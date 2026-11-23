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
import { getClosedUnanswered, isProbablyClosed, loadOpenBlockRows, type ClosedBlockRow } from "./closed-unanswered";
import { loadDailyActivityRows } from "./activity";
import { configForDay, loadConfigVersions, type ConfigVersion } from "./config";
import { DEFAULT_LAST_RESPONSE_WARNING_MINUTES, DEFAULT_WINDOW_WARNING_HOURS, criticalWaitMinutesOf, lastResponseWarningMinutesOf, windowWarningHoursOf, type ConfigAccount } from "./config-schema";
import { WHATSAPP_WINDOW_HOURS, windowState } from "./whatsapp-window";
import { operatorHours, publicHours } from "./schedule";
import { classifyWait, scheduleState, type WaitContext } from "./wait-level";
import {
  NOW_CACHE_SECONDS, type ClosedUnansweredReport, type NowGroup, type NowOwner, type NowPayload, type NowProgress, type QualityChecks,
} from "./now-types";
import { loadProgress } from "./progress";
import { loadQualityChecks } from "./quality";
import { accountRef, ownerKeyOf } from "./account-label";
import { buildOwners, detectedOwnerLabel, loadOpenOwnerRows, type OpenOwnerRow } from "./owners";
import { buildObserved, loadObservedRows, type ObservedInput } from "./observed-activity";
import { isWithinHours } from "./business-time";
import { shiftStartOf } from "./progress";
import { getQueueTrend } from "./queue-trend";
import type { NowTrend } from "./now-types";
import { loadClaimMotives } from "./detected";
import type { ClaimMotive } from "./detected-patterns";

export { NOW_CACHE_SECONDS } from "./now-types";
export type { NowGroup, NowListItem, NowPayload } from "./now-types";

/** Tope de filas de cada lista. Los conteos no se recortan. */
export const NOW_LIST_MAX_ROWS = 200;
const HISTORY_CACHE_SECONDS = 3600;

const group = (g: QueueGroupCounts): NowGroup => ({ ...g, oldestWaitStart: g.oldestWaitStart ? g.oldestWaitStart.toISOString() : null });

/** Lo que se calcula aparte de la cola. null = no se pudo calcular. */
export interface NowExtras {
  history: ClosedUnansweredHistory | null;
  today: { entered: number; answered: number; attended: number } | null;
  closed: ClosedUnansweredReport | null;
  /** Horario y umbrales del semáforo. null si no hay configuración vigente hoy. */
  wait: WaitContext | null;
  /** Cuentas de la configuración vigente hoy; vacío si no hay. */
  accounts: readonly ConfigAccount[];
  /** Marcas del último bloque de las abiertas, para clasificar las antiguas. null si no se pudieron leer. */
  openBlocks: readonly ClosedBlockRow[] | null;
  progress: NowProgress | null;
  checks: QualityChecks | null;
  /** Todas las abiertas con su asignado, para "Quién tiene cada caso". null u omitido si no se pudieron leer. */
  openOwners?: readonly OpenOwnerRow[] | null;
  /** Respuestas públicas de operador por cuenta, para "Actividad observada". null u omitido si no se pudieron leer. */
  observed?: ObservedInput | null;
  /** Evolución de la cola, ya calculada. null u omitido si no se pudo calcular. */
  trend?: NowTrend | null;
  /** Motivos de reclamo detectados, por conversación pendiente. null u omitido si no se pudieron revisar. */
  claims?: ReadonlyMap<string, ClaimMotive[]> | null;
}

/** Responsable de un caso. PURO. */
export function ownerOf(assignee: string | null, accounts: readonly ConfigAccount[]): NowOwner {
  if (!assignee) return { kind: "UNKNOWN" };
  const ref = accountRef(assignee, accounts);
  return ref.role === "SISTEMA" ? { kind: "SYSTEM" } : { kind: "ACCOUNT", label: ref.label };
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
    windowWarningHours: windowWarningHoursOf(current.data),
    lastResponseWarningMinutes: lastResponseWarningMinutesOf(current.data),
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
  const { history, today, closed, wait, accounts, openBlocks, progress, checks } = extras;
  const openOwners = extras.openOwners ?? null;
  const ownerRowById = openOwners ? new Map(openOwners.map((r) => [r.conversationId, r])) : null;
  const blockById = openBlocks ? new Map(openBlocks.map((b) => [b.conversationId, b])) : null;
  // Una antigua sin marcas (no debería pasar) queda como pendiente: nunca se da por cerrada sin evidencia.
  const now = snapshot.generatedAt;
  // La ventana de WhatsApp corre en tiempo real desde el último mensaje del cliente.
  const warningHours = wait?.windowWarningHours ?? DEFAULT_WINDOW_WARNING_HOURS;
  const windowOf = (lastCustomerAt: Date) => windowState(lastCustomerAt, now, warningHours);
  const staleItems = stale.map((it) => {
    const b = blockById?.get(it.conversationId);
    const kind = !blockById ? null : b && isProbablyClosed(b) ? ("PROBABLE_CLOSE" as const) : ("PENDING" as const);
    return { conversationId: it.conversationId, waitStart: it.waitStart.toISOString(), kind, windowClosed: windowOf(it.lastCustomerAt) === "CERRADA" };
  });
  const probableClose = blockById ? staleItems.filter((i) => i.kind === "PROBABLE_CLOSE").length : null;
  const closedItems = closed ? closed.items.map((it) => ({ ...it, windowClosed: windowOf(new Date(it.lastCustomerAt)) === "CERRADA" })) : null;
  // Posibles pendientes antiguos: los antiguos sin señal de cierre (o sin clasificar). Entran
  // en la lista y en las alertas; nunca se excluye un caso solo por antiguo.
  const staleKind = new Map(staleItems.map((s) => [s.conversationId, s.kind]));
  const oldPending = stale.filter((it) => staleKind.get(it.conversationId) !== "PROBABLE_CLOSE");
  const oldPendingIds = new Set(oldPending.map((it) => it.conversationId));
  // El semáforo se calcula para todos los que esperan, no solo para los que entran en la lista.
  const items = [...oldPending, ...waiting].map((it) => {
    const window = windowOf(it.lastCustomerAt);
    const byClock = wait ? classifyWait(it, now, wait) : { level: null, businessMinutes: null };
    return {
    conversationId: it.conversationId,
    status: it.status,
    owner: ownerOf(it.externalAssigneeId, accounts),
    ownerKey: ownerKeyOf(it.externalAssigneeId, accounts),
    detectedOwner: it.externalAssigneeId ? null : detectedOwnerLabel(ownerRowById?.get(it.conversationId), accounts),
    createdAt: it.createdAt.toISOString(),
    waitStart: it.waitStart.toISOString(),
    waitMinutes: Math.round(it.waitHours * 60),
    lastCustomerAt: it.lastCustomerAt.toISOString(),
    window,
    alert: it.urgent ? ("URGENTE" as const) : it.insisting ? ("INSISTIENDO" as const) : null,
    // Con la ventana de WhatsApp cerrada el caso es crítico, sume lo que sume el reloj hábil.
    level: window === "CERRADA" ? ("CRITICO" as const) : byClock.level,
    businessMinutes: byClock.businessMinutes,
    hasHumanResponse: it.hasHumanResponse,
    botOrderComplete: it.botOrderComplete,
    thanksCandidate: it.thanksCandidate,
    claims: extras.claims ? extras.claims.get(it.conversationId) ?? [] : null,
    oldPending: oldPendingIds.has(it.conversationId),
    };
  });
  // Primero los críticos por ventana cerrada, del que más espera real al que menos; después el resto, como venía.
  const closedFirst = [
    ...items.filter((it) => it.window === "CERRADA").sort((a, b) => (a.lastCustomerAt < b.lastCustomerAt ? -1 : a.lastCustomerAt > b.lastCustomerAt ? 1 : 0)),
    ...items.filter((it) => it.window !== "CERRADA"),
  ];

  return {
    generatedAt: snapshot.generatedAt.toISOString(),
    windowHours,
    schedule: wait ? { ...scheduleState(now, wait), goalMinutes: wait.goalMinutes, criticalMinutes: wait.criticalMinutes } : null,
    waiting: {
      total: waiting.length,
      oldPending: oldPending.length,
      neverHuman: neverHuman.length,
      awaitingNext: waiting.length - neverHuman.length,
      completedOrders: items.filter((it) => !it.hasHumanResponse && it.botOrderComplete).length,
      // Sin configuración solo se pueden contar los críticos por ventana cerrada: si no hay ninguno, queda sin dato.
      critical: wait || items.some((it) => it.level === "CRITICO") ? items.filter((it) => it.level === "CRITICO").length : null,
      oldestWaitStart: waiting.length ? waiting[0].waitStart.toISOString() : null,
      urgent: items.filter((it) => it.alert === "URGENTE").length,
      insisting: items.filter((it) => it.alert === "INSISTIENDO").length,
      claims: extras.claims ? items.filter((it) => it.claims !== null && it.claims.length > 0).length : null,
    },
    today,
    list: closedFirst.slice(0, maxRows),
    listTotal: items.length,
    stale: {
      total: stale.length,
      probableClose,
      pending: probableClose === null ? null : stale.length - probableClose,
      oldestWaitStart: stale.length ? stale[0].waitStart.toISOString() : null,
      items: staleItems.slice(0, maxRows),
    },
    closedUnanswered: closed
      ? { days: closed.days, total: closed.total, question: closed.question, order: closed.order, attachment: closed.attachment, items: closedItems!.slice(0, maxRows) }
      : null,
    window: {
      hours: WHATSAPP_WINDOW_HOURS,
      warningHours,
      closed: items.filter((it) => it.window === "CERRADA").length,
      closing: items.filter((it) => it.window === "POR_VENCER").length,
      staleClosed: staleItems.filter((it) => it.windowClosed).length,
      closedUnansweredClosed: closedItems ? closedItems.filter((it) => it.windowClosed).length : null,
    },
    // Sobre todos los que esperan, no solo sobre las filas que entran en la lista.
    owners: openOwners ? buildOwners(openOwners, items, accounts) : null,
    observed: extras.observed
      ? buildObserved(extras.observed, {
          now, accounts, pending: items.length,
          inOperatorHours: wait ? isWithinHours(now, wait.ops) : null,
          warningMinutes: wait?.lastResponseWarningMinutes ?? DEFAULT_LAST_RESPONSE_WARNING_MINUTES,
        })
      : null,
    trend: extras.trend ?? null,
    progress,
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
      checks,
    },
  };
}

/**
 * Conversaciones creadas hoy (día de Buenos Aires) y, de esas, las que ya tienen al menos
 * una respuesta pública de un operador: una sola población. Aparte, las atendidas hoy por
 * actividad, que incluyen conversaciones de días anteriores. Solo lectura.
 */
export async function loadToday(now: Date): Promise<{ entered: number; answered: number; attended: number }> {
  const day = arDayISO(now);
  const from = arDayStartUTC(day);
  // Atendidas hoy: la consulta por actividad ya validada, para un solo día.
  const activity = await loadDailyActivityRows(day, day);
  const attended = activity.filter((r) => r.operator).length;
  const rows = await prisma.$queryRaw<Array<{ entered: number; answered: number }>>`
    SELECT count(*)::int AS "entered",
      (count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "ConversationMessage" m
        WHERE m."conversationId" = c.id AND m.author = 'OPERATOR' AND NOT m."isPrivate")))::int AS "answered"
    FROM "Conversation" c
    WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp
  `;
  return { ...(rows[0] ?? { entered: 0, answered: 0 }), attended };
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

  const [snapshot, freshness, today, openBlocks, versions, openOwners] = await Promise.all([
    getQueueSnapshot(now), loadFreshness(), loadToday(now).catch(() => null), loadOpenBlockRows().catch(() => null),
    loadConfigVersions().then((r) => r.versions).catch(() => [] as ConfigVersion[]),
    loadOpenOwnerRows().catch(() => null),
  ]);
  const wait = waitContext(versions, now);
  const current = configForDay(versions, arDayISO(now));
  const accounts = current?.data.accounts ?? [];
  const checks = await loadQualityChecks(now, current ? accounts : null).catch(() => null);
  const progress = await loadProgress(now, versions, wait?.ops ?? null).catch(() => null);
  // Actividad observada: desde el inicio del turno de operadores de hoy o, si no hay, desde el comienzo del día.
  const shiftStart = wait ? shiftStartOf(now, wait.ops) : null;
  const observedSince = shiftStart ?? arDayStartUTC(arDayISO(now));
  const observed = await loadObservedRows(observedSince, now)
    .then((rows) => ({ rows, since: observedSince, sinceIsShift: shiftStart !== null }))
    .catch(() => null);
  // Reclamos detectados: solo en las abiertas que esperan respuesta.
  const claims = await loadClaimMotives(snapshot.items.filter((it) => it.open).map((it) => it.conversationId)).catch(() => null);
  // Evolución de la cola: mismo origen que la actividad observada; tiene su propia caché de 5 minutos.
  const trend = await getQueueTrend(now, observedSince, shiftStart !== null).catch(() => null);

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

  const payload = toNowPayload(snapshot, { history, today, closed, wait, accounts, openBlocks, progress, checks, openOwners, observed, trend, claims }, freshness);
  nowCache = { at: now.getTime(), payload };
  return payload;
}
