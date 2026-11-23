/**
 * Ventana de atención de WhatsApp. PURO, sin imports de servidor: lo usan las pantallas.
 *
 * Regla de Meta (WhatsApp Business): desde el ÚLTIMO mensaje del cliente hay 24 horas de
 * reloj para responder libremente. Pasado ese plazo la conversación solo se reabre con una
 * plantilla aprobada, y hay que esperar a que el cliente responda.
 *
 *  - Las 24 horas son una regla de Meta, no una decisión del negocio: van como constante.
 *    El aviso previo ("por vencer") sí es configurable (config-schema.ts).
 *  - El reloj es tiempo REAL: corre de noche, los fines de semana y los feriados.
 *  - Cuenta desde el último mensaje del cliente, no desde el inicio del bloque sin responder
 *    ni desde la salida del bot: cada mensaje nuevo del cliente vuelve a abrir la ventana.
 *  - Es independiente del semáforo de la meta, que se mide en minutos hábiles.
 */

/** Horas de la ventana de atención. Regla de Meta: no se configura. */
export const WHATSAPP_WINDOW_HOURS = 24;

const MS_HOUR = 3_600_000;
const MS_MIN = 60_000;

/**
 *  - CERRADA: pasaron más de 24 horas desde el último mensaje del cliente; requiere plantilla.
 *  - POR_VENCER: todavía se puede responder y falta menos que el aviso configurado.
 *  - ABIERTA: se puede responder libremente.
 */
export type WindowState = "CERRADA" | "POR_VENCER" | "ABIERTA";

/** Instante en que se cierra la ventana. */
export function windowClosesAt(lastCustomerAt: Date): Date {
  return new Date(lastCustomerAt.getTime() + WHATSAPP_WINDOW_HOURS * MS_HOUR);
}

/** Minutos que faltan para que se cierre; 0 si ya se cerró. */
export function windowMinutesLeft(lastCustomerAt: Date, now: Date): number {
  return Math.max(0, Math.floor((windowClosesAt(lastCustomerAt).getTime() - now.getTime()) / MS_MIN));
}

export function windowState(lastCustomerAt: Date, now: Date, warningHours: number): WindowState {
  const left = windowClosesAt(lastCustomerAt).getTime() - now.getTime();
  if (left <= 0) return "CERRADA";
  return left < warningHours * MS_HOUR ? "POR_VENCER" : "ABIERTA";
}

/**
 * ¿La ventana se cerró sin respuesta? `answeredAt` es la respuesta pública que siguió a ese
 * último mensaje del cliente (null si no hubo). Una respuesta que llega después de las 24
 * horas ya necesitó una plantilla: la ventana se había cerrado.
 */
export function windowClosedUnanswered(lastCustomerAt: Date, answeredAt: Date | null, now: Date): boolean {
  return (answeredAt ?? now).getTime() > windowClosesAt(lastCustomerAt).getTime();
}
