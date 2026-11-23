/**
 * Bloque "Operadores": informe de un período por cuenta de Emozion, con caché en memoria.
 *
 * Junta tres lecturas: los mensajes de operador del período y los bloques posteriores del
 * cliente (por actividad), y las conversaciones creadas en el período (por entrada), de las
 * que sale la primera respuesta de cada cuenta. La respuesta lleva solo totales por cuenta
 * y del equipo: ninguna fila por conversación, ni teléfono, nombre o texto del cliente.
 */
import { ACTIVITY_LOOKBACK_DAYS, buildAccountsReport, loadFollowupBlocks, loadOperatorMessages } from "./accounts";
import { loadEntryRows, toEntryFact } from "./attention";
import { arDayISO } from "./business-time";
import { configForDay, loadConfigVersions } from "./config";
import { publicHours } from "./schedule";
import { ACCOUNTS_CACHE_SECONDS, type AccountsPayload } from "./accounts-types";
import { prisma } from "@/lib/prisma";
import { closureMapOf, closureOutcomeOf } from "./closure-outcome";
import type { ClosureOutcome } from "./config-schema";

/** Resultado de cierre de cada conversación, por id. Solo lectura: estado, resultado guardado y etiquetas. */
async function loadOutcomes(conversationIds: readonly string[], map: ReturnType<typeof closureMapOf>): Promise<Map<string, ClosureOutcome>> {
  const out = new Map<string, ClosureOutcome>();
  for (let i = 0; i < conversationIds.length; i += 5000) {
    const rows = await prisma.conversation.findMany({
      where: { id: { in: conversationIds.slice(i, i + 5000) }, status: "RESUELTA" },
      select: { id: true, closureTypeName: true, externalLabels: true },
    });
    for (const r of rows) {
      const o = closureOutcomeOf({ resolved: true, closureTypeName: r.closureTypeName, labels: r.externalLabels }, map);
      if (o) out.set(r.id, o.outcome);
    }
  }
  return out;
}

/** Tope de períodos guardados: al llenarse se descartan los vencidos y, si no alcanza, todos. */
const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; payload: AccountsPayload }>();

/** Informe por cuenta entre dos días de Buenos Aires, inclusive. */
export async function getAccountsPayload(from: string, to: string, now: Date = new Date()): Promise<AccountsPayload> {
  const key = `${from}|${to}`;
  const ttl = ACCOUNTS_CACHE_SECONDS * 1000;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < ttl) return hit.payload;

  const [{ versions }, rows, messages, followups] = await Promise.all([
    loadConfigVersions(), loadEntryRows(from, to), loadOperatorMessages(from, to), loadFollowupBlocks(from, to),
  ]);
  const pub = publicHours(versions);
  const facts = rows.map((r) => toEntryFact(r, now, versions, pub));
  // Resultado de cierre confirmado por el operador, si la configuración vigente define etiquetas de cierre.
  const closureMap = closureMapOf(configForDay(versions, arDayISO(now))?.data);
  const outcomes = closureMap.size > 0
    ? await loadOutcomes([...new Set(messages.map((m) => m.conversationId))], closureMap).catch(() => null)
    : null;
  const report = buildAccountsReport({ messages, followups, facts, outcomes }, { now, versions });
  const payload = JSON.parse(JSON.stringify({
    ...report,
    period: { from, to },
    hasConfig: configForDay(versions, arDayISO(now)) !== null,
    lookbackDays: ACTIVITY_LOOKBACK_DAYS,
  })) as AccountsPayload;

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= ttl) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}
