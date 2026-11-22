/**
 * Tipos de la respuesta del bloque "Atención y demoras". Archivo aparte, solo con imports
 * de tipos, para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { AttentionReport } from "./attention";
import type { ActivityReport } from "./activity";

/** Segundos de caché del informe en el servidor, por período. */
export const ATTENTION_CACHE_SECONDS = 60;

/** Un valor tal como llega por JSON: las fechas son texto ISO. */
export type Jsonified<T> =
  T extends Date ? string
  : T extends ReadonlyArray<infer U> ? Jsonified<U>[]
  : T extends object ? { [K in keyof T]: Jsonified<T[K]> }
  : T;

/**
 * El informe del período. No lleva filas por conversación: solo totales y resumen por día.
 * Trae dos poblaciones distintas: lo de AttentionReport es POR ENTRADA (conversaciones creadas
 * en el período) y `activity` es POR ACTIVIDAD (lo que pasó cada día, se haya creado cuando
 * se haya creado la conversación).
 */
export type AttentionPayload = Jsonified<AttentionReport & { activity: ActivityReport }>;
