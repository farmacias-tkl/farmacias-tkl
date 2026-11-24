/**
 * Bloque "Atención y demoras": informe de un período con caché en memoria.
 *
 * El informe es pesado (recorre los mensajes de las conversaciones creadas en el período),
 * así que se guarda ATTENTION_CACHE_SECONDS por instancia y por período. La respuesta lleva
 * solo totales y el resumen por día, por entrada y por actividad: ninguna fila por conversación, ni teléfono, nombre o
 * texto del cliente.
 */
import { buildAttentionReport, loadEntryRows, type AttentionReport } from "./attention";
import { loadConfigVersions } from "./config";
import { loadActivityReport, type ActivityReport } from "./activity";
import { ATTENTION_CACHE_SECONDS, type AttentionPayload } from "./attention-types";

/** Tope de períodos guardados: al llenarse se descartan los vencidos y, si no alcanza, todos. */
const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; payload: AttentionPayload }>();

/** Pasa el informe a su forma JSON (fechas como texto ISO). PURO. */
export function toAttentionPayload(report: AttentionReport, activity: ActivityReport): AttentionPayload {
  return JSON.parse(JSON.stringify({ ...report, activity })) as AttentionPayload;
}

/** Informe de las conversaciones creadas entre dos días de Buenos Aires, inclusive. */
export async function getAttentionPayload(from: string, to: string, now: Date = new Date()): Promise<AttentionPayload> {
  const key = `${from}|${to}`;
  const ttl = ATTENTION_CACHE_SECONDS * 1000;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < ttl) return hit.payload;

  // Tiempos por parte, para saber dónde se va la carga antes de proponer índices. Sin datos de clientes.
  const t0 = Date.now();
  const ms: Record<string, number> = {};
  const timed = async <T,>(name: string, p: Promise<T>): Promise<T> => { const r = await p; ms[name] = Date.now() - t0; return r; };
  const [{ versions }, rows, activity] = await Promise.all([
    timed("config", loadConfigVersions()), timed("entradas", loadEntryRows(from, to)), timed("actividad", loadActivityReport(from, to)),
  ]);
  const t1 = Date.now();
  const payload = toAttentionPayload(buildAttentionReport(rows, { now, from, to, versions }), activity);
  console.log("[call-center/metrics/attention] ms", JSON.stringify({ ...ms, calculo: Date.now() - t1, total: Date.now() - t0, filas: rows.length, dias: payload.calendar.length }));

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= ttl) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}
