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

// ── Evidencia de un pedido confirmado ────────────────────────────────────────────────
// Elegir "Pedir medicamentos" no alcanza, y que el operador informe un precio tampoco: hay
// casos con precio informado y sin venta. Un pedido confirmado necesita que el operador lo
// dé por tomado (número de control, aviso de retiro, salida del envío) o evidencia de pago.

/** El operador confirma el pedido: número de control, aviso de retiro, salida del envío, o datos para pagar. */
export const ORDER_CONFIRMED_OPERATOR =
  "n[uú]mero de control|ya (puede|pueden|pod[eé]s|podr[ií]a) pasar a (buscar|retirar)|pasar a (retirar|buscar) (su|tu|el) pedido|confirmamos para retirar|podr[aá] retirar" +
  "|ya (est[aá]|se encuentra) (listo|disponible|preparado)|\\msale (hoy|ma[nñ]ana)\\M|en camino|ser[aá] entregado|entrega(mos)? (hoy|ma[nñ]ana)|\\m(cadete|moto|repartidor)\\M" +
  "|link de pago|\\m(alias|cbu|cvu)\\M" +
  // Avisos de retiro o de envío.
  "|podr[aá]s retirar|pued(e|en|es) pasar a (buscar|retirar)|c[oó]digo de retiro|a nombre de [^|]{0,40}[0-9]{3,}" +
  "|el env[ií]o lo realizamos|realizando el env[ií]o|receta fue validada|comunicamos al cadete|\\m(lo |la |los |las )?agendamos\\M";
/**
 * Cierre fijo de venta. Es la evidencia más débil: si es la única, no vale cuando el operador
 * dejó el pedido en espera en algún momento de la conversación.
 */
export const ORDER_CLOSING_OPERATOR = "gracias por confiar en farmacias tkl";

/**
 * Evidencia firme: número de control o pago recibido. Con esto el pedido sigue confirmado
 * aunque después el operador escriba que queda a la espera.
 */
export const ORDER_STRONG_OPERATOR = "n[uú]mero de control|(recibimos|registramos|acreditamos) (el|tu|su) pago|pago (fue |ya fue )?(recibido|acreditado|registrado)";

/**
 * El operador deja el pedido en espera. Anula el cierre "gracias por confiar" solo cuando ese
 * cierre es la única evidencia de venta.
 */
export const OPERATOR_WAITING = "aguardamos|quedamos atentos|esperamos (tu|su) contacto";

/** El operador cancela el pedido. Anula siempre, salvo que haya evidencia firme. */
export const OPERATOR_CANCELLED = "cancel(amos|ar|aremos|ado) el pedido";

/**
 * El pedido queda postergado: la receta todavía no es válida o hay que esperar una fecha.
 * Es un pedido sin confirmar, no una venta perdida.
 */
export const OPERATOR_POSTPONED = "receta (es )?v[aá]lida (desde|a partir)|hay que esperar hasta|aguardamos (tu|su) contacto m[aá]s adelante";

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
  "vine directo|no (lo |la |los |las )?prepar(en|es)|buscar[eé] (en )?otra farmacia|\\mya\\M[^|]{0,25}(compr|fui\\M|consegu)|\\m(lo|la) compr[eé]\\M|acabo de comprar|\\mcancel(o|ó|ar|en|amos)\\M|fue alguien|otra farmacia|ya no (lo|la|los|las) necesito";

/** Venta perdida confirmada: lo compró en otra farmacia o en otro lado, o cancela. Sin esto, "no dice dónde". */
export const SALE_LOST_ELSEWHERE = "no (lo |la |los |las )?prepar(en|es)|otra farmacia|otro lado|\\mcancel(o|ó|ar|en|amos)\\M|ya no (lo|la|los|las) necesito";

/**
 * Menciona a TKL en el mismo mensaje en que dice que compró: es una venta presencial de TKL,
 * no una venta perdida. Se completa con los nombres de las sucursales (branchNamesRegex).
 */
export const BOUGHT_AT_TKL = "\\m(tkl|sucursal|mostrador|local|ah[ií])\\M|vine directo";

/** Venta perdida probable: todavía no compró, avisa que va a buscar en otra farmacia. */
export const SALE_LOST_PROBABLE = "(voy|vamos|iba) a (ver|buscar|probar|fijarme|consultar)[^|]{0,40}(otra farmacia|otro lado)";

/** No es una pérdida: se confundió de receta o de producto. */
export const NOT_A_LOSS = "me confund[ií]|me equivoqu[eé]|en (verdad|realidad) no necesito";

/** El cliente avisa que pasa a pagar o a comprar por la sucursal. Cuenta si el operador ofreció stock o reserva. */
export const CUSTOMER_GOES_TO_BRANCH = "voy a pagar(lo|la)?|paso a (pagar|comprar|buscar)|pas[oó] a (pagar|comprar)(lo|la)?";
/** El operador ofreció stock o una reserva en una sucursal. */
export const OPERATOR_OFFERED_STOCK = "(tenemos|contamos con|cuenta con|hay|tiene) stock|\\mreserv";

