/**
 * Tests PUROS de los indicadores de Vacaciones (fechas: hoy y mes en
 * Argentina) y de los permisos de RRHH (HR solo revisa). Sin DB.
 * Los conteos contra Postgres están en kpis.smoke.ts.
 *
 *   npx tsx src/lib/vacations/kpis.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
// La hora local del proceso no tiene que influir.
process.env.TZ = "Asia/Tokyo";

import { isVacationKpi, kpiWhere, monthRangeAR, todayAR } from "./kpis";
import { can, canAccessRoute, requireCan } from "@/lib/permissions";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const iso = (d: Date) => d.toISOString();

console.log("\nHoy (fecha de Argentina como 00:00 UTC)");
assert("15/10 12:00 UTC → 2026-10-15", iso(todayAR(new Date("2026-10-15T12:00:00Z"))) === "2026-10-15T00:00:00.000Z");
assert("15/10 02:30 UTC (14/10 23:30 en Argentina) → 2026-10-14", iso(todayAR(new Date("2026-10-15T02:30:00Z"))) === "2026-10-14T00:00:00.000Z");
assert("15/10 03:00 UTC (00:00 en Argentina) → 2026-10-15", iso(todayAR(new Date("2026-10-15T03:00:00Z"))) === "2026-10-15T00:00:00.000Z");

console.log("\nMes actual en Argentina");
{
  const r = monthRangeAR(new Date("2026-10-15T12:00:00Z"));
  assert("octubre: desde 1/10 00:00 AR (03:00 UTC)", iso(r.start) === "2026-10-01T03:00:00.000Z");
  assert("hasta 1/11 00:00 AR (excluido)", iso(r.end) === "2026-11-01T03:00:00.000Z");
  const late = monthRangeAR(new Date("2026-11-01T02:00:00Z")); // 31/10 23:00 en Argentina
  assert("31/10 23:00 AR todavía es octubre", iso(late.start) === "2026-10-01T03:00:00.000Z");
  const dec = monthRangeAR(new Date("2026-12-20T12:00:00Z"));
  assert("diciembre cierra en 1/1 del año siguiente", iso(dec.end) === "2027-01-01T03:00:00.000Z");
}

console.log("\nCriterios");
{
  const now = new Date("2026-10-15T12:00:00Z");
  assert("solicitadas = PENDING_SUPERVISOR (todas)", JSON.stringify(kpiWhere("solicitadas", now)) === JSON.stringify({ status: "PENDING_SUPERVISOR" }));
  const ap = kpiWhere("aprobadas", now) as any;
  assert("aprobadas = APPROVED con fin >= hoy", ap.status === "APPROVED" && iso(ap.endDate.gte) === "2026-10-15T00:00:00.000Z" && !ap.startDate);
  const hoy = kpiWhere("hoy", now) as any;
  assert("hoy = APPROVED con inicio <= hoy <= fin", hoy.status === "APPROVED"
    && iso(hoy.startDate.lte) === "2026-10-15T00:00:00.000Z" && iso(hoy.endDate.gte) === "2026-10-15T00:00:00.000Z");
  const re = kpiWhere("rechazadas", now) as any;
  assert("rechazadas = REJECTED con rechazo en el mes (RRHH o, si no hubo, supervisión)", re.status === "REJECTED"
    && re.OR.length === 2 && re.OR[1].rrhhActionAt === null && iso(re.OR[1].supervisorActionAt.gte) === "2026-10-01T03:00:00.000Z");
  assert("kpi válido / inválido", isVacationKpi("hoy") && !isVacationKpi("pendingRrhh") && !isVacationKpi(null));
}

console.log("\nRRHH (HR) solo revisa");
{
  const hr = { user: { role: "HR" as const } };
  assert("HR no aprueba, rechaza ni deshace (supervisor-approve/reject, undo-approval)", !can.approveVacation("HR") && requireCan(can.approveVacation, hr)?.status === 403);
  assert("HR no aprueba ni rechaza el paso 2 (rrhh-approve/reject)", !can.confirmVacation("HR") && requireCan(can.confirmVacation, hr)?.status === 403);
  assert("HR no cambia la cobertura (vacations/[id]/coverage POST y assignments vinculadas)", !can.changeVacationCoverage("HR"));
  assert("HR ve la pantalla y la API de vacaciones (lista, calendario, detalle, métricas, saldos)",
    canAccessRoute("HR", "/vacaciones") && canAccessRoute("HR", "/api/vacations") && canAccessRoute("HR", "/api/vacations/metrics")
    && canAccessRoute("HR", "/api/employees"));
  assert("Supervisor y Admin sí aprueban y cambian cobertura", can.approveVacation("SUPERVISOR") && can.approveVacation("ADMIN")
    && can.changeVacationCoverage("SUPERVISOR") && can.changeVacationCoverage("ADMIN") && can.confirmVacation("SUPERVISOR"));
  assert("Encargado/a tampoco aprueba ni cambia cobertura", !can.approveVacation("BRANCH_MANAGER") && !can.changeVacationCoverage("BRANCH_MANAGER"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
