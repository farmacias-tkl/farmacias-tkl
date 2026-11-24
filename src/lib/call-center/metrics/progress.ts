/**
 * "Avances" del bloque "Ahora": cómo viene el turno y la primera respuesta frente a un
 * período comparable.
 *
 *  - Pendientes al comenzar el turno: conversaciones que, al inicio de la primera franja del
 *    horario de operadores de hoy, estaban abiertas, con el último mensaje público del
 *    cliente y hasta 72 horas de espera (la misma ventana de "Ahora"). El estado a esa hora
 *    se reconstruye con el historial de cambios de estado.
 *  - Pendientes atendidas durante el turno: de ese grupo, los que recibieron una respuesta
 *    pública de un operador desde que empezó el turno.
 *  - Primera respuesta: lo que entró hoy, hasta ahora, contra el mismo día de la semana
 *    anterior cortado a la misma hora. El corte se simula: de la semana anterior solo
 *    cuentan las conversaciones creadas antes de esa hora y las respuestas dadas antes de
 *    esa hora.
 *
 *  - Ventanas de WhatsApp cerradas sin respuesta: conversaciones cuya ventana de 24 horas se
 *    cerró HOY (hasta ahora) sin la primera respuesta de una persona, contra las que se
 *    cerraron el mismo día de la semana anterior hasta la misma hora. Cuenta por el momento
 *    del cierre, no por la fecha de entrada: lo que entra hoy todavía no puede haberse cerrado.
 *
 * Antes del primer turno del día (o un día sin turno, o sin configuración) no hay dato de
 * turno: null, nunca cero.
 *
 * Límite: la hora del historial de estados es la de procesamiento del evento, no la del
 * cambio en Emozion.
 *
 * Las funciones build* y cut* son PURAS. Las load* son de solo lectura y no traen teléfono,
 * nombre ni texto.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildAttentionReport, loadEntryRows, type EntryRow } from "./attention";
import { arDayISO, arDayStartUTC, utcTimestampParam, type DayRanges } from "./business-time";
import { configForDay, type ConfigVersion } from "./config";
import { publicHours } from "./schedule";
import { addDaysISO } from "./period";
import { QUEUE_LIST_DEFAULT_HOURS } from "./patterns";
import type { NowProgress, ProgressSide } from "./now-types";
import { windowClosesAt } from "./whatsapp-window";
import { BOT_BUTTONS, EMPTY_MESSAGE } from "./kinds-patterns";

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
const SCOPE_DAYS = 30;

/** Inicio del primer turno de operadores del día de `now`; null si hoy no hay turno o todavía no empezó. PURO. */
export function shiftStartOf(now: Date, ops: DayRanges): Date | null {
  const day = arDayISO(now);
  const ranges = ops(day);
  if (ranges.length === 0) return null;
  const start = new Date(arDayStartUTC(day).getTime() + ranges[0].from * MS_MIN);
  return start.getTime() <= now.getTime() ? start : null;
}

/** Una conversación cuyo último mensaje público anterior al inicio del turno era del cliente. */
export interface ShiftRow {
  /** Primer mensaje del bloque sin responder a esa hora. */
  waitStart: Date;
  /** Último estado registrado antes del inicio del turno; null si no hay historial previo. */
  statusAtStart: string | null;
  /** Recibió una respuesta pública de un operador desde el inicio del turno. */
  attendedSince: boolean;
}

/** PURO. Abiertas a esa hora y con hasta `windowHours` de espera. */
export function buildShiftProgress(rows: readonly ShiftRow[], shiftStart: Date, windowHours: number = QUEUE_LIST_DEFAULT_HOURS): NonNullable<NowProgress["shift"]> {
  const pending = rows.filter((r) =>
    r.statusAtStart !== "RESUELTA" && shiftStart.getTime() - r.waitStart.getTime() <= windowHours * MS_HOUR);
  return {
    startedAt: shiftStart.toISOString(),
    pendingAtStart: pending.length,
    attendedSince: pending.filter((r) => r.attendedSince).length,
  };
}

/**
 * Deja las filas como se veían en el instante `cutoff`: fuera las creadas después, y sin la
 * respuesta (ni la salida del bot) que todavía no había ocurrido. PURO.
 */
