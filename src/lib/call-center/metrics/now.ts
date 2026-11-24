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
import { classifyWait, scheduleState, waitClockStart, type WaitContext } from "./wait-level";
import {
  NOW_CACHE_SECONDS, type NowListItem, type ClosedUnansweredReport, type NowGroup, type NowOwner, type NowPayload, type NowProgress, type QualityChecks,
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
import { buildTodayClosures, type TodayClosureRow, type TodayClosures } from "./cover";
import { closureMapOf } from "./closure-outcome";
import { SYNC_NOTE_LIKE } from "../sync-note";
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
  /** Cierres de hoy por resultado. null u omitido si no se pudieron calcular. */
  todayClosures?: TodayClosures | null;
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
    coveredFrom: versions.reduce<string | undefined>((min, v) => (min === undefined || v.validFrom < min ? v.validFrom : min), undefined),
    goalMinutes: current.data.firstResponseGoalMinutes,
    criticalMinutes: criticalWaitMinutesOf(current.data),
    windowWarningHours: windowWarningHoursOf(current.data),
    lastResponseWarningMinutes: lastResponseWarningMinutesOf(current.data),
  };
}

/**
 * Prioridad de gestión dentro de atención actual. Menor es antes. PURO.
 *  0 urgente · 1 insistiendo · 2 ventana de WhatsApp por vencer · 3 demora crítica con la
 *  ventana todavía abierta · 4 pedido completo sin primera respuesta · 5 ventana cerrada · 6 resto.
 * La ventana cerrada va después: ya no se puede responder libremente, así que un caso que
 * todavía se puede contestar gana tiempo si se atiende antes.
 */
export function attentionRank(it: Pick<NowListItem, "alert" | "window" | "level" | "botOrderComplete" | "hasHumanResponse">): number {
  if (it.alert === "URGENTE") return 0;
  if (it.alert === "INSISTIENDO") return 1;
  if (it.window === "POR_VENCER") return 2;
  if (it.level === "CRITICO" && it.window !== "CERRADA") return 3;
  if (it.botOrderComplete && !it.hasHumanResponse) return 4;
  if (it.window === "CERRADA") return 5;
  return 6;
}

