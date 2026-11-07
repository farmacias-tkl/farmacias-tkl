// =============================================================================
// Qué botones ve cada rol en la ficha de una solicitud, según su estado.
// RRHH (HR) ve todo y no tiene ninguna acción.
//
// supervisor-approve no figura en `actions`: lo maneja el panel de aprobación
// (saldo, advertencias, rotativos), que trae Aprobar / Aprobar igual / Rechazar.
// =============================================================================

import type { UserRole } from "@prisma/client";
import { can } from "@/lib/permissions";

export type VacationActionKind = "supervisor-reject" | "rrhh-approve" | "rrhh-reject" | "cancel" | "undo-approval";

export interface VacationActions {
  showApprovalPanel: boolean;
  canChangeCoverage: boolean;
  actions: VacationActionKind[];
}

export function vacationActionsFor(role: UserRole | undefined, status: string | undefined): VacationActions {
  const actions: VacationActionKind[] = [];
  if (!role || !status) return { showApprovalPanel: false, canChangeCoverage: false, actions };

  const supervisor = can.approveVacation(role);
  if (status === "APPROVED" && supervisor) actions.push("undo-approval");
  if (status === "PENDING_RRHH" && can.confirmVacation(role)) actions.push("rrhh-approve", "rrhh-reject");
  if (status !== "CANCELLED") {
    const canCancel = status === "APPROVED" ? can.cancelApprovedVacation(role) : can.cancelVacation(role);
    if (canCancel) actions.push("cancel");
  }
  return {
    showApprovalPanel: status === "PENDING_SUPERVISOR" && supervisor,
    canChangeCoverage: (status === "APPROVED" || status === "PENDING_RRHH") && supervisor,
    actions,
  };
}
