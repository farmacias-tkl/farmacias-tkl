// =============================================================================
// Alta de una solicitud de vacaciones: datos de la fila y de la auditoría.
//
// Una sola definición para POST /api/vacations y para la carga en lote
// (scripts/load-vacation-requests.ts): mismos snapshots, mismo estado
// inicial (PENDING_SUPERVISOR) y mismas advertencias guardadas en
// conflictLevel / conflictReasons. No descuenta saldo: eso pasa al aprobar.
// =============================================================================

import type { Prisma } from "@prisma/client";
import type { ValidationResult } from "./rules";

export interface CreatableEmployee {
  id: string;
  firstName: string;
  lastName: string;
  positionId: string;
  position: { name: string };
  currentBranchId: string;
  currentBranch: { name: string };
}

export function vacationRequestCreateData(p: {
  employee: CreatableEmployee;
  startDate: Date;
  endDate: Date;
  requesterNote: string | null;
  validation: ValidationResult;
  requestedByUserId: string;
}): Prisma.VacationRequestUncheckedCreateInput {
  const { employee: e, validation: v } = p;
  return {
    employeeId: e.id,
    branchId:   e.currentBranchId,
    positionId: e.positionId,
    employeeNameSnapshot: `${e.firstName} ${e.lastName}`,
    branchNameSnapshot:   e.currentBranch.name,
    positionNameSnapshot: e.position.name,
    shiftLabel: null,
    startDate:  p.startDate,
    endDate:    p.endDate,
    daysCount:  v.calculatedDays,
    status:     "PENDING_SUPERVISOR",
    requestedByUserId: p.requestedByUserId,
    requesterNote: p.requesterNote,
    conflictLevel:   v.conflictLevel,
    conflictReasons: (v.warnings.length
      ? { warnings: v.warnings, ruleResults: v.ruleResults }
      : { ruleResults: v.ruleResults }) as unknown as Prisma.InputJsonValue,
  };
}

export function vacationCreatedAuditDetail(
  employee: CreatableEmployee,
  startDate: Date,
  endDate: Date,
  validation: ValidationResult,
): Prisma.InputJsonValue {
  return {
    employee:  `${employee.firstName} ${employee.lastName}`,
    branch:    employee.currentBranch.name,
    position:  employee.position.name,
    startDate: startDate.toISOString().slice(0, 10),
    endDate:   endDate.toISOString().slice(0, 10),
    days:      validation.calculatedDays,
    conflictLevel: validation.conflictLevel,
  };
}
