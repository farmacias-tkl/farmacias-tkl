// =============================================================================
// Fechas para el Dashboard Ejecutivo en TZ Argentina (UTC-3, sin DST).
//
// Compatible con Prisma @db.Date: devolvemos Date a medianoche UTC del día ART
// (los campos @db.Date se almacenan como midnight UTC del día declarado).
//
// Único punto de verdad — no usar new Date() / setHours(0,0,0,0) en el
// dashboard ejecutivo: eso usa la TZ del servidor (UTC en Vercel) y rompe a
// la noche ART (cuando es 23:00 ART = 02:00 UTC del día siguiente).
// =============================================================================

const ART_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Hoy a medianoche UTC del día ART (UTC-3). */
export function getArtToday(): Date {
  const artMs = Date.now() - ART_OFFSET_MS;
  const art   = new Date(artMs);
  return new Date(Date.UTC(art.getUTCFullYear(), art.getUTCMonth(), art.getUTCDate()));
}

/**
 * Parsea "YYYY-MM-DD" a medianoche UTC del día declarado. Validación estricta:
 * rechaza formato incorrecto y fechas inexistentes (ej. 2026-02-30).
 *
 * Devuelve null si el input no es válido.
 */
export function parseArtDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y  = Number(m[1]);
  const mo = Number(m[2]);
  const d  = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth()    !== mo - 1 ||
    date.getUTCDate()     !== d
  ) {
    return null;
  }
  return date;
}

/** Date → "YYYY-MM-DD" usando componentes UTC (compatible con @db.Date). */
export function toArtIsoDate(d: Date): string {
  const y  = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** ¿Esa fecha es estrictamente futura respecto a hoy ART? */
export function isFutureArtDate(d: Date): boolean {
  return d.getTime() > getArtToday().getTime();
}
