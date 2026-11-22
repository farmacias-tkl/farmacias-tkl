/**
 * Tipos de la respuesta del bloque "Tipos". Archivo aparte, sin imports de servidor, para
 * que la pantalla (cliente) los use sin arrastrar Prisma.
 */

/** Segundos de caché del informe en el servidor, por período. */
export const KINDS_CACHE_SECONDS = 60;

/**
 * Tipo principal: uno por conversación, con prioridad reclamo > pedido > pedido sin
 * confirmar > consulta.
 *  - PEDIDO: Meducar, o evidencia de pago o de coordinación de retiro o envío;
 *  - PEDIDO_SIN_CONFIRMAR: completó el recorrido del bot pero no hay pago ni coordinación.
 *    Va aparte y no suma como pedido;
 *  - SIN_CONTENIDO: solo saludos, agradecimientos o botones. Va aparte y no entra en los porcentajes;
 *  - SIN_CLASIFICAR: visible, para revisar el criterio.
 */
export type MainKind = "RECLAMO" | "PEDIDO" | "PEDIDO_SIN_CONFIRMAR" | "CONSULTA" | "SIN_CONTENIDO" | "SIN_CLASIFICAR";

export const MAIN_KINDS: readonly MainKind[] = ["RECLAMO", "PEDIDO", "PEDIDO_SIN_CONFIRMAR", "CONSULTA", "SIN_CONTENIDO", "SIN_CLASIFICAR"];

export type OrderKind = "DOMICILIO" | "RETIRO" | "MEDUCAR" | "SIN_MODALIDAD";
export type ConsultKind = "PRECIO" | "STOCK" | "HORARIOS" | "COBERTURA" | "PAGO" | "TIENDA_ONLINE" | "OTRAS";

export const ORDER_KINDS: readonly OrderKind[] = ["DOMICILIO", "RETIRO", "MEDUCAR", "SIN_MODALIDAD"];
export const CONSULT_KINDS: readonly ConsultKind[] = ["PRECIO", "STOCK", "HORARIOS", "COBERTURA", "PAGO", "TIENDA_ONLINE", "OTRAS"];

export interface ConversationKind {
  main: MainKind;
  /** Subtipo de pedido o de consulta; null en los demás. */
  sub: OrderKind | ConsultKind | null;
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
  consults: Record<ConsultKind, number>;
  /** Por día de Buenos Aires de entrada, en orden. */
  byDay: Array<{ day: string } & KindCounts>;
  /** Por hora de Buenos Aires de entrada: 24 posiciones. */
  byHour: KindCounts[];
}
