// =============================================================================
// Helpers de datos de personas compartidos por validación y cobertura:
// horarios, puestos (por catálogo) y ausencias (vacaciones activas + licencias).
// =============================================================================

import type { Prisma, PrismaClient, VacationStatus } from "@prisma/client";
import { positionKeyOf, type PositionKey } from "@/lib/personal/catalog";
import type { Schedule, ScheduleWeekValue } from "@/lib/personal/schedule";
import type { AbsenceKind, PersonAbsence } from "@/lib/personal/coverage";

export type Db = PrismaClient | Prisma.TransactionClient;

// Estados que ocupan al empleado/puesto para fines de conflicto.
// REJECTED y CANCELLED no cuentan.
export const ACTIVE_VACATION_STATUSES: VacationStatus[] = [
  "PENDING_SUPERVISOR",
  "PENDING_RRHH",
  "APPROVED",
];

/** Tipos de AbsenceRecord que son "licencia" (situación del empleado, la que carga el loader). */
export const LEAVE_ABSENCE_TYPES = ["MEDICAL_LEAVE", "MATERNITY_LEAVE", "SPECIAL_LEAVE"] as const;

/**
 * Tipos de AbsenceRecord que ocupan a la persona: para ver si un rotativo está
 * libre y para los cruces de superposición. Licencias + ausencia por enfermedad.
 */
export const BUSY_ABSENCE_TYPES = [...LEAVE_ABSENCE_TYPES, "SICKNESS"] as const;

export function vacationKind(status: VacationStatus): AbsenceKind {
  return status === "APPROVED" ? "APROBADA" : "SOLICITADA";
}

export const scheduleInclude = {
  orderBy: { validFrom: "asc" },
  include: { slots: true },
} satisfies Prisma.Employee$workSchedulesArgs;

type DbSchedule = Prisma.WorkScheduleGetPayload<{ include: { slots: true } }>;

export function toSchedule(s: DbSchedule): Schedule {
  return {
    validFrom: s.validFrom,
    abReferenceDate: s.abReferenceDate,
    slots: s.slots.map((x) => ({
      week: x.week as ScheduleWeekValue,
      dayOfWeek: x.dayOfWeek,
      slot: x.slot,
      startMinute: x.startMinute,
      endMinute: x.endMinute,
      branchId: x.branchId,
      otherPlace: x.otherPlace,
    })),
  };
}

export async function loadSchedules(db: Db, employeeId: string): Promise<Schedule[]> {
  const rows = await db.workSchedule.findMany({ where: { employeeId }, ...scheduleInclude });
  return rows.map(toSchedule);
}

export function employeePositionKeys(e: {
  position: { name: string } | null;
  secondaryPosition: { name: string } | null;
}): PositionKey[] {
  return [positionKeyOf(e.position?.name), positionKeyOf(e.secondaryPosition?.name)]
    .filter((k): k is PositionKey => !!k);
}

/** Ausencias (vacaciones activas + licencias + enfermedad) de varias personas en un rango. */
export async function loadAbsences(
  db: Db,
  employeeIds: string[],
  startDate: Date,
  endDate: Date,
  excludeRequestId?: string,
): Promise<Map<string, PersonAbsence[]>> {
  const out = new Map<string, PersonAbsence[]>();
  if (employeeIds.length === 0) return out;
  const [vacs, leaves] = await Promise.all([
    db.vacationRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        id: excludeRequestId ? { not: excludeRequestId } : undefined,
        status: { in: ACTIVE_VACATION_STATUSES },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true, employeeId: true, status: true, startDate: true, endDate: true },
    }),
    db.absenceRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        absenceType: { in: [...BUSY_ABSENCE_TYPES] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true, employeeId: true, absenceType: true, startDate: true, endDate: true },
    }),
  ]);
  const push = (id: string, a: PersonAbsence) => out.set(id, [...(out.get(id) ?? []), a]);
  for (const v of vacs) push(v.employeeId, { id: v.id, kind: vacationKind(v.status), startDate: v.startDate, endDate: v.endDate });
  for (const l of leaves) {
    push(l.employeeId, {
      id: l.id, kind: l.absenceType === "SICKNESS" ? "ENFERMEDAD" : "LICENCIA",
      startDate: l.startDate, endDate: l.endDate,
    });
  }
  return out;
}
