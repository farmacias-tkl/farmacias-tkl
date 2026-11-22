/**
 * Indicadores de la pestaña "Calidad de datos" que no salen de la cola: eventos de Emozion
 * sin procesar, cobertura de la salida del bot, cuentas sin configurar y último día de
 * ventas cargado. Ventana fija de los últimos QUALITY_DAYS días.
 *
 * unknownAccountsOf es PURO. loadQualityChecks es de solo lectura: cuenta filas y devuelve
 * números de cuenta de Emozion, nunca teléfono, nombre ni texto.
 */
import { prisma } from "@/lib/prisma";
import { utcTimestampParam } from "./business-time";
import { ACTIVITY_LOOKBACK_DAYS } from "./accounts";
import type { ConfigAccount } from "./config-schema";
import { loadLastSalesDay } from "./sales";
import type { QualityChecks } from "./now-types";

export const QUALITY_DAYS = 7;
const MS_DAY = 86_400_000;

/** Cuentas con mensajes que no figuran en la configuración vigente, ordenadas. PURO. */
export function unknownAccountsOf(withMessages: readonly string[], configured: readonly ConfigAccount[]): string[] {
  const known = new Set(configured.map((a) => a.externalId));
  return [...new Set(withMessages)].filter((a) => !known.has(a)).sort((x, y) => x.localeCompare(y, "es", { numeric: true }));
}

/**
 * `accounts` son las cuentas de la configuración vigente hoy; null si no hay configuración
 * (entonces no se puede decir qué cuenta falta configurar).
 */
export async function loadQualityChecks(now: Date, accounts: readonly ConfigAccount[] | null): Promise<QualityChecks> {
  const since = utcTimestampParam(new Date(now.getTime() - QUALITY_DAYS * MS_DAY));
  const scopeSince = utcTimestampParam(new Date(now.getTime() - (QUALITY_DAYS + ACTIVITY_LOOKBACK_DAYS) * MS_DAY));

  const [events, exits, senders, salesLastDay] = await Promise.all([
    prisma.$queryRaw<Array<{ error: number; received: number; total: number }>>`
      SELECT (count(*) FILTER (WHERE e.status = 'ERROR'))::int AS "error",
             (count(*) FILTER (WHERE e.status = 'RECEIVED'))::int AS "received",
             count(*)::int AS "total"
      FROM "WebhookEvent" e
      WHERE e."receivedAt" >= ${since}::timestamp
    `,
    prisma.$queryRaw<Array<{ entries: number; withExit: number }>>`
      SELECT count(*)::int AS "entries",
        (count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "ConversationStateHistory" h
          WHERE h."conversationId" = c.id AND h."fromStatus" = 'PENDIENTE' AND h."toStatus" IN ('SIN_ASIGNAR', 'ASIGNADA'))))::int AS "withExit"
      FROM "Conversation" c
      WHERE c."createdAt" >= ${since}::timestamp
    `,
    // Los mensajes no tienen índice por fecha: se parte de la conversación, como en accounts.ts.
    prisma.$queryRaw<Array<{ account: string }>>`
      SELECT DISTINCT m."externalSenderId" AS "account"
      FROM "ConversationMessage" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE (c.status <> 'RESUELTA' OR c."createdAt" >= ${scopeSince}::timestamp)
        AND m.author = 'OPERATOR' AND m."externalSenderId" IS NOT NULL
        AND m."sentAt" >= ${since}::timestamp
    `,
    loadLastSalesDay(),
  ]);

  return {
    days: QUALITY_DAYS,
    events: events[0] ?? { error: 0, received: 0, total: 0 },
    botExit: exits[0] ?? { entries: 0, withExit: 0 },
    unknownAccounts: accounts ? unknownAccountsOf(senders.map((s) => s.account), accounts) : null,
    salesLastDay,
  };
}
