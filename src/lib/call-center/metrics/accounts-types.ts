/**
 * Tipos de la respuesta del bloque "Operadores". Archivo aparte, solo con imports de tipos,
 * para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { AccountsReport, PeriodClosures } from "./accounts";
import type { Jsonified } from "./attention-types";

/** Segundos de caché del informe en el servidor, por período. */
export const ACCOUNTS_CACHE_SECONDS = 60;

/**
 * El informe del período, por CUENTA de Emozion (una cuenta no es una persona). No lleva
 * filas por conversación ni por mensaje: solo totales por cuenta y del equipo.
 */
export type AccountsPayload = Jsonified<Omit<AccountsReport, "closures"> & {
  closures: Omit<PeriodClosures, "byAccount"> | null;
  period: { from: string; to: string };
  /** Hay una versión de la configuración vigente hoy: de ahí salen alias y estado de las cuentas. */
  hasConfig: boolean;
  /** Las conversaciones resueltas creadas más de estos días antes del período no se recorren. */
  lookbackDays: number;
}>;

/** Indicadores de "Operadores" que tienen detalle de casos. */
export type OperatorCaseKind = "slow_followups" | "unanswered_blocks" | "several_accounts" | "first_response_later_day";

/** Una conversación del detalle: id interno (para el enlace), una hora y nombres de cuenta. Sin teléfono, nombre ni texto. */
export interface OperatorCase {
  conversationId: string;
  /** Inicio del bloque del cliente, primer mensaje de operador del período o salida del bot, según el indicador. */
  at: string;
  /** Minutos de reloj de la espera; null cuando el indicador no mide una espera. */
  waitMinutes: number | null;
  /** Cuentas (alias o "Cuenta N"). Vacío cuando el caso no se atribuye a nadie. */
  accounts: string[];
  /** Pedido completo en el bot. */
  order: boolean;
}

export interface OperatorCasesPayload {
  kind: OperatorCaseKind;
  from: string;
  to: string;
  /** Cuenta a la que se limitó la lista; null: todo el equipo. */
  account: string | null;
  generatedAt: string;
  /** Casos que cuentan en el indicador, antes del tope de filas. */
  total: number;
  cases: OperatorCase[];
}
