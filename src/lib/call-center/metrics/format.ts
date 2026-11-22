/**
 * Formato de duraciones y porcentajes para las pantallas de métricas. PURO, sin imports:
 * lo usan componentes de cliente.
 */

/** 95 → "1 h 35 min"; 3000 → "2 d 2 h". Redondea al minuto. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  if (hours < 48) return `${hours} h ${m % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Duración que puede faltar: un dato faltante nunca se muestra como cero. */
export function formatMinutesOrMissing(minutes: number | null | undefined, missing = "Sin datos"): string {
  return minutes == null ? missing : formatMinutes(minutes);
}

/** 0.2449 → "24 %". null (sin denominador) → texto de dato faltante. */
export function formatRatio(ratio: number | null | undefined, missing = "Sin datos"): string {
  return ratio == null ? missing : `${Math.round(ratio * 100)} %`;
}

/** "2026-03-01" → "01/03". */
export function formatShortDay(dayISO: string): string {
  const [, m, d] = dayISO.split("-");
  return `${d}/${m}`;
}
