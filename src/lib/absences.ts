// =============================================================================
// Reglas compartidas de ausencias (cliente y servidor).
// =============================================================================

import { todayAR } from "@/lib/dates/today";
import { utcDay } from "@/lib/personal/dates";

/** Agrega los días totales y si la ausencia incluye hoy (fecha de Argentina). */
export function enrichAbsence<T extends { startDate: Date | string; endDate: Date | string }>(a: T, now: Date = new Date()) {
  const today = todayAR(now);
  const start = utcDay(new Date(a.startDate));
  const end   = utcDay(new Date(a.endDate));
  return {
    ...a,
    totalDays:     Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    isActiveToday: start <= today && today <= end,
  };
}

/**
 * Tipos en los que NO se carga texto libre en reasonDetail ("Observaciones"):
 * licencia médica y por maternidad. No hay lugar para diagnóstico ni motivo
 * médico: la pantalla oculta el campo y la API lo guarda vacío.
 */
export const ABSENCE_TYPES_WITHOUT_REASON = ["MEDICAL_LEAVE", "MATERNITY_LEAVE"] as const;

export function typeAllowsReasonDetail(absenceType: string | null | undefined): boolean {
  return !(ABSENCE_TYPES_WITHOUT_REASON as readonly string[]).includes(absenceType ?? "");
}
