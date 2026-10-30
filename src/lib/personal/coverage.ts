// =============================================================================
// Cruces por horario real y disponibilidad de rotativos. Lógica pura.
//
// "Ausencia" = vacaciones activas (solicitada o aprobada), licencia (médica,
// maternidad, especial) o ausencia por enfermedad.
// Los tramos se resuelven por fecha (vigencia + semanas A/B) con schedule.ts.
// =============================================================================

import { dateRangesOverlap, eachDay, toISODate, utcDay } from "./dates";
import { fmtMinutes, scheduleAt, slotsOn, timesOverlap, type Schedule } from "./schedule";
import { isRotativeZone, type PositionKey } from "./catalog";

export type AbsenceKind = "SOLICITADA" | "APROBADA" | "LICENCIA" | "ENFERMEDAD";

export const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  SOLICITADA: "vacaciones solicitadas",
  APROBADA: "vacaciones aprobadas",
  LICENCIA: "licencia",
  ENFERMEDAD: "ausente por enfermedad",
};

export interface PersonAbsence {
  id: string;
  kind: AbsenceKind;
  startDate: Date;
  endDate: Date;
}

export interface NeededSlot {
  date: string;        // YYYY-MM-DD
  startMinute: number;
  endMinute: number;
  branchId: string | null;
}