/** Orden de la lista operativa: por prioridad; la ventana por vencer, la que vence antes; el resto, el que más espera. */
export function compareAttention(a: NowListItem, b: NowListItem): number {
  const ra = attentionRank(a), rb = attentionRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return a.lastCustomerAt < b.lastCustomerAt ? -1 : a.lastCustomerAt > b.lastCustomerAt ? 1 : 0;
  return b.waitMinutes - a.waitMinutes;
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
  // Antes del primer día con horarios cargados el reloj hábil no corre.
  const coveredFromAt = wait?.coveredFrom ? arDayStartUTC(wait.coveredFrom).getTime() : null;
  // Horario de operadores de hoy: para decir si no hay turno o si todavía no empezó.
  const opsToday = wait ? wait.ops(arDayISO(now)) : [];
  const opsStart = opsToday.length ? new Date(arDayStartUTC(arDayISO(now)).getTime() + opsToday[0].from * 60_000) : null;
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
    businessPartial: coveredFromAt !== null && waitClockStart(it).getTime() < coveredFromAt,
    hasHumanResponse: it.hasHumanResponse,
    botOrderComplete: it.botOrderComplete,
    orderRequest: it.botOrderComplete || it.customerSentPrescriptionLink === true || it.customerAskedOrder === true,
    thanksCandidate: it.thanksCandidate,
    claims: extras.claims ? extras.claims.get(it.conversationId) ?? [] : null,
    oldPending: oldPendingIds.has(it.conversationId),
    // Histórico por verificar: antiguo y sin un mensaje del cliente dentro de la ventana de la cola.
    historical: oldPendingIds.has(it.conversationId) && now.getTime() - it.lastCustomerAt.getTime() > windowHours * 3_600_000,
    };
  });
  // Atención actual, por prioridad de gestión; los históricos van aparte y no encabezan la lista.
  const current = items.filter((it) => !it.historical).sort(compareAttention);
  const historical = items.filter((it) => it.historical).sort((a, b) => b.waitMinutes - a.waitMinutes);
  const criticalKnown = wait !== null || items.some((it) => it.level === "CRITICO");

  return {
    generatedAt: snapshot.generatedAt.toISOString(),
    windowHours,
    schedule: wait
      ? {
          ...scheduleState(now, wait), goalMinutes: wait.goalMinutes, criticalMinutes: wait.criticalMinutes,
          operatorsToday: !opsStart ? ("NONE" as const) : opsStart.getTime() <= now.getTime() ? ("STARTED" as const) : ("NOT_STARTED" as const),
          operatorsStartAt: opsStart ? opsStart.toISOString() : null,
          businessSince: wait.coveredFrom ?? null,
        }
      : null,
    waiting: {
      total: waiting.length,
      oldPending: oldPending.length,
      neverHuman: neverHuman.length,
      awaitingNext: waiting.length - neverHuman.length,
      current: current.length,
      historical: historical.length,
      ordersUntaken: current.filter((it) => !it.hasHumanResponse && it.orderRequest).length,
      queriesUnanswered: current.filter((it) => !it.hasHumanResponse && !it.orderRequest).length,
      criticalCurrent: criticalKnown ? current.filter((it) => it.level === "CRITICO").length : null,
      criticalHistorical: criticalKnown ? historical.filter((it) => it.level === "CRITICO").length : null,
      // Las alertas de acción cuentan la atención actual: son las que abre la lista operativa.
      completedOrders: current.filter((it) => !it.hasHumanResponse && it.botOrderComplete).length,
      // Sin configuración solo se pueden contar los críticos por ventana cerrada: si no hay ninguno, queda sin dato.
      critical: criticalKnown ? items.filter((it) => it.level === "CRITICO").length : null,
      oldestWaitStart: waiting.length ? waiting[0].waitStart.toISOString() : null,
      urgent: current.filter((it) => it.alert === "URGENTE").length,
      insisting: current.filter((it) => it.alert === "INSISTIENDO").length,
      claims: extras.claims ? current.filter((it) => it.claims !== null && it.claims.length > 0).length : null,
    },
    today,
    list: current.slice(0, maxRows),
    listTotal: current.length,
    historicalList: historical.slice(0, maxRows),
    historicalTotal: historical.length,
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
      // De atención actual. Los históricos tienen casi todos la ventana cerrada y se cuentan aparte.
      closed: current.filter((it) => it.window === "CERRADA").length,
      closing: current.filter((it) => it.window === "POR_VENCER").length,
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
    todayClosures: extras.todayClosures ?? null,
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
 * Conversaciones resueltas hoy (día de Buenos Aires): una fila por conversación, con el tipo
 * de cierre de su última resolución del día. No cuentan las correcciones de estado contra
 * Emozion, que no son cierres de un operador. Solo lectura; sin texto ni datos del cliente.
 */
export async function loadTodayClosureRows(now: Date): Promise<TodayClosureRow[]> {
  const from = arDayStartUTC(arDayISO(now));
  return prisma.$queryRaw<TodayClosureRow[]>`
    SELECT DISTINCT ON (h."conversationId") h."closureTypeName" AS "closureTypeName"
    FROM "ConversationStateHistory" h
    WHERE h."toStatus" = 'RESUELTA' AND h."changedAt" >= ${utcTimestampParam(from)}::timestamp
      AND (h.note IS NULL OR h.note NOT LIKE ${SYNC_NOTE_LIKE})
    ORDER BY h."conversationId", h."changedAt" DESC, h.id DESC
  `;
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

/** Lo que no depende de nada: la cola, la frescura, lo de hoy, la configuración y los asignados. */
interface Stage1 {
  now: Date;
  snapshot: QueueSnapshot;
  freshness: { lastWebhookAt: Date | null; lastMessageAt: Date | null };
  today: { entered: number; answered: number; attended: number } | null;
  openBlocks: ClosedBlockRow[] | null;
  versions: ConfigVersion[];
  openOwners: OpenOwnerRow[] | null;
  ms: Record<string, number>;
}

// Cada parte informa cuánto tardó (solo milisegundos, sin datos) para poder ver en el log
// dónde se va el tiempo.
const timedInto = (ms: Record<string, number>) => <T,>(name: string, p: Promise<T>): Promise<T> => {
  const t0 = Date.now();
  return p.finally(() => { ms[name] = Date.now() - t0; });
};

let stage1Cache: { at: number; value: Promise<Stage1> } | null = null;

/**
 * Primera tanda, compartida por el resumen y por la pantalla completa. Se guarda la PROMESA:
 * dos pedidos simultáneos (el resumen y el completo, o dos personas a la vez) esperan el
 * mismo cálculo en lugar de repetirlo.
 */
function loadStage1(now: Date): Promise<Stage1> {
  if (stage1Cache && now.getTime() - stage1Cache.at < NOW_CACHE_SECONDS * 1000) return stage1Cache.value;
  const ms: Record<string, number> = {};
  const timed = timedInto(ms);
  const value = Promise.all([
    timed("cola", getQueueSnapshot(now)), timed("frescura", loadFreshness()), timed("hoy", loadToday(now).catch(() => null)),
    timed("bloques", loadOpenBlockRows().catch(() => null)),
    timed("config", loadConfigVersions().then((r) => r.versions).catch(() => [] as ConfigVersion[])),
    timed("asignados", loadOpenOwnerRows().catch(() => null)),
  ]).then(([snapshot, freshness, today, openBlocks, versions, openOwners]) => ({ now, snapshot, freshness, today, openBlocks, versions, openOwners, ms }));
  stage1Cache = { at: now.getTime(), value };
  // Si falla no queda guardada: el próximo pedido vuelve a intentar.
  value.catch(() => { if (stage1Cache?.value === value) stage1Cache = null; });
  return value;
}

/**
 * Resumen de "Ahora": solo la primera tanda. Trae la portada (menos los cierres de hoy), las
 * alertas, el total de pendientes, las asignaciones y la lista de casos. Lo demás va en null y
 * `partial` en true: la pantalla lo muestra como "cargando" y lo completa con getNowPayload.
 */
export async function getNowSummary(now: Date = new Date()): Promise<NowPayload> {
  if (nowCache && now.getTime() - nowCache.at < NOW_CACHE_SECONDS * 1000) return nowCache.payload;
  const t0 = Date.now();
  const s1 = await loadStage1(now);
  const wait = waitContext(s1.versions, s1.now);
  const accounts = configForDay(s1.versions, arDayISO(s1.now))?.data.accounts ?? [];
  const payload = toNowPayload(
    s1.snapshot,
    { history: null, today: s1.today, closed: null, wait, accounts, openBlocks: s1.openBlocks, progress: null, checks: null, openOwners: s1.openOwners },
    s1.freshness,
  );
  console.log("[call-center/metrics/now] resumen ms", JSON.stringify({ total: Date.now() - t0, ...s1.ms }));
  return { ...payload, partial: true };
}

/** El bloque "Ahora" completo, con caché de NOW_CACHE_SECONDS por instancia. */
export async function getNowPayload(now: Date = new Date()): Promise<NowPayload> {
  if (nowCache && now.getTime() - nowCache.at < NOW_CACHE_SECONDS * 1000) return nowCache.payload;

  const t0 = Date.now();
  // Tanda 1: lo que no depende de nada. Si el resumen ya la pidió, es la misma.
  const s1 = await loadStage1(now);
  const { snapshot, freshness, today, openBlocks, versions, openOwners } = s1;
  now = s1.now;
  const ms: Record<string, number> = {};
  const timed = timedInto(ms);
  const wait = waitContext(versions, now);
  const current = configForDay(versions, arDayISO(now));
  const accounts = current?.data.accounts ?? [];
  // Actividad observada: desde el inicio del turno de operadores de hoy o, si no hay, desde el comienzo del día.
  const shiftStart = wait ? shiftStartOf(now, wait.ops) : null;
  const observedSince = shiftStart ?? arDayStartUTC(arDayISO(now));

  // Tanda 2: dependen de la cola o de la configuración, pero no entre sí. Van juntas.
  // Si una parte falla, la pantalla la muestra como no disponible en lugar de caerse entera.
  const historyFresh = historyCache && now.getTime() - historyCache.at < HISTORY_CACHE_SECONDS * 1000 ? historyCache.value : undefined;
  const [checks, progress, observed, claims, trend, closed, todayClosures, history] = await Promise.all([
    timed("calidad", loadQualityChecks(now, current ? accounts : null).catch(() => null)),
    timed("avance", loadProgress(now, versions, wait?.ops ?? null).catch(() => null)),
    timed("actividad", loadObservedRows(observedSince, now)
      .then((rows) => ({ rows, since: observedSince, sinceIsShift: shiftStart !== null }))
      .catch(() => null)),
    // Reclamos detectados: solo en las abiertas que esperan respuesta.
    timed("reclamos", loadClaimMotives(snapshot.items.filter((it) => it.open).map((it) => it.conversationId)).catch(() => null)),
    // Evolución de la cola: mismo origen que la actividad observada; tiene su propia caché de 5 minutos.
    timed("evolucion", getQueueTrend(now, observedSince, shiftStart !== null).catch(() => null)),
    timed("cerradas", getClosedUnanswered(now, snapshot.closedSince).catch(() => null)),
    timed("cierres_hoy", loadTodayClosureRows(now).then((rows) => buildTodayClosures(rows, closureMapOf(current?.data))).catch(() => null)),
    // Histórico: se recalcula como mucho una vez por hora.
    historyFresh !== undefined
      ? Promise.resolve(historyFresh)
      : timed("historico", countClosedUnansweredBefore(snapshot.closedSince)
          .then((value) => { historyCache = { at: now.getTime(), before: snapshot.closedSince.getTime(), value }; return value as ClosedUnansweredHistory | null; })
          .catch(() => null)),
  ]);
  console.log("[call-center/metrics/now] ms", JSON.stringify({ total: Date.now() - t0, ...s1.ms, ...ms }));

  const payload = toNowPayload(snapshot, { history, today, closed, wait, accounts, openBlocks, progress, checks, openOwners, observed, trend, claims, todayClosures }, freshness);
  nowCache = { at: now.getTime(), payload };
  return payload;
}
