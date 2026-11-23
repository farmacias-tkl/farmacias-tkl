/**
 * Tipos de la respuesta del bloque "Tipos". Archivo aparte, sin imports de servidor, para
 * que la pantalla (cliente) los use sin arrastrar Prisma.
 */

/** Segundos de caché del informe en el servidor, por período. */
export const KINDS_CACHE_SECONDS = 60;

/**
 * Tipo principal: uno por conversación. Prioridad: reclamo > pedido confirmado > venta
 * perdida > no se pudo tomar > pedido (receta digital) > pedido sin confirmar > saludo >
 * consulta > sin motivo claro.
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
export type MainKind = "RECLAMO" | "PEDIDO" | "VENTA_PERDIDA" | "NO_SE_PUDO_TOMAR" | "PEDIDO_SIN_CONFIRMAR" | "CONSULTA" | "SALUDO" | "SIN_MOTIVO";

export const MAIN_KINDS: readonly MainKind[] = ["RECLAMO", "PEDIDO", "VENTA_PERDIDA", "NO_SE_PUDO_TOMAR", "PEDIDO_SIN_CONFIRMAR", "CONSULTA", "SALUDO", "SIN_MOTIVO"];

export type OrderKind = "DOMICILIO" | "RETIRO" | "RECETA" | "SIN_MODALIDAD";
/** Por qué no se pudo tomar el pedido. */
export type NoTakeKind = "SIN_STOCK" | "DERIVADO_PRESENCIAL";
export type ConsultKind = "SERVICIOS" | "PRECIO" | "STOCK" | "HORARIOS" | "COBERTURA" | "PAGO" | "TIENDA_ONLINE" | "OTRAS";

export const ORDER_KINDS: readonly OrderKind[] = ["DOMICILIO", "RETIRO", "RECETA", "SIN_MODALIDAD"];
export const NO_TAKE_KINDS: readonly NoTakeKind[] = ["SIN_STOCK", "DERIVADO_PRESENCIAL"];
export const CONSULT_KINDS: readonly ConsultKind[] = ["PRECIO", "STOCK", "HORARIOS", "COBERTURA", "PAGO", "TIENDA_ONLINE", "SERVICIOS", "OTRAS"];

export interface ConversationKind {
  main: MainKind;
  /** Subtipo de pedido, de "no se pudo tomar" o de consulta; null en los demás. */
  sub: OrderKind | NoTakeKind | ConsultKind | null;
}

export type KindCounts = Record<MainKind, number>;

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
  noTake: Record<NoTakeKind, number>;
  consults: Record<ConsultKind, number>;
  /** Por día de Buenos Aires de entrada, en orden. */
  byDay: Array<{ day: string } & KindCounts>;
  /** Por hora de Buenos Aires de entrada: 24 posiciones. */
  byHour: KindCounts[];
}
