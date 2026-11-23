/**
 * Tipos de la respuesta del bloque "Ventas SIAF". Archivo aparte, solo con imports de tipos,
 * para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { SalesDayLine, SalesOperatorLine, SalesReport } from "./sales";

/** Segundos de caché del informe en el servidor, por período. */
export const SALES_CACHE_SECONDS = 60;

export interface SalesPayloadDay extends SalesDayLine {
  /** Conversaciones de tipo pedido (pedido en el bot o receta de Meducar) creadas ese día. */
  orders: number;
  /** Comprobantes cada 100 pedidos: relación de volúmenes. null sin pedidos. */
  receiptsPer100Orders: number | null;
}

/**
 * Comprobantes de SIAF de los vendedores del Call Center en un período. Lleva el código y el
 * nombre del vendedor tal como los trae SIAF: por eso la ruta tiene su propio gate y cada
 * vista queda registrada.
 */
export interface SalesPayloadOperator extends SalesOperatorLine {
  /**
   * Conversaciones atendidas por esa cuenta en el mismo período, de la pestaña Operadores.
   * null si la ficha no tiene cuenta asociada o si no se pudo calcular.
   */
  conversations: number | null;
}

export interface SalesPayload extends Omit<SalesReport, "byDay" | "byOperator"> {
  generatedAt: string;
  byDay: SalesPayloadDay[];
  byOperator: SalesPayloadOperator[];
  /**
   * Pedidos de los días del período que tienen ventas de SIAF cargadas y configuración
   * vigente: los dos lados de la relación cubren los mismos días.
   */
  orders: number;
  /** Cantidad de esos días. */
  relationDays: number;
  /** Último día con ventas de SIAF cargadas, en toda la base. null si no hay ninguno. */
  siafLastDay: string | null;
  /** El último día cargado es anterior a ayer: la sincronización tiene más de un día de atraso. */
  siafDelayed: boolean;
  /** Días del período posteriores al último cargado: sin datos todavía, no cero. No entran en los totales. */
  daysNotLoaded: string[];
  receiptsPer100Orders: number | null;
  /** Hay una versión de la configuración vigente hoy. */
  hasConfig: boolean;
}
