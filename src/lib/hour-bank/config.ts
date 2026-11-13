// =============================================================================
// Configuración del banco de horas.
//
// Minutos adeudados de Asistencia (TimeEvent): DESACTIVADO por defecto, a la
// espera de la decisión de Dirección. Con HOUR_BANK_TIME_EVENTS=true en el
// entorno (Vercel) y redeploy, los minutos que una persona todavía debe
// compensar (llegadas tarde o retiros resueltos "a compensar", menos lo ya
// compensado) restan de su saldo del banco. No se escribe ningún movimiento:
// se calcula al mostrar el saldo, así se puede activar o desactivar sin tocar
// datos. Lo enviado a descuento de sueldo, lo condonado y lo cancelado no resta.
// =============================================================================

export function isTimeEventLinkEnabled(): boolean {
  return process.env.HOUR_BANK_TIME_EVENTS === "true";
}
