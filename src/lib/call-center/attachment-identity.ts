/**
 * Identidad de adjuntos Emozion — helper COMPARTIDO entre el mapper (B2.1) y la captura de
 * origen (B6.3). Fuente única de cómo se deriva `sourceExternalId`, para que el mapa
 * sourceExternalId → url de la captura nunca diverja de la key de idempotencia del adjunto.
 *
 * PURO: sin Prisma, sin red.
 */

/**
 * ¿id de adjunto usable? Por TIPO, NO truthiness (id 0 es válido).
 *  - number: finito (rechaza NaN/Infinity/-Infinity).
 *  - string: no vacío tras trim (rechaza "" y solo-whitespace).
 */
export function isUsableAttachmentId(id: unknown): id is number | string {
  if (typeof id === "number") return Number.isFinite(id);
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * sourceExternalId estable (no índice): "emozion-attachment:<id>". El id string se trimmea →
 * no generar keys de idempotencia divergentes por whitespace.
 */
export function emozionAttachmentSourceExternalId(id: number | string): string {
  const rawId = typeof id === "string" ? id.trim() : id;
  return `emozion-attachment:${rawId}`;
}
