/**
 * Tipos de la respuesta del bloque "Operadores". Archivo aparte, solo con imports de tipos,
 * para que la pantalla (cliente) los use sin arrastrar Prisma.
 */
import type { AccountsReport } from "./accounts";
import type { Jsonified } from "./attention-types";

/** Segundos de caché del informe en el servidor, por período. */
export const ACCOUNTS_CACHE_SECONDS = 60;

/**
 * El informe del período, por CUENTA de Emozion (una cuenta no es una persona). No lleva
 * filas por conversación ni por mensaje: solo totales por cuenta y del equipo.
 */
export type AccountsPayload = Jsonified<AccountsReport & {
  period: { from: string; to: string };
  /** Hay una versión de la configuración vigente hoy: de ahí salen alias y estado de las cuentas. */
  hasConfig: boolean;
  /** Las conversaciones resueltas creadas más de estos días antes del período no se recorren. */
  lookbackDays: number;
}>;
