/**
 * Patrones de "Reclamos y pérdidas". Todo lo que sale de acá es nivel DETECTADO: son
 * palabras en los mensajes del cliente, candidatos para revisar y no hechos confirmados.
 *
 * Las expresiones son de Postgres (\m y \M son límites de palabra) y se evalúan dentro de la
 * consulta, mensaje por mensaje: el texto no sale de la base. Cada entrada es
 * `all` (tienen que cumplirse todas en el MISMO mensaje) y `none` (no puede cumplirse ninguna).
 */

export interface MessagePattern {
  all: readonly string[];
  none?: readonly string[];
}

/** Lugares de las sucursales que los clientes nombran y que no son el nombre de la sucursal. */
export const EXTRA_TKL_PLACES = ["callao", "congreso", "marcelo t"] as const;

/** Sucursales que no son un lugar donde se compra. */
export const NON_STORE_BRANCHES = ["call center"] as const;

const VOWELS: Record<string, string> = { a: "[aá]", e: "[eé]", i: "[ií]", o: "[oó]", u: "[uúü]" };

/**
 * Alternativa de expresión regular con los nombres de las sucursales, sin distinguir
 * acentos. PURO. Los nombres salen de la tabla de sucursales, no del código.
 */
export function branchNamesRegex(names: readonly string[]): string {
  const clean = [...names, ...EXTRA_TKL_PLACES]
    .map((n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim())
    .filter((n) => n.length >= 3 && !(NON_STORE_BRANCHES as readonly string[]).includes(n));
  const parts = [...new Set(clean)].map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[aeiou]/g, (v) => VOWELS[v]).replace(/\s+/g, " "));
  return parts.join("|");
}

// ── Ventas ───────────────────────────────────────────────────────────────────────────

/** Compró o consiguió el producto, sin importar dónde. */
const BOUGHT =
  "(\\mya\\M[^|]{0,25}(compr|fui\\M|consegu))|(\\mya\\M (lo |la |los |las )?pas[eé] (a comprar|por))|acabo de comprar|\\m(lo|la) compr[eé]\\M|\\mya vine\\M";

/** Pérdida confirmada: otra farmacia, otro lado (hablando de comprar o pedir), o cancela. */
export const SALE_ELSEWHERE: readonly MessagePattern[] = [
  { all: ["otra farmacia|\\m(cancelo|cancel[oó]|cancelar|cancelen|anulen|anular|anulo)\\M[^|]{0,20}\\m(pedido|compra)\\M|ya no (lo|la|los|las) necesito"] },
  { all: ["otro lado", "compr|consegu|ped[ií]|busc"] },
];

/** Ya retiró el pedido: es una venta de TKL. */
export const SALE_PICKED_UP: readonly MessagePattern[] = [
  { all: ["\\mya\\M (lo |la |los |las )?(retir[eé]|pas[eé] a retirar|busqu[eé])\\M"] },
];

export const SALE_BOUGHT: readonly MessagePattern[] = [{ all: [BOUGHT] }];

/** Menciona TKL: se completa con los nombres de las sucursales (branchNamesRegex). */
export const TKL_MENTION = "\\m(tkl|sucursal|mostrador|local|ah[ií])\\M|(en|a) la farmacia|me facturan aqu[ií]";

/** Compró y en el mismo mensaje menciona TKL o una sucursal. */
export function saleBoughtAtTkl(branchRegex: string): readonly MessagePattern[] {
  return [{ all: [BOUGHT, branchRegex ? `${TKL_MENTION}|\\m(${branchRegex})\\M` : TKL_MENTION] }];
}

// ── Reclamos ─────────────────────────────────────────────────────────────────────────

/**
 * UNA sola regla de reclamo para todo el tablero ("Reclamos y pérdidas", "Ahora", "Resultado
 * de las conversaciones" y "Motivos de contacto"): el cliente habla de un problema PROPIO con
 * un pedido, un pago, una entrega o la atención. No son reclamos, y por eso no están acá:
 * "en falta" o "no tienen stock" (es una consulta de stock), "reintegro", "descuento" o
 * "cobertura" dentro de una pregunta de precio, ni "demora" o "tarda" sueltos (preguntar
 * cuánto tarda es seguimiento). Hasta el 24/11 "Reclamos y pérdidas" usaba una regla más
 * amplia, de palabras de queja sueltas: marcaba 157 conversaciones en 30 días donde esta
 * regla marca 73.
 */