export function cutEntryRowsAt(rows: readonly EntryRow[], cutoff: Date): EntryRow[] {
  const t = cutoff.getTime();
  return rows
    .filter((r) => r.createdAt.getTime() <= t)
    .map((r) => ({
      ...r,
      botExitAt: r.botExitAt && r.botExitAt.getTime() <= t ? r.botExitAt : null,
      botOrderCompleteAt: r.botOrderCompleteAt && r.botOrderCompleteAt.getTime() <= t ? r.botOrderCompleteAt : null,
      firstHumanAt: r.firstHumanAt && r.firstHumanAt.getTime() <= t ? r.firstHumanAt : null,
      firstHumanAccount: r.firstHumanAt && r.firstHumanAt.getTime() <= t ? r.firstHumanAccount : null,
      // Un mensaje del cliente posterior al corte todavía no existía: sin el dato no se evalúa la ventana.
      lastCustomerBeforeResponseAt: r.lastCustomerBeforeResponseAt && r.lastCustomerBeforeResponseAt.getTime() <= t ? r.lastCustomerBeforeResponseAt : null,
      // Medido con todo lo que pasó después del corte: no vale para esa hora.
      maxCustomerSilenceMinutes: null,
    }));
}

/** Resumen de primera respuesta de un día, visto en el instante `at`. PURO. */
export function progressSide(rows: readonly EntryRow[], day: string, at: Date, versions: readonly ConfigVersion[]): ProgressSide {
  const total = buildAttentionReport(cutEntryRowsAt(rows, at), { now: at, from: day, to: day, versions }).total;
  return {
    day,
    entries: total.entries,
    compliance: total.goal?.compliance ?? null,
    medianBusinessMinutes: total.firstResponseBusiness?.median ?? null,
    hasPublicHours: configForDay(versions, day) ? publicHours(versions)(day).length > 0 : null,
    answered: total.answered,
    pending: total.pending.total,
    pendingOverdue: total.goal?.pendingOverdue ?? null,
    medianClockMinutes: total.firstResponseClock.median,
  };
}

/**
 * Conversaciones creadas antes de `shiftStart` cuyo último mensaje público anterior a esa
 * hora es del cliente. Solo lectura; sin ids, teléfono, nombre ni texto.
 */
