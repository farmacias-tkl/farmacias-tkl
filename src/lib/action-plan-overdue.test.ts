/**
 * Tests PUROS del vencimiento de planes de acción (día de Argentina), en dos
 * zonas del proceso. El conteo contra Postgres está en dates/today.smoke.ts.
 *
 *   npx tsx src/lib/action-plan-overdue.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { actionPlanOverdueWhere, isActionPlanOverdue } from "./action-plan-overdue";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

// Plazo: 06/11. En Argentina (UTC-3):
const DAY_BEFORE_NIGHT = new Date("2026-11-06T01:30:00Z"); // 05/11 22:30: antes se veía vencido
const DEADLINE_DAY     = new Date("2026-11-06T15:00:00Z"); // 06/11 12:00: antes se veía vencido
const DEADLINE_NIGHT   = new Date("2026-11-07T02:59:59Z"); // 06/11 23:59:59
const NEXT_DAY         = new Date("2026-11-07T03:00:00Z"); // 07/11 00:00
const plan = (status: string) => ({ deadline: "2026-11-06T00:00:00.000Z", status });

for (const zone of ["UTC", "America/Argentina/Buenos_Aires"]) {
  process.env.TZ = zone;
  console.log(`\nProceso en TZ=${zone}`);
  assert("la noche anterior al plazo: no vencido", !isActionPlanOverdue(plan("OPEN"), DAY_BEFORE_NIGHT));
  assert("el día del plazo: no vencido", !isActionPlanOverdue(plan("OPEN"), DEADLINE_DAY));
  assert("hasta el último segundo de ese día en Argentina: no vencido", !isActionPlanOverdue(plan("OPEN"), DEADLINE_NIGHT));
  assert("al empezar el día siguiente: vencido", isActionPlanOverdue(plan("OPEN"), NEXT_DAY));
  assert("también en curso", isActionPlanOverdue(plan("IN_PROGRESS"), NEXT_DAY));
  assert("terminales nunca figuran vencidos", ["COMPLETED", "CLOSED", "CANCELLED"].every((s) => !isActionPlanOverdue(plan(s), NEXT_DAY)));
  assert("acepta Date de Prisma", isActionPlanOverdue({ deadline: new Date("2026-11-06T00:00:00Z"), status: "OPEN" }, NEXT_DAY));
  const w = actionPlanOverdueWhere(NEXT_DAY) as any;
  assert("filtro: plazo anterior a hoy, sin terminales", w.deadline.lt.toISOString() === "2026-11-07T00:00:00.000Z" && w.status.notIn.length === 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
