// =============================================================================
// Cobertura con rotativos (adenda D): datos desde la base.
//
// La lógica de "libre" está en src/lib/personal/coverage.ts. Acá se cargan:
//   - los tramos a cubrir (horario real de quien se va, fecha por fecha);
//   - la zona de la solicitud (Branch.zone de la sucursal donde trabaja): la
//     cobertura con rotativos aplica solo a CABA;
//   - los rotativos activos con el puesto (zona CABA: Employee.zone o, si
//     falta, la de su sucursal base), sus vacaciones/licencias y sus
//     coberturas activas (EmployeeBranchAssignment ROTATION o
//     TEMPORARY_COVERAGE), con los tramos que cubren.
// =============================================================================

import type { Prisma } from "@prisma/client";
import { toISODate } from "@/lib/personal/dates";
import { coveredByRotatives, type PositionKey } from "@/lib/personal/catalog";
import {
  rotativeAvailability, workedSlots,
  type NeededSlot, type RotativeAvailability, type RotativeCoverage,
} from "@/lib/personal/coverage";
import { employeePositionKeys, loadAbsences, loadSchedules, type Db } from "./people";

/** coverageSlots (JSON) → tramos; null si la cobertura es de día entero o el JSON no sirve. */
export function parseCoverageSlots(json: Prisma.JsonValue | null): NeededSlot[] | null {
  if (!Array.isArray(json)) return null;
  const out: NeededSlot[] = [];
  for (const x of json) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const o = x as Record<string, unknown>;
    if (typeof o.date !== "string" || typeof o.startMinute !== "number" || typeof o.endMinute !== "number") return null;
    out.push({
      date: o.date,
      startMinute: o.startMinute,
      endMinute: o.endMinute,
      branchId: typeof o.branchId === "string" ? o.branchId : null,
    });
  }
  return out;
}

/** Tramos que hay que cubrir: el horario real de quien se va en el período. */
export async function loadNeededSlots(db: Db, employeeId: string, startDate: Date, endDate: Date): Promise<NeededSlot[]> {
  return workedSlots(await loadSchedules(db, employeeId), startDate, endDate);
}

export interface RotativeOptions {
  /** false si el puesto no se cubre con rotativos o la sucursal no es de zona CABA. */
  applies: boolean;
  needed: NeededSlot[];
  requestZone: string | null;
  availability: RotativeAvailability[];
}

export async function loadRotativeOptions(db: Db, p: {
  employeeId: string;     // quien se va
  positionKey: PositionKey;
  branchId: string;       // sucursal donde trabaja quien se va
  startDate: Date;
  endDate: Date;
  /** Solicitud propia: su cobertura no cuenta como ocupación. */
  excludeRequestId?: string;
}): Promise<RotativeOptions> {
  const [needed, branch] = await Promise.all([
    loadNeededSlots(db, p.employeeId, p.startDate, p.endDate),
    db.branch.findUnique({ where: { id: p.branchId }, select: { zone: true } }),
  ]);
  const requestZone = branch?.zone ?? null;
  if (!coveredByRotatives(p.positionKey, requestZone)) {
    return { applies: false, needed, requestZone, availability: [] };
  }

  const rotativos = await db.employee.findMany({
    where: { isRotating: true, active: true, id: { not: p.employeeId } },
    include: {
      position: true,
      secondaryPosition: true,
      currentBranch: { select: { zone: true } },
    },
  });
  const withKey = rotativos.filter((r) => employeePositionKeys(r).includes(p.positionKey));
  const ids = withKey.map((r) => r.id);

  const [absences, coverages] = await Promise.all([
    loadAbsences(db, ids, p.startDate, p.endDate),
    ids.length === 0 ? [] : db.employeeBranchAssignment.findMany({
      where: {
        employeeId: { in: ids },
        status: "ACTIVE",
        type: { in: ["ROTATION", "TEMPORARY_COVERAGE"] },
        startDate: { lte: p.endDate },
        OR: [{ endDate: null }, { endDate: { gte: p.startDate } }],
        ...(p.excludeRequestId ? { NOT: { vacationRequestId: p.excludeRequestId } } : {}),
      },
      select: { id: true, employeeId: true, startDate: true, endDate: true, coverageSlots: true },
    }),
  ]);

  const covByEmployee = new Map<string, RotativeCoverage[]>();
  for (const c of coverages) {
    const cov: RotativeCoverage = {
      id: c.id,
      startDate: new Date(`${toISODate(c.startDate)}T00:00:00Z`),
      endDate: c.endDate ? new Date(`${toISODate(c.endDate)}T00:00:00Z`) : new Date("9999-12-31T00:00:00Z"),
      slots: parseCoverageSlots(c.coverageSlots),
    };
    covByEmployee.set(c.employeeId, [...(covByEmployee.get(c.employeeId) ?? []), cov]);
  }

  const availability = rotativeAvailability({
    positionKey: p.positionKey,
    startDate: p.startDate,
    endDate: p.endDate,
    needed,
    candidates: withKey.map((r) => ({
      employeeId: r.id,
      name: `${r.firstName} ${r.lastName}`,
      positionKeys: employeePositionKeys(r),
      zone: r.zone ?? r.currentBranch?.zone ?? null,
      weeklyHours: r.weeklyHours === null ? null : Number(r.weeklyHours),
      absences: absences.get(r.id) ?? [],
      coverages: covByEmployee.get(r.id) ?? [],
    })),
  });

  return { applies: true, needed, requestZone, availability };
}
