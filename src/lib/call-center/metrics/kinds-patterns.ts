/**
 * Patrones de la clasificación por tipo de conversación. Nivel DETECTADO: recorrido del bot y
 * palabras. Cuando llegue el tipo de cierre de Emozion, esa será la fuente principal y esto
 * queda como respaldo.
 *
 * Las expresiones son de Postgres y se evalúan dentro de la consulta: el texto no sale de
 * la base.
 */

/** Opciones del bot que el cliente elige tocando un botón: no son texto libre. */
export const BOT_BUTTONS = [
  "Pedir medicamentos", "Obra Social", "CABA", "Retiro en sucursal", "A mi domicilio", "Particular",
  "Tienda online", "Asesor", "Suc. y Horarios", "Volver al menú",
] as const;

export const BUTTON_PICKUP = "Retiro en sucursal";
export const BUTTON_HOME = "A mi domicilio";
export const BUTTON_HOURS = "Suc. y Horarios";
export const BUTTON_ONLINE_STORE = "Tienda online";
export const BUTTON_ADVISOR = "Asesor";

// ── Evidencia de un pedido real ──────────────────────────────────────────────────────
// Elegir "Pedir medicamentos" no alcanza: muchos clientes entran por ahí para preguntar un
// precio. Un pedido necesita evidencia posterior de pago o de coordinación.

/** El operador habla del pago. */
export const PAYMENT_OPERATOR = "link de pago|mercado ?pago|transferencia|\\malias\\M|\\mcbu\\M|abonar|total (es|ser[ií]a|a pagar|queda)|comprobante";
/** El cliente dice que pagó o manda el comprobante. */
export const PAYMENT_CUSTOMER = "ya (pagu[eé]|abon[eé]|transfer[ií])|comprobante|te (paso|env[ií]o) el pago";
/** El operador coordina el retiro o el envío. */
export const COORDINATION_OPERATOR =
  "ya (est[aá]|se encuentra) (listo|disponible|preparado)|pasar a retirar|puede retirar|se lo enviamos|en camino|ser[aá] entregado|entrega(mos)? (hoy|ma[nñ]ana)|\\m(cadete|moto|repartidor|token)\\M|tu pedido";

// ── Subtipos de consulta, sobre el texto libre del cliente ───────────────────────────
export const CONSULT_PRICE = "precio|cu[aá]nto (sale|cuesta|est[aá]|vale)|\\mvalor\\M|\\mcosto\\M";
export const CONSULT_STOCK = "tienen|ten[eé]s|tendr[aá]n|\\mhay\\M|stock|disponib|consigu";
export const CONSULT_HOURS = "horario|abren|cierran|abierto|direcci[oó]n|sucursal|d[oó]nde queda";
export const CONSULT_COVERAGE = "obra social|prepaga|\\mpami\\M|\\mosde\\M|cobertura|descuento|cubre";
export const CONSULT_PAYMENT = "tarjeta|cuotas|transferencia|mercado ?pago|efectivo|d[eé]bito|cr[eé]dito";
export const CONSULT_ONLINE_STORE = "p[aá]gina|\\mweb\\M|online";

/** Un mensaje que es solo un saludo, un agradecimiento o un sí/no: no tiene contenido. */
export const EMPTY_MESSAGE =
  "^[^[:alnum:]]*((gracias+|much[ií]simas|muchas|mil|grax|gcs|genial|perfecto|listo|dale|oka?y?|okey|buen[ií]simo|b[aá]rbaro|igualmente|saludos|de acuerdo|excelente|muy amable|a vos|a ustedes|hola+|buen[oa]s?|d[ií]as?|tardes|noches|qu[eé] tal|c[oó]mo (est[aá]n?|and[aá]n?|va)|todo bien|s[ií]+|no)[^[:alnum:]]*)*$";
