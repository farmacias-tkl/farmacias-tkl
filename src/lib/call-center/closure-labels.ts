/**
 * Etiquetas de cierre para la ingesta de Emozion.
 *
 * Al resolver una conversación, una automatización de Emozion le agrega una etiqueta con el
 * resultado que eligió el operador. Cuáles etiquetas son de cierre NO está en el código: sale
 * de la configuración de métricas vigente hoy (closureLabels). Sin configuración, o sin ese
 * campo, no hay ninguna y la ingesta solo guarda las etiquetas.
 *
 * Caché en memoria de un minuto por instancia: la ingesta no consulta la configuración en
 * cada evento. Nunca lanza: si la configuración no se puede leer, devuelve el conjunto vacío
 * (un problema de métricas no puede frenar la ingesta).
 */
import { arDayISO } from "./metrics/business-time";
import { configForDay, loadConfigVersions } from "./metrics/config";

const CACHE_MS = 60_000;
let cache: { at: number; labels: ReadonlySet<string> } | null = null;

export async function loadClosureLabels(now: Date = new Date()): Promise<ReadonlySet<string>> {
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.labels;
  let labels: ReadonlySet<string> = new Set();
  try {
    const { versions } = await loadConfigVersions();
    const current = configForDay(versions, arDayISO(now));
    labels = new Set((current?.data.closureLabels ?? []).map((c) => c.label));
  } catch {
    labels = new Set();
  }
  cache = { at: now.getTime(), labels };
  return labels;
}

/** Solo para pruebas: olvida la caché. */
export function resetClosureLabelsCache(): void {
  cache = null;
}
