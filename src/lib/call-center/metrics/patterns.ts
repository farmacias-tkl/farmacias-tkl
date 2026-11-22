/**
 * Textos del bot y umbrales que usan las métricas para DETECTAR situaciones. Todo lo que
 * sale de acá es nivel "Detectado": depende de textos que Emozion puede cambiar.
 *
 * Son textos fijos del bot (plantillas), no datos de clientes.
 */

/** Comienzo del mensaje final del bot cuando el pedido quedó completo y pasa a una persona. */
export const BOT_ORDER_COMPLETE_PREFIX = "✅ ¡Listo!";

/** Patrón LIKE de SQL para ese mensaje. */
export const BOT_ORDER_COMPLETE_LIKE = `${BOT_ORDER_COMPLETE_PREFIX}%`;

/**
 * Candidato a agradecimiento posterior a un cierre. El criterio SOLO selecciona candidatos
 * para revisar: no excluye la conversación de ningún conteo.
 */
export const THANKS_CANDIDATE = {
  /** El cliente tuvo otra conversación resuelta dentro de estas horas previas. */
  previousResolvedWithinHours: 24,
  /** Caracteres escritos por el cliente en toda la conversación, como máximo. */
  maxCustomerChars: 40,
} as const;

/** Ventana por defecto de la LISTA de la cola. Es un filtro de pantalla, no del conteo. */
export const QUEUE_LIST_DEFAULT_HOURS = 72;

export interface ThanksCandidateInput {
  hasHumanResponse: boolean;
  previousResolvedRecently: boolean;
  customerChars: number;
  customerSentMedia: boolean;
  customerSentLink: boolean;
  botOrderComplete: boolean;
}

/**
 * ¿Es candidato a agradecimiento? Quedan AFUERA (y por lo tanto como pendientes comunes)
 * las conversaciones con adjunto o mensaje sin texto, con un enlace, o con pedido completo
 * en el bot, aunque sean cortas: pueden ser una receta, una confirmación o un pedido.
 */
export function isThanksCandidate(c: ThanksCandidateInput): boolean {
  return (
    !c.hasHumanResponse &&
    c.previousResolvedRecently &&
    c.customerChars <= THANKS_CANDIDATE.maxCustomerChars &&
    !c.customerSentMedia &&
    !c.customerSentLink &&
    !c.botOrderComplete
  );
}
