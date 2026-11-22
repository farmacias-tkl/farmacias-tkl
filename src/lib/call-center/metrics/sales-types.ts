/**
 * Tipos de la respuesta del bloque "Ventas SIAF". Archivo aparte, solo con imports de tipos,
 * para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { SalesDayLine, SalesReport } from "./sales";

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
export interface SalesPayload extends Omit<SalesReport, "byDay"> {
  generatedAt: string;
  byDay: SalesPayloadDay[];
  /** Pedidos de los días que tienen comprobantes del Call Center. */
  orders: number;
  receiptsPer100Orders: number | null;
  /** Hay una versión de la configuración vigente hoy. */
  hasConfig: boolean;
}