/** Tramos que trabaja una persona, fecha por fecha, en [start, end]. */
export function workedSlots(schedules: Schedule[], start: Date, end: Date): NeededSlot[] {
  const out: NeededSlot[] = [];
  for (const d of eachDay(start, end)) {
    const sch = scheduleAt(schedules, d);
    if (!sch) continue;
    for (const s of slotsOn(sch, d)) {
      out.push({ date: toISODate(d), startMinute: s.startMinute, endMinute: s.endMinute, branchId: s.branchId });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Cruces (reemplaza al conflicto C por shiftLabel)
// -----------------------------------------------------------------------------

export interface OtherPerson {
  employeeId: string;
  name: string;
  positionName: string;
  positionKeys: PositionKey[]; // principal y secundario
  absences: PersonAbsence[];
  schedules: Schedule[];
}

export interface OverlapDetail {
  employeeId: string;
  employeeName: string;
  positionName: string;
  kind: AbsenceKind;
  absenceId: string;
  branchId: string;
  dates: string[];
  ranges: string[]; // franjas que se pisan, "08:00–12:00"
}

/**
 * Otras personas con el mismo puesto, ausentes en fechas que se superponen, que
 * trabajan en la misma sucursal en franjas que se pisan al menos un día.
 */
export function findScheduleOverlaps(params: {
  positionKey: PositionKey | null;
  startDate: Date;
  endDate: Date;
  schedules: Schedule[];
  others: OtherPerson[];
}): OverlapDetail[] {
  const { positionKey, startDate, endDate } = params;
  if (!positionKey) return [];
  const mine = workedSlots(params.schedules, startDate, endDate);
  if (mine.length === 0) return [];
  const out: OverlapDetail[] = [];

  for (const other of params.others) {
    if (!other.positionKeys.includes(positionKey)) continue;
    for (const abs of other.absences) {
      if (!dateRangesOverlap(startDate, endDate, abs.startDate, abs.endDate)) continue;
      const from = utcDay(startDate) > utcDay(abs.startDate) ? startDate : abs.startDate;
      const to = utcDay(endDate) < utcDay(abs.endDate) ? endDate : abs.endDate;
      const theirs = workedSlots(other.schedules, from, to);
      const byBranch = new Map<string, { dates: Set<string>; ranges: Set<string> }>();
      for (const a of mine) {
        if (!a.branchId) continue;
        for (const b of theirs) {
          if (b.date !== a.date || b.branchId !== a.branchId || !timesOverlap(a, b)) continue;
          const acc = byBranch.get(a.branchId) ?? { dates: new Set<string>(), ranges: new Set<string>() };
          acc.dates.add(a.date);
          const s = Math.max(a.startMinute, b.startMinute), e = Math.min(a.endMinute, b.endMinute);
          acc.ranges.add(`${fmtMinutes(s)}–${fmtMinutes(e)}`);
          byBranch.set(a.branchId, acc);
        }
      }
      for (const [branchId, acc] of byBranch) {
        out.push({
          employeeId: other.employeeId,
          employeeName: other.name,
          positionName: other.positionName,
          kind: abs.kind,
          absenceId: abs.id,
          branchId,
          dates: [...acc.dates].sort(),
          ranges: [...acc.ranges].sort(),
        });
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Rotativos libres
// -----------------------------------------------------------------------------

export interface RotativeCoverage {
  id: string;
  startDate: Date;
  endDate: Date;
  /** null = todo el día (coberturas sin horario, creadas desde rotativas). */
  slots: NeededSlot[] | null;
}

export interface RotativeCandidate {
  employeeId: string;
  name: string;
  positionKeys: PositionKey[];
  /** Zona efectiva: Employee.zone o, si falta, la zona de su sucursal base. */
  zone: string | null;
  weeklyHours: number | null;
  absences: PersonAbsence[];
  coverages: RotativeCoverage[];
}

export interface BusyDay {
  date: string;
  reason: string;
}

export interface RotativeAvailability {
  employeeId: string;
  name: string;
  zone: string | null;
  weeklyHours: number | null;
  coverageWeeklyHours: number;
  freeAll: boolean;
  freeDays: string[];
  busyDays: BusyDay[];
}

/** Horas semanales promedio que suma cubrir estos tramos en el período. */
export function coverageWeeklyHours(needed: NeededSlot[], startDate: Date, endDate: Date): number {
  const days = eachDay(startDate, endDate).length;
  const minutes = needed.reduce((acc, s) => acc + (s.endMinute - s.startMinute), 0);
  return days > 0 ? Math.round((minutes / 60) * (7 / days) * 10) / 10 : 0;
}

/**
 * Para cada rotativo con el puesto (principal o secundario): en qué días puede
 * cubrir. "Libre" un día = sin vacaciones activas ni licencia ese día, y sin
 * otra cobertura activa ese día cuyos tramos se pisen con los que hay que
 * cubrir. Si quien se va no tiene horario, se cubre el día entero.
 *
 * Orden: libres todo el período, después libres algunos días. Los que no
 * están libres ningún día no se devuelven. Solo se proponen rotativos de zona
 * CABA (la cobertura con rotativos aplica solo a CABA).
 */
export function rotativeAvailability(params: {
  positionKey: PositionKey;
  startDate: Date;
  endDate: Date;
  needed: NeededSlot[];
  candidates: RotativeCandidate[];
  excludeEmployeeId?: string;
  /** Cobertura que no se cuenta como ocupación (la de la propia solicitud al cambiarla). */
  ignoreCoverageId?: string;
}): RotativeAvailability[] {
  const days = eachDay(params.startDate, params.endDate).map(toISODate);
  const neededByDay = new Map<string, NeededSlot[]>();
  if (params.needed.length > 0) {
    for (const n of params.needed) neededByDay.set(n.date, [...(neededByDay.get(n.date) ?? []), n]);
  } else {
    for (const d of days) neededByDay.set(d, [{ date: d, startMinute: 0, endMinute: 24 * 60, branchId: null }]);
  }
  const coverDays = days.filter((d) => neededByDay.has(d));
  const covHours = coverageWeeklyHours([...neededByDay.values()].flat(), params.startDate, params.endDate);
  const out: RotativeAvailability[] = [];

  for (const c of params.candidates) {
    if (c.employeeId === params.excludeEmployeeId) continue;
    if (!c.positionKeys.includes(params.positionKey)) continue;
    if (!isRotativeZone(c.zone)) continue;

    const busyDays: BusyDay[] = [];
    for (const day of coverDays) {
      const date = new Date(`${day}T00:00:00Z`);
      const abs = c.absences.find((a) => dateRangesOverlap(a.startDate, a.endDate, date, date));
      if (abs) { busyDays.push({ date: day, reason: ABSENCE_KIND_LABEL[abs.kind] }); continue; }
      const need = neededByDay.get(day)!;
      const clash = c.coverages.find((cov) => {
        if (cov.id === params.ignoreCoverageId) return false;
        if (!dateRangesOverlap(cov.startDate, cov.endDate, date, date)) return false;
        if (cov.slots === null) return true;
        return cov.slots.some((s) => s.date === day && need.some((n) => timesOverlap(n, s)));
      });
      if (clash) busyDays.push({ date: day, reason: "otra cobertura" });
    }
    const busy = new Set(busyDays.map((b) => b.date));
    const freeDays = coverDays.filter((d) => !busy.has(d));
    if (freeDays.length === 0) continue;
    out.push({
      employeeId: c.employeeId,
      name: c.name,
      zone: c.zone,
      weeklyHours: c.weeklyHours,
      coverageWeeklyHours: covHours,
      freeAll: busyDays.length === 0,
      freeDays,
      busyDays,
    });
  }
  return out.sort((a, b) =>
    Number(b.freeAll) - Number(a.freeAll) ||
    b.freeDays.length - a.freeDays.length ||
    a.name.localeCompare(b.name, "es"));
}
