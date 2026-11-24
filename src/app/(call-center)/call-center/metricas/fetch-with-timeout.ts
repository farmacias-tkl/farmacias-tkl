/** Tope de espera de un pedido de datos de las métricas. Pasado ese tiempo se muestra el error con "Reintentar". */
export const FETCH_TIMEOUT_MS = 45_000;

/**
 * fetch con tope de tiempo: si el servidor no responde, corta y lanza. Cada pestaña ya
 * muestra su error con "Reintentar" cuando el pedido falla, así que nunca queda en
 * "Cargando…" para siempre.
 */
export async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
