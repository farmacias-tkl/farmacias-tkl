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

// ── Cerradas sin responder ───────────────────────────────────────────────────────────
// Criterio de DETECCIÓN sobre el último bloque del cliente (los mensajes posteriores a la
// última respuesta pública de un operador; si nunca hubo, todos los del cliente). Las
// expresiones son de Postgres y se evalúan dentro de la consulta: el texto no sale de la base.

/** Días hacia atrás del último mensaje del cliente que entran en "Cerradas sin responder". */
export const CLOSED_UNANSWERED_DAYS = 7;

/** Tipos de adjunto que cuentan como "receta o comprobante". Contacto y ubicación no. */
export const BLOCK_ATTACHMENT_MEDIA_TYPES = ["image", "file", "audio", "video"] as const;

/** Respuestas informativas del bot (sucursales y horarios, tienda online): la consulta ya fue contestada. */
export const BOT_INFO_ANSWER_LIKES = ["Estas son nuestras sucursales%", "¡Genial! Podés visitar nuestra tienda online%"] as const;

/** No es un cliente: proveedores, currículums y publicidad. */
export const NOT_CUSTOMER_REGEX =
  "\\m(cv|curr[ií]culum|fabricantes?|distribuidor(es)?|proveedor(es)?|responsable de compras|ofrecer(te|les)?|temu\\.com)\\M";

/** El cliente avisa que ya compró o ya fue: va a ventas perdidas detectadas, no a esta lista. */
export const ALREADY_BOUGHT_REGEX =
  "(\\mya\\M[^|]{0,25}(compr|fui\\M|vine\\M|pas[eé] a|consegu|atendieron))|(compr[eé] en)|(acabo de comprar)|(cancel[oó] la compra)";

/** Una consulta o pregunta. No toma los reclamos escritos sin signo de pregunta ni estas palabras. */
export const QUESTION_REGEX =
  "\\?|¿|\\m(cu[aá]nto|precio|tienen|ten[eé]s|me podr[ií]an|podr[ií]as?|cu[aá]ndo|necesito|quisiera|consulta|falt[oó]|confirmar|stock)\\M";

/** Frase con la que llega un pedido con receta desde Meducar. */
export const ORDER_REQUEST_REGEX = "quiero realizar un pedido";
