/**
 * Bloque "Operadores": informe de un período por cuenta de Emozion, con caché en memoria.
 *
 * Junta tres lecturas: los mensajes de operador del período y los bloques posteriores del
 * cliente (por actividad), y las conversaciones creadas en el período (por entrada), de las
 * que sale la primera respuesta de cada cuenta. La respuesta lleva solo totales por cuenta
 * y del equipo: ninguna fila por conversación, ni teléfono, nombre o texto del cliente.
 */
import { ACTIVITY_LOOKBACK_DAYS, buildAccountsReport, loadFollowupBlocks, loadOperatorMessages, loadPeriodClosures } from "./accounts";
import { loadEntryRows, toEntryFact } from "./attention";
import { arDayISO } from "./business-time";
import { configForDay, loadConfigVersions } from "./config";
import { publicHours } from "./schedule";
import { ACCOUNTS_CACHE_SECONDS, type AccountsPayload } from "./accounts-types";
/** Tope de períodos guardados: al llenarse se descartan los vencidos y, si no alcanza, todos. */
const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; payload: AccountsPayload }>();

/** Informe por cuenta entre dos días de Buenos Aires, inclusive. */
export async function getAccountsPayload(from: string, to: string, now: Date = new Date()): Promise<AccountsPayload> {
  const key = `${from}|${to}`;
  const ttl = ACCOUNTS_CACHE_SECONDS * 1000;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < ttl) return hit.payload;

  const [{ versions }, rows, messages, followups, closures] = await Promise.all([
    loadConfigVersions(), loadEntryRows(from, to), loadOperatorMessages(from, to), loadFollowupBlocks(from, to),
    // Si falla, el resto del informe se muestra igual: null, no cero.
    loadPeriodClosures(from, to).catch(() => null),
  ]);
  const pub = publicHours(versions);
  const facts = rows.map((r) => toEntryFact(r, now, versions, pub));
  const report = buildAccountsReport({ messages, followups, facts, closures }, { now, versions });
  const payload = JSON.parse(JSON.stringify({
    ...report,
    // Las cuentas ya llevan sus cierres: acá quedan los del equipo, sin el mapa por cuenta.
    closures: report.closures ? { total: report.closures.total, coverage: report.closures.coverage, withoutAccount: report.closures.withoutAccount, byBot: report.closures.byBot } : null,
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
