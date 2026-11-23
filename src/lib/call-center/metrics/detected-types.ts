/**
 * Tipos de la respuesta del bloque "Reclamos y pérdidas". Archivo aparte, sin imports de
 * servidor, para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { ClaimGroup, ClaimMotive } from "./detected-patterns";

export type { ClaimGroup, ClaimMotive } from "./detected-patterns";

/** Segundos de caché del informe en el servidor, por período. */
export const DETECTED_CACHE_SECONDS = 60;

/**
 * Qué dijo el cliente sobre la compra. Son tres cosas distintas y no se suman:
 *  - ELSEWHERE: pérdida confirmada (otra farmacia, otro lado, cancela);
 *  - UNKNOWN_PLACE: compró por su cuenta y no dice dónde;
 *  - AT_TKL: compró en una sucursal de TKL o ya retiró el pedido. No es una pérdida;
 *  - DERIVED_IN_HOURS: el operador lo derivó a comprar en la sucursal dentro del horario de
 *    pedidos de esa sucursal, y la conversación no tiene evidencia de venta. Posible pérdida.
 */
export type SaleKind = "ELSEWHERE" | "UNKNOWN_PLACE" | "AT_TKL" | "DERIVED_IN_HOURS";

export const SALE_KINDS: readonly SaleKind[] = ["ELSEWHERE", "UNKNOWN_PLACE", "AT_TKL", "DERIVED_IN_HOURS"];

/** Un caso de la lista: id interno (para el enlace), fecha, motivo y estado. Sin texto del cliente. */
export interface DetectedCase<M extends string = string> {
  conversationId: string;
  /** ISO. Cuándo entró la conversación. */
  createdAt: string;
  motive: M;
  open: boolean;
}

export interface DetectedBucket<M extends string> {
  motive: M;
  count: number;
}

export interface DetectedSection<M extends string> {
  /** Conversaciones distintas del grupo: una con dos motivos cuenta una vez acá y una vez en cada motivo. */
  conversations: number;
  byMotive: DetectedBucket<M>[];
  /** De la más nueva a la más vieja, con tope de filas. Una fila por conversación y motivo. */
  cases: DetectedCase<M>[];
  /** Filas antes del tope. */
  casesTotal: number;
}

export interface DetectedPayload {
  generatedAt: string;
  from: string;
  to: string;
  /** Conversaciones creadas en el período: sobre cuántas se buscó. */
  conversations: number;
  sales: DetectedSection<SaleKind>;
  claims: Record<ClaimGroup, DetectedSection<ClaimMotive>>;
}
