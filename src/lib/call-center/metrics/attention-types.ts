/**
 * Tipos de la respuesta del bloque "Atención y demoras". Archivo aparte, solo con imports
 * de tipos, para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { AttentionReport } from "./attention";

/** Segundos de caché del informe en el servidor, por período. */
export const ATTENTION_CACHE_SECONDS = 60;

/** Un valor tal como llega por JSON: las fechas son texto ISO. */
export type Jsonified<T> =
  T extends Date ? string
  : T extends ReadonlyArray<infer U> ? Jsonified<U>[]
  : T extends object ? { [K in keyof T]: Jsonified<T[K]> }
  : T;

/** El informe del período. No lleva filas por conversación: solo totales y resumen por día. */
export type AttentionPayload = Jsonified<AttentionReport>;
