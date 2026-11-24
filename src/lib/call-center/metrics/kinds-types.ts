/**
 * Tipos de la respuesta del bloque "Tipos". Archivo aparte, sin imports de servidor, para
 * que la pantalla (cliente) los use sin arrastrar Prisma.
 */

/** Segundos de caché del informe en el servidor, por período. */
export const KINDS_CACHE_SECONDS = 60;

/**
 * Tipo principal: uno por conversación. Prioridad: reclamo > pedido confirmado > compró en
 * TKL / venta perdida > no se pudo tomar > pedido (receta digital) > pedido sin confirmar >
 * consulta > seguimiento > saludo > sin motivo claro.
 *  - COMPRO_TKL: el cliente dice que lo compró en una sucursal TKL. Es una venta presencial,
 *    no una venta perdida;
 *  - SEGUIMIENTO: pregunta por un pago o un pedido ya hecho, o avisa que espera algo;
 *  - PEDIDO: el operador lo confirma (número de control, aviso de retiro, salida del envío)
 *    o hay evidencia de pago; o el cliente mandó una receta digital para pedir;
 *  - VENTA_PERDIDA: el cliente dice que ya lo compró, que ya fue o que cancela;
 *  - NO_SE_PUDO_TOMAR: quería pedir y el operador avisó que no hay stock o lo derivó a
 *    comprar en la sucursal;
 *  - PEDIDO_SIN_CONFIRMAR: completó el recorrido del bot y no hay nada de lo anterior: el
 *    cliente no respondió o quedó en volver;
 *  - SALUDO: solo saludos, agradecimientos o botones. No entra en los porcentajes;
 *  - SIN_MOTIVO: no hay evidencia de qué quería. Que un operador haya respondido no alcanza
 *    para llamarla consulta.
 */
export type MainKind =
  | "RECLAMO" | "PEDIDO" | "COMPRO_TKL" | "VENTA_PERDIDA" | "NO_SE_PUDO_TOMAR" | "PEDIDO_SIN_CONFIRMAR" | "CONSULTA" | "SEGUIMIENTO" | "SALUDO" | "SIN_MOTIVO";

export const MAIN_KINDS: readonly MainKind[] = [
  "RECLAMO", "PEDIDO", "COMPRO_TKL", "VENTA_PERDIDA", "NO_SE_PUDO_TOMAR", "PEDIDO_SIN_CONFIRMAR", "CONSULTA", "SEGUIMIENTO", "SALUDO", "SIN_MOTIVO",
];

/** Venta perdida: confirmada (otra farmacia, otro lado o cancela), probable (va a buscar en otra farmacia) o sin decir dónde compró. */
export type LostKind = "OTRO_LADO" | "PROBABLE" | "NO_DICE_DONDE";
export const LOST_KINDS: readonly LostKind[] = ["OTRO_LADO", "PROBABLE", "NO_DICE_DONDE"];

export type OrderKind = "DOMICILIO" | "RETIRO" | "RECETA" | "SIN_MODALIDAD";
/** Por qué no se pudo tomar el pedido. */
export type NoTakeKind = "SIN_STOCK" | "DERIVADO_PRESENCIAL" | "DERIVADO_EN_HORARIO" | "DERIVADO_MEDICAMENTO";
export type ConsultKind = "SERVICIOS" | "PRECIO" | "STOCK" | "HORARIOS" | "COBERTURA" | "PAGO" | "TIENDA_ONLINE" | "OTRAS";

export const ORDER_KINDS: readonly OrderKind[] = ["DOMICILIO", "RETIRO", "RECETA", "SIN_MODALIDAD"];
export const NO_TAKE_KINDS: readonly NoTakeKind[] = ["SIN_STOCK", "DERIVADO_PRESENCIAL", "DERIVADO_EN_HORARIO", "DERIVADO_MEDICAMENTO"];
export const CONSULT_KINDS: readonly ConsultKind[] = ["PRECIO", "STOCK", "HORARIOS", "COBERTURA", "PAGO", "TIENDA_ONLINE", "SERVICIOS", "OTRAS"];

