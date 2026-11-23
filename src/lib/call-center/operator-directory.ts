/**
 * Lo que la bandeja y la vista de conversación leen para mostrar el operador: las cuentas y
 * las etiquetas de cierre de la configuración de métricas vigente hoy, y la cuenta del último
 * mensaje público de un operador. Solo lectura. Nunca tira: si algo falla, la pantalla
 * muestra las cuentas por número y sigue funcionando.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { arDayISO } from "./metrics/business-time";
import { configForDay, loadConfigVersions } from "./metrics/config";
import { closureMapOf, type ClosureMap } from "./metrics/closure-outcome";
import type { ConfigAccount } from "./metrics/config-schema";

export interface OperatorDirectory {
  accounts: readonly ConfigAccount[];
  closureMap: ClosureMap;
}

export async function loadOperatorDirectory(now: Date = new Date()): Promise<OperatorDirectory> {
  try {
    const { versions } = await loadConfigVersions();
    const data = configForDay(versions, arDayISO(now))?.data;
    return { accounts: data?.accounts ?? [], closureMap: closureMapOf(data) };
  } catch {
    return { accounts: [], closureMap: closureMapOf(null) };
  }
}

/** Cuenta y hora del último mensaje público de un operador, por conversación. Las que no tienen ninguno no aparecen. */
export async function loadLastResponders(conversationIds: readonly string[]): Promise<Map<string, { account: string | null; at: Date }>> {
  const out = new Map<string, { account: string | null; at: Date }>();
  if (conversationIds.length === 0) return out;
  try {
    const rows = await prisma.$queryRaw<Array<{ conversationId: string; account: string | null; at: Date }>>`
      SELECT DISTINCT ON (m."conversationId") m."conversationId", m."externalSenderId" AS "account", m."sentAt" AS "at"
      FROM "ConversationMessage" m
      WHERE m."conversationId" IN (${Prisma.join(conversationIds)}) AND m.author = 'OPERATOR' AND NOT m."isPrivate"
      ORDER BY m."conversationId", m."sentAt" DESC
    `;
    for (const r of rows) out.set(r.conversationId, { account: r.account, at: r.at });
  } catch {
    // Sin el dato detectado la pantalla muestra solo el asignado.
  }
  return out;
}
