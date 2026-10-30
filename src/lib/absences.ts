// =============================================================================
// Reglas compartidas de ausencias (cliente y servidor).
// =============================================================================

/**
 * Tipos en los que NO se carga texto libre en reasonDetail ("Observaciones"):
 * licencia médica y por maternidad. No hay lugar para diagnóstico ni motivo
 * médico: la pantalla oculta el campo y la API lo guarda vacío.
 */
export const ABSENCE_TYPES_WITHOUT_REASON = ["MEDICAL_LEAVE", "MATERNITY_LEAVE"] as const;

export function typeAllowsReasonDetail(absenceType: string | null | undefined): boolean {
  return !(ABSENCE_TYPES_WITHOUT_REASON as readonly string[]).includes(absenceType ?? "");
}
