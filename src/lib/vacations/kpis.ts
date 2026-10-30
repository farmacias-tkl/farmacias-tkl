// =============================================================================
// Indicadores de la pantalla Vacaciones (y la tarjeta del dashboard operativo).
//
//   solicitadas — PENDING_SUPERVISOR, todas.
//   aprobadas   — APPROVED con endDate >= hoy (en curso o futuras).
//   rechazadas  — REJECTED con el rechazo dentro del mes actual.
//   hoy         — APPROVED cuyo período incluye hoy.
//
// Fechas: startDate/endDate son @db.Date (00:00 UTC, mismo criterio que la
// pantalla). "Hoy" es la fecha de calendario en Argentina, expresada como
// 00:00 UTC para comparar con esas columnas. El rechazo es un instante: el
// mes se toma en hora de Argentina (como formatDateTimeAR).
//
// Una sola definición para contar (metrics) y para filtrar la lista (kpi=…).
// =============================================================================

import type { Prisma } from "@prisma/client";
import type { Db } from "./people";

export const VACATION_KPIS = ["solicitadas", "aprobadas", "rechazadas", "hoy"] as const;
export type VacationKpi = (typeof VACATION_KPIS)[number];

export function isVacationKpi(x: unknown): x is VacationKpi {
  return typeof x === "string" && (VACATION_KPIS as readonly string[]).includes(x);
}

const TZ_AR = "America/Argentina/Buenos_Aires";

function arParts(instant: Date): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ_AR, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second };
}

/** Hoy (fecha de calendario en Argentina) como 00:00 UTC, para comparar con @db.Date. */
export function todayAR(now: Date = new Date()): Date {
  const p = arParts(now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

/** Instante en que empieza el día y/m/d en Argentina (sin fijar el offset a mano). */
function startOfDayAR(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  const p = arParts(new Date(guess));
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return new Date(guess - (wallAsUtc - guess));
}

/** Mes actual en Argentina: [inicio, inicio del mes siguiente). */
export function monthRangeAR(now: Date = new Date()): { start: Date; end: Date } {
  const p = arParts(now);
  const next = p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 };
  return { start: startOfDayAR(p.y, p.m, 1), end: startOfDayAR(next.y, next.m, 1) };
}

/** Filtro Prisma de cada indicador. */
export function kpiWhere(kpi: VacationKpi, now: Date = new Date()): Prisma.VacationRequestWhereInput {
  const today = todayAR(now);
  switch (kpi) {
    case "solicitadas":
      return { status: "PENDING_SUPERVISOR" };
    case "aprobadas":
      return { status: "APPROVED", endDate: { gte: today } };
    case "hoy":
      return { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } };
    case "rechazadas": {
      // Momento del rechazo: rrhhActionAt si lo rechazó RRHH (paso 2), si no
      // supervisorActionAt. Así una aprobada por supervisión en otro mes y
      // rechazada en el paso 2 este mes cuenta este mes (y no el otro).
      const { start, end } = monthRangeAR(now);
      const inMonth = { gte: start, lt: end };
      return {
        status: "REJECTED",
        OR: [
          { rrhhActionAt: inMonth },
          { rrhhActionAt: null, supervisorActionAt: inMonth },
        ],
      };
    }
  }
}

export type VacationKpiCounts = Record<VacationKpi, number>;

export async function countVacationKpis(
  db: Db,
  p: { branchId?: string | null; now?: Date } = {},
): Promise<VacationKpiCounts> {
  const scope: Prisma.VacationRequestWhereInput = p.branchId ? { branchId: p.branchId } : {};
  const count = (kpi: VacationKpi) => db.vacationRequest.count({ where: { AND: [scope, kpiWhere(kpi, p.now)] } });
  const [solicitadas, aprobadas, rechazadas, hoy] = await Promise.all(VACATION_KPIS.map(count));
  return { solicitadas, aprobadas, rechazadas, hoy };
}
