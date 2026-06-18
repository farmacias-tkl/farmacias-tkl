/**
 * Formateo de fechas para mostrar al usuario, con zona horaria explícita Argentina.
 *
 * Regla de uso (NO mezclar):
 *  - formatDateTimeAR → INSTANTES / timestamps con hora real (mensajes, auditoría,
 *    eventos, cambios de estado, createdAt/updatedAt, sentAt). Convierte a hora de
 *    Argentina. Necesario porque el render server-side (Vercel = UTC) sin zona explícita
 *    mostraría UTC.
 *  - formatDateAR → FECHAS CALENDARIO / date-only (vacaciones inicio/fin, fechas de
 *    ingreso, deadlines). NO aplica conversión de hora local: eso correría el día hacia
 *    atrás para valores guardados como medianoche UTC (@db.Date). Muestra el día tal cual.
 *
 * Zona IANA: America/Argentina/Buenos_Aires (no hardcodear offsets).
 */

const TZ_AR = "America/Argentina/Buenos_Aires";

/**
 * Para INSTANTES con hora real (DateTime). Devuelve fecha + hora en zona Argentina.
 * "—" si el valor es nulo/ausente/ inválido.
 */
export function formatDateTimeAR(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: TZ_AR,
  }).format(parsed);
}

/**
 * Para FECHAS CALENDARIO / date-only (no instantes). Muestra solo día/mes/año SIN
 * convertir a hora local: usa timeZone UTC para preservar el día calendario tal como se
 * guardó (las fechas date-only se persisten a medianoche UTC; aplicarles hora Argentina
 * las correría un día hacia atrás). NO usar sobre timestamps con hora — para eso está
 * formatDateTimeAR.
 *
 * (Definida para fijar el patrón correcto; no se usa en el fix de Call Center.)
 */
export function formatDateAR(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}
