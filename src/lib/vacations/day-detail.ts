// =============================================================================
// Detalle de un día del calendario de vacaciones: todas las solicitudes que lo
// incluyen, una tarjeta por persona, con el horario de ese día y el saldo.
//
// Fechas: `date` es "YYYY-MM-DD"; las columnas @db.Date son 00:00 UTC.
//
// Saldo: las pendientes todavía no descontaron (queda = actual − días). Una
// aprobada ya descontó, y una rechazada o cancelada no descuenta: en esas el
// saldo actual es también el que queda.
//
// Resumen por puesto: cuenta personas con una solicitud activa (solicitada o
// aprobada). Sirve para ver si se juntan varias del mismo puesto, y una
// rechazada o cancelada no falta a trabajar.
// =============================================================================

import type { Prisma, VacationStatus } from "@prisma/client";
import { previewBalance, totalDays, type BalanceYear } from "@/lib/personal/balance";
import {
  fmtMinutes, hasAlternation, scheduleAt, slotsOn, weekLetter, type Schedule,
} from "@/lib/personal/schedule";
import { ACTIVE_VACATION_STATUSES, scheduleInclude, toSchedule, type Db } from "./people";

export interface DaySchedule {
  kind: "WORKS" | "OFF" | "NO_SCHEDULE";
  /** Semana que rige ese día, si el horario alterna. */
  week: "A" | "B" | null;
  slots: Array<{ startMinute: number; start: string; end: string; place: string }>;
}

export interface DayBalance {
  /** false: la persona no tiene saldo cargado. */
  loaded: boolean;
  current: number;
  after: number;
  /** PENDING: se descontaría al aprobar. DISCOUNTED: ya descontó. NONE: no descuenta. */
  effect: "PENDING" | "DISCOUNTED" | "NONE";
  insufficient: boolean;
}

export interface DayRequest {
  id: string;
  status: VacationStatus;
  startDate: string;
  endDate: string;
  daysCount: number;
  balance: DayBalance;
  withWarnings: boolean;
  withoutCoverage: boolean;
  blocking: boolean;
  coveredBy: string[];
}

export interface DayPerson {
  employeeId: string;
  name: string;
  branchName: string;
  position: string;
  secondaryPosition: string | null;
  isTechnicalDirector: boolean;
  schedule: DaySchedule;
  requests: DayRequest[];
}

export interface VacationDayDetail {
  date: string;
  total: number;
  summary: Array<{ position: string; count: number }>;
  people: DayPerson[];
}

