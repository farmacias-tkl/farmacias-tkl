/**
 * "Actividad observada" de "Ahora": la última respuesta pública de un operador y, por cuenta,
 * su última respuesta y las conversaciones que atendió desde que empezó el turno (o desde el
 * comienzo del día, si no hay turno).
 *
 * Es actividad REGISTRADA, no presencia: una cuenta sin respuestas recientes no demuestra que
 * nadie esté trabajando. No cuenta el bot, las notas internas ni las cuentas de sistema.
 *
 * buildObserved es PURO. Las filas llevan solo número de cuenta, horas y un conteo.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountDisplay, accountRef, type LabelAccount } from "./account-label";
import { utcTimestampParam } from "./business-time";
import type { NowObserved } from "./now-types";

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
/** Cuántos días hacia atrás se busca la última respuesta de cada cuenta. */
export const OBSERVED_LOOKBACK_DAYS = 7;
const SCOPE_DAYS = 30;

/** Una cuenta con respuestas públicas en los últimos OBSERVED_LOOKBACK_DAYS días. */
export interface ObservedRow {
  /** null si el mensaje no trae cuenta. */
  account: string | null;
  lastAt: Date;
  /** Conversaciones con al menos una respuesta pública de la cuenta desde `since`. */
  conversations: number;
}

export interface ObservedInput {
  rows: readonly ObservedRow[];
  /** Desde cuándo se cuentan las conversaciones atendidas. */
  since: Date;
  /** `since` es el inicio del turno de operadores; si no, el comienzo del día. */
  sinceIsShift: boolean;
}

/**
 * Arma el bloque. PURO.
 * El aviso "para revisar" se enciende solo si se cumplen las tres cosas: hay pendientes, es
 * horario de operadores y la última respuesta fue hace más de `warningMinutes` (o no hay
 * ninguna en los últimos días). Sin configuración no hay horario de operadores: sin aviso.
 */
export function buildObserved(
  input: ObservedInput,
  opts: { now: Date; accounts: readonly LabelAccount[]; pending: number; inOperatorHours: boolean | null; warningMinutes: number },
): NowObserved {
  const team = input.rows.filter((r) => !r.account || accountRef(r.account, opts.accounts).role !== "SISTEMA");
  const last = team.reduce<Date | null>((m, r) => (m === null || r.lastAt > m ? r.lastAt : m), null);
  const minutesAgo = last ? (opts.now.getTime() - last.getTime()) / MS_MIN : null;
  const review = opts.pending > 0 && opts.inOperatorHours === true && (minutesAgo === null || minutesAgo > opts.warningMinutes);
  return {
    lastResponseAt: last ? last.toISOString() : null,
    review,
    warningMinutes: opts.warningMinutes,
    inOperatorHours: opts.inOperatorHours,
    since: input.since.toISOString(),
    sinceIsShift: input.sinceIsShift,
    lookbackDays: OBSERVED_LOOKBACK_DAYS,
    accounts: [...team]
      .sort((a, b) => (a.account ?? "￿").localeCompare(b.account ?? "￿", "es", { numeric: true }))
      .map((r) => ({
        label: r.account ? accountDisplay(accountRef(r.account, opts.accounts)) : "Cuenta no registrada",
        lastResponseAt: r.lastAt.toISOString(),
        conversations: r.conversations,
      })),
  };
}

/**
 * Respuestas públicas de operador por cuenta. Solo lectura. Los mensajes no tienen índice por
 * fecha: se parte de las conversaciones abiertas y de las creadas en los últimos SCOPE_DAYS días.
 */
export async function loadObservedRows(since: Date, now: Date): Promise<ObservedRow[]> {
  const sinceParam = utcTimestampParam(since);
  const lookback = utcTimestampParam(new Date(Math.min(since.getTime(), now.getTime() - OBSERVED_LOOKBACK_DAYS * MS_DAY)));
  const scopeFrom = utcTimestampParam(new Date(now.getTime() - SCOPE_DAYS * MS_DAY));
  return prisma.$queryRaw<ObservedRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id FROM "Conversation" c
      WHERE c.status <> 'RESUELTA' OR c."createdAt" >= ${scopeFrom}::timestamp
    )
    SELECT m."externalSenderId" AS "account",
      max(m."sentAt") AS "lastAt",
      (count(DISTINCT m."conversationId") FILTER (WHERE m."sentAt" >= ${sinceParam}::timestamp))::int AS "conversations"
    FROM "ConversationMessage" m
    JOIN scope s ON s.id = m."conversationId"
    WHERE m.author = 'OPERATOR' AND NOT m."isPrivate" AND m."sentAt" >= ${lookback}::timestamp
    GROUP BY 1
  `);
}