export interface ConversationKind {
  main: MainKind;
  /** Subtipo de pedido, de "no se pudo tomar" o de consulta; null en los demás. */
  sub: OrderKind | LostKind | NoTakeKind | ConsultKind | null;
}

export type KindCounts = Record<MainKind, number>;

/** Resultado de cierre que eligió el operador al resolver (ver config-schema.ts). */
export type ClosureOutcome = "VENTA" | "CONSULTA" | "PEDIDO_NO_CONCRETADO" | "NO_LO_TRABAJAMOS" | "SIN_STOCK" | "SOLO_BOT" | "OTRO";
export const CLOSURE_OUTCOME_LIST: readonly ClosureOutcome[] = ["VENTA", "CONSULTA", "PEDIDO_NO_CONCRETADO", "NO_LO_TRABAJAMOS", "SIN_STOCK", "SOLO_BOT", "OTRO"];

/**
 * Qué tipos detectados cuentan como coincidencia con cada resultado del operador. "OTRO" no
 * se compara. Es una equivalencia aproximada: las dos clasificaciones no usan las mismas
 * categorías, por eso se muestra también el cruce completo.
 */
export const OUTCOME_MATCHES: Record<ClosureOutcome, readonly MainKind[]> = {
  VENTA: ["PEDIDO"],
  CONSULTA: ["CONSULTA", "SEGUIMIENTO"],
  PEDIDO_NO_CONCRETADO: ["VENTA_PERDIDA", "PEDIDO_SIN_CONFIRMAR", "COMPRO_TKL"],
  // Los dos motivos de "no se pudo vender" se comparan con el mismo tipo detectado.
  NO_LO_TRABAJAMOS: ["NO_SE_PUDO_TOMAR"],
  SIN_STOCK: ["NO_SE_PUDO_TOMAR"],
  SOLO_BOT: ["SALUDO"],
  OTRO: [],
};

/** Lo que confirmó el operador con la etiqueta de cierre, y cuánto coincide con lo detectado. */
export interface OperatorConfirmed {
  /** Conversaciones del período con etiqueta de cierre. */
  confirmed: number;
  byOutcome: Record<ClosureOutcome, number>;
  /** Por resultado del operador, en qué tipo las clasificó Tipos. */
  matrix: Record<ClosureOutcome, KindCounts>;
  /** Conversaciones comparables (sin "otro") y cuántas coinciden según OUTCOME_MATCHES. */
  compared: number;
  agree: number;
}

export interface KindsPayload {
  generatedAt: string;
  from: string;
  to: string;
  /** De dónde sale la clasificación. Hoy siempre DETECTADO; MEDIDO cuando llegue el tipo de cierre de Emozion. */
  source: "DETECTADO" | "MEDIDO";
  /** Conversaciones creadas en el período. */
  conversations: number;
  total: KindCounts;
  orders: Record<OrderKind, number>;
  lost: Record<LostKind, number>;
  noTake: Record<NoTakeKind, number>;
  /** De los derivados a compra presencial, cuántos no tienen la sucursal identificada: no se sabe si fue dentro o fuera del horario. */
  derivedWithoutBranch: number;
  consults: Record<ConsultKind, number>;
  /** Consultas con al menos una respuesta pública de un operador. */
  consultsAnswered: number;
  /** null si la configuración vigente no define etiquetas de cierre. */
  operator: OperatorConfirmed | null;
  /** Por día de Buenos Aires de entrada, en orden. */
  byDay: Array<{ day: string } & KindCounts>;
  /** Por hora de Buenos Aires de entrada: 24 posiciones. */
  byHour: KindCounts[];
  /** "Motivos de contacto": para qué escribió el cliente. Lo agrega el servicio; el informe puro de tipos no lo trae. */
  motives?: import("./motives-types").MotivesPayload;
}