/** El cliente pregunta por un pago o un pedido ya hecho, o avisa que espera algo para seguir. */
export const FOLLOW_UP_CUSTOMER =
  "ya est[aá] en camino|cu[aá]ndo llega|a qu[eé] hora llega|el se[nñ]or de la moto|se pudo registrar el pago|pudieron (registrar|ver) (el|mi) pago|\\m(s[ií]+|ya) (me )?lleg[oó]|lleg[oó] el pedido|espero el contacto|quedo a la espera|estoy esperando (una|la) receta";

/** El cliente avisa que al final no necesita nada. */
export const CUSTOMER_DECLINED = "^[^[:alnum:]]*(en nada|nada|no necesito nada|no,? nada)[^[:alnum:]]*(,? ?(muchas )?gracias)?[^[:alnum:]]*$";

/** Un agradecimiento largo sin otro contenido: empieza agradeciendo y no pregunta nada. */
export const THANKS_MESSAGE = "^[^[:alnum:]]*((hola|buen[oa]s?( d[ií]as| tardes| noches)?)[^[:alnum:]]+)?(much[ií]simas |muchas |mil )?gracias";

/** El operador avisa que no hay stock o que falta del laboratorio. */
export const OPERATOR_NO_STOCK =
  "no (cuenta|cuentan|contamos|tenemos|disponemos)( con)? stock|sin stock|\\men falta\\M|(falta|demora) (por parte )?del laboratorio|\\mfaltante\\M";

/**
 * El operador deriva al cliente a comprar en la sucursal: no hay personal de pedidos, o desde
 * esa sucursal no se hacen envíos ni retiros.
 */
/** El medicamento solo se vende en forma presencial en una sucursal. */
export const OPERATOR_IN_PERSON_ONLY = "(se )?vende [uú]nicamente|[uú]nicamente se vende|(solo|s[oó]lo|solamente) se vende (de forma presencial|en la sucursal)|venta (es )?(solo |[uú]nicamente )?presencial";

export const OPERATOR_DERIVED =
  "no cuenta con personal|no hay personal|no ofrece servicio de env[ií]o|no (se )?(hacen|realizan|realiza|hacemos|realizamos) (env[ií]os|retiros|pedidos)" +
  "|compra de forma presencial|no podemos tomar el pedido|acercarte a comprar|dirigirse a la farmacia";

/** El aviso de derivación habla de envíos: se compara con el horario de envíos de la sucursal. */
export const OPERATOR_DERIVED_DELIVERY = "env[ií]o";

/**
 * No es una derivación: no se hacen envíos a esa dirección o a esa zona y, en el mismo
 * mensaje, se ofrece el retiro. Es una zona sin cobertura, no una sucursal que no toma pedidos.
 */
export const OPERATOR_NO_COVERAGE = "a (la|esa|esta|su|tu|dicha) (direcci[oó]n|zona)";
export const OPERATOR_OFFERS_PICKUP = "retir";

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

// ── Motivos de contacto ──────────────────────────────────────────────────────────────

export const BUTTON_ORDER = "Pedir medicamentos";
export const BUTTON_ADVISOR = "Asesor";
export const BUTTON_HOURS = "Suc. y Horarios";
export const BUTTON_ONLINE_STORE = "Tienda online";

/** El cliente pide en texto libre: quiere pedir, comprar, encargar o que le envíen o preparen algo. */
export const ORDER_FREE_TEXT =
  "\\m(quiero|quisiera|querr[ií]a|necesito|necesitar[ií]a|preciso)\\M[^|]{0,30}\\m(pedir|comprar|encargar|reservar|(hacer|realizar) (un|el) pedido)\\M" +
  "|\\m(hacer|realizar|pasar|dejar) (un|el|mi) pedido\\M|\\mme (podr[ií]an?|pueden|pod[eé]s) (enviar|mandar|preparar|traer|reservar)\\M" +
  "|\\m(les|te|le) (encargo|pido)\\M|\\mpara (encargar|pedir)\\M";

/**
 * Seguimiento de un pedido en curso: pregunta cuándo o a qué hora llega, o dónde está. Es una
 * pregunta, no una queja: "no llegó en el horario acordado" sí es un reclamo.
 */
export const FOLLOW_UP_ARRIVAL =
  "cu[aá]ndo (me )?(lo |la |los |las )?(llega|traen|env[ií]an|mandan)|a qu[eé] hora (me )?(lo |la |los |las )?(llega|traen|env[ií]an|mandan|pasan)" +
  "|(saber|avisaron|avisan|avisen) si lleg[oó]|d[oó]nde est[aá] (mi|el) pedido|(estado|seguimiento) de(l| mi) pedido" +
  // Cuánto tarda el aviso o el pedido, y avisos al repartidor: es un pedido en curso.
  "|cu[aá]nto (tarda|demora)[^|]{0,40}(aviso|pedido|env[ií]o|retir)|aviso para retirar|no tengo timbre|no (anda|funciona) el timbre|que me llamen? (cuando|al) lleg";

/** Consulta de stock dicha en pasado o en condicional ("tenían", "tendrían"): solo para motivos. */
export const CONSULT_STOCK_PAST = "\\mten[ií]an\\M|\\mtendr[ií]an\\M";

/** Plataforma de la receta, por el dominio del enlace. El enlace nunca se abre. */
export const PRESCRIPTION_PLATFORM_CAPTURE = "https?://[^[:space:]/]*(qbitos|meducar|misrx|receto|drapp|rcta|osde)\\.";
