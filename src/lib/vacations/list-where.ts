// =============================================================================
// Filtros de solicitudes de vacaciones, los mismos para la lista, el calendario
// y el detalle del día. Las fechas las agrega cada uno.
//
//   branchId, employeeId, status, pendingOnly, q (nombre), kpi,
//   withoutCoverage (aprobadas sin rotativo),
//   withWarnings (aprobadas con "Aprobar igual").
//
// BRANCH_MANAGER: forzado a su sucursal. Sin sucursal devuelve null (no ve nada).
// =============================================================================

import type { Prisma } from "@prisma/client";
import { isVacationKpi, kpiWhere } from "./kpis";

export function vacationFilterWhere(
  sp: URLSearchParams,
  user: { role: string; branchId?: string | null },
): Prisma.VacationRequestWhereInput | null {
  const where: Prisma.VacationRequestWhereInput = {};

  if (user.role === "BRANCH_MANAGER") {
    if (!user.branchId) return null;
    where.branchId = user.branchId;
  } else {
    const branchId = sp.get("branchId");
    if (branchId) where.branchId = branchId;
  }

  const employeeId = sp.get("employeeId");
  const status = sp.get("status");
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status as Prisma.VacationRequestWhereInput["status"];
  if (sp.get("pendingOnly") === "true") where.status = { in: ["PENDING_SUPERVISOR", "PENDING_RRHH"] };
  if (sp.get("withoutCoverage") === "true") where.withoutCoverage = true;
  if (sp.get("withWarnings") === "true") where.approvedWithWarnings = true;

  const kpi = sp.get("kpi");
  if (isVacationKpi(kpi)) where.AND = [kpiWhere(kpi)];

  const q = sp.get("q")?.trim();
  if (q) where.employeeNameSnapshot = { contains: q, mode: "insensitive" };

  return where;
}