export const CLAIM_PATTERNS = {
  // Call Center
  // Espera sin respuesta, dicha como queja.
  DEMORA: [{ all: ["sigo esperando|hace (rato|horas|d[ií]as) (que )?(espero|escrib|mand)|nadie (me )?(responde|contesta|atiende)|no me (responden|contestan|respondieron|contestaron|atienden)"] }],
  // Solo cuando el cliente dice que no tiene novedades. Preguntar cuándo llega, o dónde está el
  // pedido, es seguimiento y no reclamo.
  SIN_NOVEDADES: [{ all: ["sin novedad|no tengo novedad|pedido[^|]{0,40}novedad"] }],
  INCORRECTO: [
    // Lo que llegó está mal o incompleto.
    { all: ["\\mincorrect[oa]s?\\M|me (mandaron|enviaron|trajeron|dieron) (otro|otra|mal|de menos)|no es (lo|el|la) que ped[ií]|\\mfalt[oó] (un|una|el|la|los|las)\\M|vino (mal|otro|otra|rot)|se olvidaron|falta[^|]{0,30}en (el|mi) pedido"] },
    // "Equivocado" cuenta salvo que el error sea del propio cliente ("me había equivocado").
    { all: ["\\mequivocad[oa]s?\\M"], none: ["\\mme (hab[ií]a |he )?equivo(qu|c)|\\m(estaba|estoy|estuve) equivocad|\\mmi error\\M"] },
    // "Vencido" cuenta como producto recibido en mal estado: no si es una pregunta, ni si se
    // habla de una receta, una orden o un descuento (ahí es una consulta).
    { all: ["\\mvencid[oa]s?\\M"], none: ["\\?", "\\m(recetas?|[oó]rden(es)?|descuentos?|cup[oó]n|promo|promoci[oó]n|autorizaci[oó]n)\\M"] },
  ],
  // Factura: solo si viene con una queja. Un pedido común de factura no es un reclamo.
  FACTURA: [{ all: ["\\mfactura", "no me lleg|todav[ií]a|sigo esperando|\\mfalta\\M|novedad|a[uú]n no|nunca"] }],
  // Le cobraron de más o no le aplicaron el descuento. Preguntar por un precio o una cobertura no cuenta.
  PRECIO: [{ all: ["me cobraron (de )?m[aá]s|me cobraron mal|no me (hicieron|aplicaron|tomaron) el descuento"] }],
  // Cobro doble o devolución que no llega. Pedir una devolución o preguntar por un reintegro no cuenta.
  PAGO: [{ all: ["cobraron dos veces|doble cobro|no me (lleg[oóa]|hicieron|devolvieron|acreditaron) (la |el )?(devoluci[oó]n|reintegro|reembolso|plata|dinero)|me debitaron"] }],
  TRATO: [{ all: ["mala atenci[oó]n|maltrat|mal trato|falta de respeto|verg[uü]enza|p[eé]sim|desastre|inacept|una burla"] }],
  OTROS: [{ all: ["\\m(reclamo|queja|denuncia|defensa del consumidor|libro de quejas)\\M"] }],
  // Envíos: solo con queja. Mandar una moto propia o coordinar un horario no es un reclamo.
  ENVIO_NO_LLEGO: [
    {
      all: [
        "(no (me )?(lleg[oó]|llegaron)|sigo esperando|nunca (vino|lleg[oó])|todav[ií]a no (lleg[oó]|vino|lo recib))",
        "\\m(pedido|env[ií]o|medicamentos?|remedios?|moto|cadete|repartidor|delivery)\\M",
      ],
      none: ["mail|correo|confirmaci[oó]n|n[uú]mero de pedido|no llego a|si lleg[oó]"],
    },
    { all: ["\\mnunca vino\\M"] },
  ],
  // Lo mandaron mal o el repartidor no entregó. Que el cliente pase otra dirección, programe
  // un envío o mande su propia moto no es un problema con la entrega.
  ENVIO_ENTREGA: [
    { all: ["(mandaron|enviaron|llevaron|mand[oó]|envi[oó])[^|]{0,40}\\ma otr[oa] (direcci[oó]n|domicilio)"] },
    { all: ["(domicilio|direcci[oó]n) (anterior|viej[oa]|equivocad[oa])"] },
    {
      all: ["(repartidor|cadete|moto|delivery)[^|]{0,40}(se fue|no (vino|pas[oó]))"],
      none: ["mando una moto|mandar una moto|moto de uber|mi moto|una moto a retirar"],
    },
  ],
  // Tienda online. Tiene que nombrar el mail, la confirmación o el número de pedido: "no me
  // llegó nada" solo no alcanza.
  WEB_SIN_CONFIRMACION: [{
    all: ["no (me )?lleg[oó][^|]{0,30}(mail|correo|confirmaci[oó]n|n[uú]mero de pedido)|(mail|correo|confirmaci[oó]n)[^|]{0,30}(no (me )?lleg|nunca (me )?lleg)|no tengo (el )?n[uú]mero de pedido|solo tengo el pago"],
    none: ["no llego a"],
  }],
  WEB_PAGINA: [{
    all: ["(p[aá]gina|\\mweb\\M|sitio|tienda online|carrito)[^|]{0,60}(no me deja|error|no (puedo|pude|funciona|anda|carga))|no (puedo|pude) pagar|cobraron dos veces|doble cobro|cup[oó]n[^|]{0,30}no (funciona|anda|aplica)"],
  }],
} as const satisfies Record<string, readonly MessagePattern[]>;