export interface DayInputRow {
  id: string;
  status: VacationStatus;
  startDate: Date;
  endDate: Date;
  daysCount: number;
  conflictLevel: string;
  approvedWithWarnings: boolean;
  withoutCoverage: boolean;
  branchNameSnapshot: string;
  coveredBy: string[];
  employee: {
    id: string;
    name: string;
    branchName: string | null;
    position: string;
    secondaryPosition: string | null;
    isTechnicalDirector: boolean;
    schedules: Schedule[];
    balances: BalanceYear[];
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const es = (a: string, b: string) => a.localeCompare(b, "es");

/** ¿Es una fecha real "YYYY-MM-DD"? */
export function isIsoDay(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === s;
}

/** Horario de una persona en una fecha: el vigente, con la semana A/B que corresponde. */
export function daySchedule(
  schedules: Schedule[],
  date: Date,
  branchNames: Record<string, string>,
): DaySchedule {
  const schedule = scheduleAt(schedules, date);
  if (!schedule || schedule.slots.length === 0) return { kind: "NO_SCHEDULE", week: null, slots: [] };
  const week = schedule.abReferenceDate && hasAlternation(schedule.slots)
    ? weekLetter(date, schedule.abReferenceDate)
    : null;
  const slots = slotsOn(schedule, date)
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((s) => ({
      startMinute: s.startMinute,
      start: fmtMinutes(s.startMinute),
      end: fmtMinutes(s.endMinute),
      place: s.branchId ? (branchNames[s.branchId] ?? "Sucursal") : (s.otherPlace ?? "Otro lugar"),
    }));
  return { kind: slots.length ? "WORKS" : "OFF", week, slots };
}

export function dayBalance(status: VacationStatus, balances: BalanceYear[], days: number, fallbackYear: number): DayBalance {
  const current = totalDays(balances);
  const loaded = balances.length > 0;
  if (status === "PENDING_SUPERVISOR" || status === "PENDING_RRHH") {
    const p = previewBalance(balances, days, fallbackYear);
    return { loaded, current, after: p.totalAfter, effect: "PENDING", insufficient: p.insufficient };
  }
  return { loaded, current, after: current, effect: status === "APPROVED" ? "DISCOUNTED" : "NONE", insufficient: false };
}

const isActive = (s: VacationStatus) => ACTIVE_VACATION_STATUSES.includes(s);
const firstEntry = (p: DayPerson) => p.schedule.slots[0]?.startMinute ?? Number.POSITIVE_INFINITY;

export function buildVacationDay(
  date: string,
  rows: DayInputRow[],
  branchNames: Record<string, string>,
): VacationDayDetail {
  const day = new Date(`${date}T00:00:00Z`);
  const byPerson = new Map<string, DayPerson>();
  for (const r of rows) {
    const e = r.employee;
    let person = byPerson.get(e.id);
    if (!person) {
      person = {
        employeeId: e.id,
        name: e.name,
        branchName: e.branchName ?? r.branchNameSnapshot,
        position: e.position,
        secondaryPosition: e.secondaryPosition,
        isTechnicalDirector: e.isTechnicalDirector,
        schedule: daySchedule(e.schedules, day, branchNames),
        requests: [],
      };
      byPerson.set(e.id, person);
    }
    const approved = r.status === "APPROVED";
    person.requests.push({
      id: r.id,
      status: r.status,
      startDate: isoDay(r.startDate),
      endDate: isoDay(r.endDate),
      daysCount: r.daysCount,
      balance: dayBalance(r.status, e.balances, r.daysCount, r.startDate.getUTCFullYear()),
      withWarnings: (approved && r.approvedWithWarnings) || (isActive(r.status) && !approved && r.conflictLevel === "WARNING"),
      withoutCoverage: approved && r.withoutCoverage,
      blocking: isActive(r.status) && r.conflictLevel === "BLOCKING",
      coveredBy: r.coveredBy,
    });
  }

  const people = [...byPerson.values()];
  // Una persona con una rechazada y una nueva sobre el mismo día: la activa primero.
  for (const p of people) {
    p.requests.sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)) || b.startDate.localeCompare(a.startDate));
  }
  people.sort((a, b) => es(a.position, b.position) || firstEntry(a) - firstEntry(b) || es(a.name, b.name));

  const counts = new Map<string, number>();
  for (const p of people) {
    if (p.requests.some((r) => isActive(r.status))) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([position, count]) => ({ position, count }))
    .sort((a, b) => es(a.position, b.position));

  return { date, total: rows.length, summary, people };
}

/** Todas las solicitudes (sin tope) que incluyen `date` y cumplen `filter`. */
export async function loadVacationDay(
  db: Db,
  date: string,
  filter: Prisma.VacationRequestWhereInput,
): Promise<VacationDayDetail> {
  const day = new Date(`${date}T00:00:00Z`);
  const rows = await db.vacationRequest.findMany({
    where: { AND: [filter, { startDate: { lte: day }, endDate: { gte: day } }] },
    include: {
      coverages: {
        where: { status: "ACTIVE" },
        select: { employee: { select: { firstName: true, lastName: true } } },
      },
      employee: {
        include: {
          position: { select: { name: true } },
          secondaryPosition: { select: { name: true } },
          currentBranch: { select: { name: true } },
          vacationBalances: { select: { year: true, days: true } },
          workSchedules: scheduleInclude,
        },
      },
    },
  });

  const branchIds = new Set<string>();
  for (const r of rows) {
    for (const s of r.employee.workSchedules) {
      for (const x of s.slots) if (x.branchId) branchIds.add(x.branchId);
    }
  }
  const branches = branchIds.size
    ? await db.branch.findMany({ where: { id: { in: [...branchIds] } }, select: { id: true, name: true } })
    : [];

  return buildVacationDay(
    date,
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      daysCount: r.daysCount,
      conflictLevel: r.conflictLevel,
      approvedWithWarnings: r.approvedWithWarnings,
      withoutCoverage: r.withoutCoverage,
      branchNameSnapshot: r.branchNameSnapshot,
      coveredBy: r.coverages.map((c) => `${c.employee.firstName} ${c.employee.lastName}`),
      employee: {
        id: r.employee.id,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        branchName: r.employee.currentBranch?.name ?? null,
        position: r.employee.position.name,
        secondaryPosition: r.employee.secondaryPosition?.name ?? null,
        isTechnicalDirector: r.employee.isTechnicalDirector,
        schedules: r.employee.workSchedules.map(toSchedule),
        balances: r.employee.vacationBalances,
      },
    })),
    Object.fromEntries(branches.map((b) => [b.id, b.name])),
  );
}
