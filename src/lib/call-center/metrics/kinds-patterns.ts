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

// ── Evidencia de un pedido confirmado ────────────────────────────────────────────────
// Elegir "Pedir medicamentos" no alcanza, y que el operador informe un precio tampoco: hay
// casos con precio informado y sin venta. Un pedido confirmado necesita que el operador lo
// dé por tomado (número de control, aviso de retiro, salida del envío) o evidencia de pago.

/** El operador confirma el pedido: número de control, aviso de retiro, salida del envío, o datos para pagar. */
export const ORDER_CONFIRMED_OPERATOR =
  "n[uú]mero de control|ya (puede|pueden|pod[eé]s|podr[ií]a) pasar a (buscar|retirar)|pasar a (retirar|buscar) (su|tu|el) pedido|confirmamos para retirar|podr[aá] retirar" +
  "|ya (est[aá]|se encuentra) (listo|disponible|preparado)|\\msale (hoy|ma[nñ]ana)\\M|en camino|ser[aá] entregado|entrega(mos)? (hoy|ma[nñ]ana)|\\m(cadete|moto|repartidor)\\M" +
  "|link de pago|\\malias\\M|\\mcbu\\M";
/** El cliente dice que pagó o manda el comprobante. */
export const PAYMENT_CUSTOMER = "ya (pagu[eé]|abon[eé]|transfer[ií])|comprobante|te (paso|env[ií]o) el pago";

/**
 * Receta digital de cualquier plataforma (Meducar, receto, drapp, misrx, qbitos…): el mensaje
 * armado "Quiero hacer un pedido. Tengo esta receta…" o "quiero realizar un pedido sobre esta
 * receta", sin mirar el dominio del enlace.
 */
export const PRESCRIPTION_ORDER = "quiero (hacer|realizar) un pedido[^|]{0,40}receta";

// ── Pedido no concretado ─────────────────────────────────────────────────────────────

/** Venta perdida, por lo que dice el cliente en cualquier momento: ya lo compró, ya fue, cancela. */
export const SALE_LOST_CUSTOMER =
  "\\mya\\M[^|]{0,25}(compr|fui\\M|consegu)|\\m(lo|la) compr[eé]\\M|acabo de comprar|\\mcancel(o|ó|ar|en|amos)\\M|fue alguien|otra farmacia|ya no (lo|la|los|las) necesito";

/** El operador avisa que no hay stock o que falta del laboratorio. */
export const OPERATOR_NO_STOCK =
  "no (cuenta|cuentan|contamos|tenemos|disponemos)( con)? stock|sin stock|\\men falta\\M|(falta|demora) (por parte )?del laboratorio|\\mfaltante\\M";

/**
 * El operador deriva al cliente a comprar en la sucursal: no hay personal de pedidos, o desde
 * esa sucursal no se hacen envíos ni retiros.
 */
export const OPERATOR_DERIVED =
  "no cuenta con personal|no hay personal|no ofrece servicio de env[ií]o|no (se )?(hacen|realizan|realiza|hacemos|realizamos) (env[ií]os|retiros|pedidos)" +
  "|compra de forma presencial|no podemos tomar el pedido|acercarte a comprar|dirigirse a la farmacia";

// ── Subtipos de consulta, sobre el texto libre del cliente ───────────────────────────
export const CONSULT_PRICE = "precio|cu[aá]nto (sale|cuesta|est[aá]|vale)|\\mvalor\\M|\\mcosto\\M";
export const CONSULT_STOCK = "tienen|ten[eé]s|tendr[aá]n|\\mhay\\M|stock|disponib|consigu";
export const CONSULT_HOURS = "horario|abren|cierran|abierto|direcci[oó]n|sucursal|d[oó]nde queda";
export const CONSULT_COVERAGE = "obra social|prepaga|\\mpami\\M|\\mosde\\M|cobertura|descuento|cubre";
export const CONSULT_PAYMENT = "tarjeta|cuotas|transferencia|mercado ?pago|efectivo|d[eé]bito|cr[eé]dito";
export const CONSULT_ONLINE_STORE = "p[aá]gina|\\mweb\\M|online";
export const CONSULT_SERVICES = "vacun|inyec|\\maplica(n|r|ci[oó]n|ciones)\\M|tomar la presi[oó]n|\\m(test|hisopado)\\M";

/** Un mensaje que es solo un saludo, un agradecimiento o un sí/no: no tiene contenido. */
export const EMPTY_MESSAGE =
  "^[^[:alnum:]]*((gracias+|much[ií]simas|muchas|mil|grax|gcs|genial|perfecto|listo|dale|oka?y?|okey|buen[ií]simo|b[aá]rbaro|igualmente|saludos|de acuerdo|excelente|muy amable|a vos|a ustedes|hola+|buen[oa]s?|d[ií]as?|tardes|noches|qu[eé] tal|c[oó]mo (est[aá]n?|and[aá]n?|va)|todo bien|s[ií]+|no)[^[:alnum:]]*)*$";
