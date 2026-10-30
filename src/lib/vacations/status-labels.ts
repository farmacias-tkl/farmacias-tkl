// =============================================================================
// Nombres de los estados de una solicitud de vacaciones: una sola tabla para
// toda la pantalla (leyenda del calendario, filtro de estados, tarjetas de la
// lista, detalle e historial).
//
// PENDING_RRHH solo aparece en la leyenda y el filtro si el paso de RRHH está
// activo (VACATIONS_RRHH_STEP=true; la pantalla lo recibe de /api/vacations/metrics).
// En el detalle y el historial se muestra siempre que una solicitud lo tenga.
// =============================================================================

import type { VacationStatus } from "@prisma/client";

export const VACATION_STATUS_LABEL: Record<VacationStatus, string> = {
  PENDING_SUPERVISOR: "Solicitada",
  PENDING_RRHH:       "Pendiente de RRHH",
  APPROVED:           "Aprobada",
  REJECTED:           "Rechazada",
  CANCELLED:          "Cancelada",
};

const ORDER: VacationStatus[] = ["PENDING_SUPERVISOR", "PENDING_RRHH", "APPROVED", "REJECTED", "CANCELLED"];

/** Estados para la leyenda y el filtro, en orden. */
export function visibleVacationStatuses(rrhhStep: boolean): VacationStatus[] {
  return ORDER.filter((s) => rrhhStep || s !== "PENDING_RRHH");
}

export function vacationStatusLabel(status: string): string {
  return VACATION_STATUS_LABEL[status as VacationStatus] ?? status;
}
