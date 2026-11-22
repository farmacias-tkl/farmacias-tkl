/**
 * Tipos de la respuesta del bloque "Atención y demoras". Archivo aparte, solo con imports
 * de tipos, para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { AttentionReport } from "./attention";
import type { ActivityReport } from "./activity";
import type { NowOwner } from "./now-types";

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

/** Indicadores de "Atención y demoras" que tienen detalle de casos. */
export type AttentionCaseKind = "pending" | "overdue" | "unanswered_same_day";

/** Una conversación del detalle: id interno (para el enlace), horas y etiquetas. Sin teléfono, nombre ni texto. */
export interface AttentionCase {
  conversationId: string;
  createdAt: string;
  /** Desde cuándo corre el reloj: salida del bot o, si no está registrada, creación. */
  clockStart: string;
  /** Primera respuesta de una persona; null si sigue sin respuesta. */
  answeredAt: string | null;
  /** Minutos de reloj desde clockStart hasta la respuesta, o hasta ahora si sigue pendiente. */
  waitMinutes: number;
  /** Minutos hábiles; null si no había configuración vigente ese día. */
  businessMinutes: number | null;
  /** Pasó la meta (respondida tarde o pendiente vencida); null sin configuración. */
  overdue: boolean | null;
  /** Estado actual; null si no se pudo leer. */
  open: boolean | null;
  owner: NowOwner;
  orderComplete: boolean;
  thanksCandidate: boolean;
}

export interface AttentionCasesPayload {
  kind: AttentionCaseKind;
  from: string;
  to: string;
  generatedAt: string;
  /** Casos que cuentan en el indicador, antes del tope de filas. */
  total: number;
  cases: AttentionCase[];
}
