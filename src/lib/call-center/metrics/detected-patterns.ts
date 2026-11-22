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

export const CLAIM_PATTERNS = {
  // Call Center
  DEMORA: [{ all: ["\\m(demora(n|ron)?|tarda(n|ron)?|sigo esperando|hace (rato|horas|d[ií]as) (que )?(espero|escrib|mand)|nadie (me )?(responde|contesta|atiende)|no me (responden|contestan|respondieron|contestaron|atienden))\\M"] }],
  SIN_NOVEDADES: [{ all: ["(pedido[^|]{0,40}(novedad|d[oó]nde est))|sin novedad|no tengo novedad|cu[aá]ndo (llega|me lo traen|lo env[ií]an|lo mandan)"] }],
  INCORRECTO: [{ all: ["\\m(equivocad[oa]s?|incorrect[oa]s?|vencid[oa]s?)\\M|me (mandaron|enviaron|trajeron|dieron) (otro|otra|mal|de menos)|no es (lo|el|la) que ped[ií]|\\mfalt[oó] (un|una|el|la|los|las)\\M|vino (mal|otro|otra|rot)"] }],
  STOCK: [{ all: ["no (hay|tienen|ten[ií]an|queda) stock|sin stock|\\men falta\\M|no (lo|la|los|las) tienen"] }],
  // Factura: solo si viene con una queja. Un pedido común de factura no es un reclamo.
  FACTURA: [{ all: ["\\mfactura", "no me lleg|todav[ií]a|sigo esperando|\\mfalta\\M|novedad|a[uú]n no|nunca"] }],
  PRECIO: [{ all: ["me cobraron (de )?m[aá]s|m[aá]s caro|no me (hicieron|aplicaron|tomaron) el descuento|no (me )?(lo |la )?cubre|\\mcobertura\\M[^|]{0,40}(100|no |deber)|deber[ií]a (ser|salir|tener)"] }],
  PAGO: [{ all: ["\\m(devoluci[oó]n|devolver|devuelvan|reintegro|reembolso|debitaron)\\M"] }],
  TRATO: [{ all: ["mala atenci[oó]n|maltrat|mal trato|falta de respeto|verg[uü]enza|p[eé]sim|desastre|inacept|una burla"] }],
  OTROS: [{ all: ["\\m(reclamo|queja|denuncia|defensa del consumidor|libro de quejas)\\M"] }],
  // Envíos: solo con queja. Mandar una moto propia o coordinar un horario no es un reclamo.
  ENVIO_NO_LLEGO: [{
    all: [
      "(no (me )?(lleg[oó]|llegaron)|sigo esperando|nunca (vino|lleg[oó])|todav[ií]a no (lleg[oó]|vino|lo recib))",
      "\\m(pedido|env[ií]o|medicamentos?|remedios?|moto|cadete|repartidor|delivery)\\M",
    ],
    none: ["mail|correo|confirmaci[oó]n|no llego a"],
  }],
  ENVIO_ENTREGA: [{
    all: ["(repartidor|cadete|moto|delivery|env[ií]o)[^|]{0,60}(se fue|no (vino|pas[oó])|tarde)|(otra|otro) (direcci[oó]n|domicilio)|(domicilio|direcci[oó]n) (anterior|viej[oa]|equivocad[oa])|no me avisaron"],
  }],
  // Tienda online
  WEB_SIN_CONFIRMACION: [{
    all: ["no (me )?lleg[oó][^|]{0,30}(mail|correo|confirmaci[oó]n)|(mail|correo)[^|]{0,30}(no (me )?lleg|nunca (me )?lleg)|no tengo (el )?n[uú]mero de pedido|solo tengo el pago|no (me )?lleg[oó] (nada|ning[uú]n)"],
    none: ["no llego a"],
  }],
  WEB_PAGINA: [{
    all: ["(p[aá]gina|\\mweb\\M|sitio|tienda online|carrito)[^|]{0,60}(no me deja|error|no (puedo|pude|funciona|anda|carga))|no (puedo|pude) pagar|cobraron dos veces|doble cobro|cup[oó]n[^|]{0,30}no (funciona|anda|aplica)"],
  }],
} as const satisfies Record<string, readonly MessagePattern[]>;

export type ClaimMotive = keyof typeof CLAIM_PATTERNS;

export type ClaimGroup = "CALL_CENTER" | "ENVIOS" | "TIENDA_ONLINE";

export const CLAIM_GROUP_OF: Record<ClaimMotive, ClaimGroup> = {
  DEMORA: "CALL_CENTER", SIN_NOVEDADES: "CALL_CENTER", INCORRECTO: "CALL_CENTER", STOCK: "CALL_CENTER", FACTURA: "CALL_CENTER",
  PRECIO: "CALL_CENTER", PAGO: "CALL_CENTER", TRATO: "CALL_CENTER", OTROS: "CALL_CENTER",
  ENVIO_NO_LLEGO: "ENVIOS", ENVIO_ENTREGA: "ENVIOS",
  WEB_SIN_CONFIRMACION: "TIENDA_ONLINE", WEB_PAGINA: "TIENDA_ONLINE",
};

export const CLAIM_MOTIVES = Object.keys(CLAIM_PATTERNS) as ClaimMotive[];
