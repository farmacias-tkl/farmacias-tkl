// =============================================================================
// Configuración del circuito de vacaciones.
//
// Paso de RRHH (adenda B): DESACTIVADO por defecto. La aprobación final es la
// de supervisión: supervisor-approve pasa PENDING_SUPERVISOR → APPROVED y
// descuenta el saldo.
//
// Para volver a activarlo: VACATIONS_RRHH_STEP=true en el entorno (Vercel) y
// redeploy. Con el paso activo, supervisor-approve pasa a PENDING_RRHH (con la
// cobertura elegida) y rrhh-approve hace la aprobación final y descuenta el
// saldo. Los estados y las rutas de RRHH no se borraron.
// =============================================================================

export function isRrhhStepEnabled(): boolean {
  return process.env.VACATIONS_RRHH_STEP === "true";
}
