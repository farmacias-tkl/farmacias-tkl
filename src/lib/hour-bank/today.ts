// =============================================================================
// Banco de horas: quiénes están afuera un día. Para "Ausentes hoy" (dashboard y
// ficha de la sucursal). Solo los pedidos AUTORIZADOS: uno pendiente todavía no
// es una ausencia.
// =============================================================================

import { fmtMinutes } from "@/lib/personal/schedule";
import type { Db } from "@/lib/vacations/people";

export async function loadHourBankOn(db: Db, day: Date, opts: { branchId?: string | null } = {}) {
  return db.hourBankRequest.findMany({
    where: {
      status: "APPROVED",
      startDate: { lte: day },
      endDate: { gte: day },
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
    },
    select: {
      id: true, employeeId: true, startDate: true, endDate: true, startMinute: true, endMinute: true, hours: true,
      employee: { select: { id: true, firstName: true, lastName: true, position: { select: { name: true, requiresCoverage: true } } } },
      branch: { select: { name: true } },
      coveredBy: { select: { firstName: true, lastName: true } },
      coverageNote: true,
    },
    orderBy: [{ branchNameSnapshot: "asc" }, { employeeNameSnapshot: "asc" }],
  });
}

/** "Día completo" o "10:00–12:00". */
export function windowLabel(r: { startMinute: number | null; endMinute: number | null }): string {
  return r.startMinute !== null && r.endMinute !== null
    ? `${fmtMinutes(r.startMinute)}–${fmtMinutes(r.endMinute)}`
    : "Día completo";
}

/** "Cubre: Nombre Apellido (aclaración)" o null si no se registró. */
export function coverLabel(r: { coveredBy: { firstName: string; lastName: string } | null; coverageNote: string | null }): string | null {
  const who = r.coveredBy ? `${r.coveredBy.firstName} ${r.coveredBy.lastName}` : null;
  if (who && r.coverageNote) return `${who} (${r.coverageNote})`;
  return who ?? r.coverageNote ?? null;
}
