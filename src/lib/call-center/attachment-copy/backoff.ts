/**
 * B6.3-C3 — Backoff de reintento: min(5 min · 3^(n-1), 6 h) ± 20 %.
 * `attempt` = storageAttemptCount ya incrementado por la reserva (1 = primer intento).
 */
const BASE_MS = 5 * 60_000;
const CAP_MS = 6 * 3600_000;
const JITTER = 0.2;

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(BASE_MS * 3 ** (n - 1), CAP_MS);
  const factor = 1 - JITTER + random() * 2 * JITTER; // [0.8, 1.2)
  return Math.round(base * factor);
}
