/**
 * Tipos de los conteos de la cola. Archivo aparte, sin imports de servidor, para que la
 * pantalla (cliente) los use sin arrastrar Prisma.
 */

export type AgeBucket = "lt24h" | "h24to72" | "d3to30" | "gt30d";

export interface QueueGroupCounts {
  total: number;
  /** Nunca tuvieron respuesta de una persona. */
  neverHuman: number;
  /** Tuvieron respuesta y esperan la siguiente. */
  awaitingNext: number;
  /** Sin respuesta de una persona y con pedido completo en el bot. */
  completedOrders: number;
  /** Candidatos a agradecimiento (subconjunto de neverHuman; no se restan de total). */
  thanksCandidates: number;
  /** Sin salida del bot registrada. */
  noBotExit: number;
  byAge: Record<AgeBucket, number>;
  /** Inicio de la espera más vieja del grupo. */
  oldestWaitStart: Date | null;
}