export async function loadShiftRows(shiftStart: Date): Promise<ShiftRow[]> {
  const t = utcTimestampParam(shiftStart);
  const scopeFrom = utcTimestampParam(new Date(shiftStart.getTime() - SCOPE_DAYS * MS_DAY));
  return prisma.$queryRaw<ShiftRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id FROM "Conversation" c
      WHERE c."createdAt" < ${t}::timestamp
        AND (c.status <> 'RESUELTA' OR c."createdAt" >= ${scopeFrom}::timestamp)
    ), agg AS (
      SELECT m."conversationId" AS cid,
        max(m."sentAt") FILTER (WHERE m.author = 'OPERATOR' AND NOT m."isPrivate" AND m."sentAt" < ${t}::timestamp) AS last_op,
        max(m."sentAt") FILTER (WHERE m.author = 'CUSTOMER' AND m."sentAt" < ${t}::timestamp) AS last_cust,
        coalesce(bool_or(m.author = 'OPERATOR' AND NOT m."isPrivate" AND m."sentAt" >= ${t}::timestamp), false) AS attended
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      GROUP BY 1
    )
    SELECT
      (SELECT min(m."sentAt") FROM "ConversationMessage" m
        WHERE m."conversationId" = a.cid AND m.author = 'CUSTOMER' AND m."sentAt" < ${t}::timestamp
          AND (a.last_op IS NULL OR m."sentAt" > a.last_op)) AS "waitStart",
      (SELECT h."toStatus"::text FROM "ConversationStateHistory" h
        WHERE h."conversationId" = a.cid AND h."changedAt" < ${t}::timestamp
        ORDER BY h."changedAt" DESC, h.id DESC LIMIT 1) AS "statusAtStart",
      a.attended AS "attendedSince"
    FROM agg a
    WHERE a.last_cust IS NOT NULL AND (a.last_op IS NULL OR a.last_cust > a.last_op)
  `);
}

/** Una conversación vista en el instante de corte: último mensaje del cliente sin primera respuesta previa, y esa respuesta si ya existía. */
export interface WindowRow {
  lastCustomerAt: Date;
  firstHumanAt: Date | null;
  /** El cliente solo saludó, agradeció o tocó botones (sin adjuntos): no cuenta. */
  onlyGreeting: boolean;
}

/**
 * Ventanas de WhatsApp que se cerraron sin la primera respuesta dentro de [from, to). PURO.
 * Una respuesta posterior al cierre no la salva: para darla ya hizo falta una plantilla.
 */
export function countWindowClosures(rows: readonly WindowRow[], from: Date, to: Date): number {
  return rows.filter((r) => {
    const closes = windowClosesAt(r.lastCustomerAt).getTime();
    return !r.onlyGreeting && closes >= from.getTime() && closes < to.getTime() && (r.firstHumanAt === null || r.firstHumanAt.getTime() >= closes);
  }).length;
}

/**
 * Filas para countWindowClosures, vistas en el instante `to`: solo cuentan los mensajes
 * anteriores a `to`. Trae únicamente las conversaciones cuya ventana cierra en [from, to).
 * Solo lectura; sin ids, teléfono, nombre ni texto.
 */
export async function loadWindowRows(from: Date, to: Date): Promise<WindowRow[]> {
  const t = utcTimestampParam(to);
  const scopeFrom = utcTimestampParam(new Date(from.getTime() - SCOPE_DAYS * MS_DAY));
  const lcFrom = utcTimestampParam(new Date(from.getTime() - MS_DAY));
  const lcTo = utcTimestampParam(new Date(to.getTime() - MS_DAY));
  const cust = Prisma.sql`m.author = 'CUSTOMER' AND m."sentAt" < ${t}::timestamp`;
  const free = Prisma.sql`${cust} AND m.body IS NOT NULL AND m.body NOT IN (${Prisma.join([...BOT_BUTTONS])})`;
  return prisma.$queryRaw<WindowRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id FROM "Conversation" c
      WHERE c."createdAt" >= ${scopeFrom}::timestamp AND c."createdAt" < ${t}::timestamp
    ), agg AS (
      SELECT m."conversationId" AS cid,
        min(m."sentAt") FILTER (WHERE m.author = 'OPERATOR' AND NOT m."isPrivate" AND m."sentAt" < ${t}::timestamp) AS first_op,
        (NOT coalesce(bool_or(${cust} AND (m.body IS NULL OR m."mediaType" IS NOT NULL)), false)
          AND count(*) FILTER (WHERE ${free}) = count(*) FILTER (WHERE ${free} AND m.body ~* ${EMPTY_MESSAGE})) AS only_greeting
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      GROUP BY 1
    ), lc AS (
      SELECT a.first_op, a.only_greeting,
        (SELECT max(m."sentAt") FROM "ConversationMessage" m
          WHERE m."conversationId" = a.cid AND m.author = 'CUSTOMER' AND m."sentAt" < ${t}::timestamp
            AND (a.first_op IS NULL OR m."sentAt" < a.first_op)) AS last_cust
      FROM agg a
    )
    SELECT last_cust AS "lastCustomerAt", first_op AS "firstHumanAt", only_greeting AS "onlyGreeting"
    FROM lc
    WHERE last_cust >= ${lcFrom}::timestamp AND last_cust < ${lcTo}::timestamp
  `);
}

/** Avances al momento `now`. `ops` es el horario de operadores; null sin configuración vigente. */
export async function loadProgress(now: Date, versions: readonly ConfigVersion[], ops: DayRanges | null): Promise<NowProgress> {
  const today = arDayISO(now);
  const previousDay = addDaysISO(today, -7);
  const previousAt = new Date(now.getTime() - 7 * MS_DAY);
  const shiftStart = ops ? shiftStartOf(now, ops) : null;

  const todayStart = arDayStartUTC(today);
  const previousStart = arDayStartUTC(previousDay);
  const [shiftRows, todayRows, previousRows, windowToday, windowPrevious] = await Promise.all([
    shiftStart ? loadShiftRows(shiftStart) : Promise.resolve(null),
    loadEntryRows(today, today),
    loadEntryRows(previousDay, previousDay),
    // Si falla, el resto de Avances se muestra igual: null, no cero.
    loadWindowRows(todayStart, now).catch(() => null),
    loadWindowRows(previousStart, previousAt).catch(() => null),
  ]);

  return {
    shift: shiftStart && shiftRows ? buildShiftProgress(shiftRows, shiftStart) : null,
    firstResponse: {
      today: progressSide(todayRows, today, now, versions),
      previous: progressSide(previousRows, previousDay, previousAt, versions),
    },
    windowClosed: windowToday && windowPrevious
      ? { today: countWindowClosures(windowToday, todayStart, now), previous: countWindowClosures(windowPrevious, previousStart, previousAt) }
      : null,
  };
}
