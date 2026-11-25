/**
 * Etiquetas de cierre para la ingesta de Emozion.
 *
 * Al resolver una conversación, una automatización de Emozion le agrega una etiqueta con el
 * resultado que eligió el operador. Cuáles etiquetas son de cierre NO está en el código: sale
 * de la configuración de métricas vigente hoy (closureLabels). Sin configuración, o sin ese
 * campo, no hay ninguna y la ingesta solo guarda las etiquetas.
 *
 * De la misma configuración salen las cuentas de sistema (accounts con system = true): un
 * asignado SIN tipo que es una de esas cuentas no es una persona (loadSystemAccounts).
 *
 * Caché en memoria de un minuto por instancia: la ingesta no consulta la configuración en
 * cada evento. Nunca lanza: si la configuración no se puede leer, devuelve el conjunto vacío
 * (un problema de métricas no puede frenar la ingesta).
 */
import { arDayISO } from "./metrics/business-time";
import { configForDay, loadConfigVersions } from "./metrics/config";
import { isSystemAccount } from "./metrics/config-schema";

const CACHE_MS = 60_000;
interface IngestConfig { labels: ReadonlySet<string>; systemAccounts: ReadonlySet<string> }
let cache: ({ at: number } & IngestConfig) | null = null;

async function load(now: Date): Promise<IngestConfig> {
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache;
  let cfg: IngestConfig = { labels: new Set(), systemAccounts: new Set() };
  try {
    const { versions } = await loadConfigVersions();
    const current = configForDay(versions, arDayISO(now));
    cfg = {
      labels: new Set((current?.data.closureLabels ?? []).map((c) => c.label)),
      systemAccounts: new Set((current?.data.accounts ?? []).filter(isSystemAccount).map((a) => a.externalId)),
    };
  } catch {
    // Sin configuración legible: ninguna etiqueta de cierre y ninguna cuenta de sistema.
  }
  cache = { at: now.getTime(), ...cfg };
  return cache;
}

export async function loadClosureLabels(now: Date = new Date()): Promise<ReadonlySet<string>> {
  return (await load(now)).labels;
}

/** Ids de las cuentas de sistema de la configuración vigente hoy. */
export async function loadSystemAccounts(now: Date = new Date()): Promise<ReadonlySet<string>> {
  return (await load(now)).systemAccounts;
}

/** Solo para pruebas: olvida la caché. */
export function resetClosureLabelsCache(): void {
  cache = null;
}