/**
 * "No me llegó nada", "aún no llegó" o "ayer no llegó", sin decir qué. Solo cuenta como envío que no llegó si en la misma
 * conversación el cliente eligió envío a domicilio y no habla de un mail o una confirmación.
 */
export const NOTHING_ARRIVED: readonly MessagePattern[] = [{
  all: ["no (me )?lleg[oó] (nada|ning[uú]n)|(a[uú]n|todav[ií]a|ayer) no (me )?lleg[oó]"],
  none: ["mail|correo|confirmaci[oó]n|n[uú]mero de pedido|no llego a"],
}];

/** Opción del bot con la que el cliente elige envío a domicilio. */
export const CUSTOMER_HOME_DELIVERY_OPTION = "A mi domicilio";

export type ClaimMotive = keyof typeof CLAIM_PATTERNS;

export type ClaimGroup = "CALL_CENTER" | "ENVIOS" | "TIENDA_ONLINE";

export const CLAIM_GROUP_OF: Record<ClaimMotive, ClaimGroup> = {
  DEMORA: "CALL_CENTER", SIN_NOVEDADES: "CALL_CENTER", INCORRECTO: "CALL_CENTER", FACTURA: "CALL_CENTER",
  PRECIO: "CALL_CENTER", PAGO: "CALL_CENTER", TRATO: "CALL_CENTER", OTROS: "CALL_CENTER",
  ENVIO_NO_LLEGO: "ENVIOS", ENVIO_ENTREGA: "ENVIOS",
  WEB_SIN_CONFIRMACION: "TIENDA_ONLINE", WEB_PAGINA: "TIENDA_ONLINE",
};

export const CLAIM_MOTIVES = Object.keys(CLAIM_PATTERNS) as ClaimMotive[];

/** Texto de cada motivo de reclamo. */
export const CLAIM_LABELS: Record<ClaimMotive, string> = {
  DEMORA: "Espera sin respuesta",
  SIN_NOVEDADES: "Pedido sin novedades",
  INCORRECTO: "Producto o cantidad incorrectos",
  FACTURA: "Factura",
  PRECIO: "Cobro de más o descuento no aplicado",
  PAGO: "Cobro doble o devolución que no llega",
  TRATO: "Trato",
  OTROS: "Otros",
  ENVIO_NO_LLEGO: "No llegó el pedido",
  ENVIO_ENTREGA: "Problema con la entrega",
  WEB_SIN_CONFIRMACION: "Pagó y no recibió la confirmación",
  WEB_PAGINA: "Problemas con la página",
};

/**
 * Todos los patrones de reclamo juntos, más "no me llegó nada": lo que usa "Motivos de
 * contacto" para saber si una conversación tiene un reclamo. Es la misma regla de arriba.
 */
export const OWN_PROBLEM_CLAIM_PATTERNS: readonly MessagePattern[] = [
  ...(Object.values(CLAIM_PATTERNS) as ReadonlyArray<readonly MessagePattern[]>).flat(),
  ...NOTHING_ARRIVED,
];
