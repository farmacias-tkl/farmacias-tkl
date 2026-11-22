/**
 * Indicadores por actividad. PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/activity.test.ts
 */
import assert from "node:assert/strict";
import { buildActivityReport, type DailyActivityRow } from "./activity";
import type { FollowupBlockRow } from "./accounts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const row = (day: string, conversationId: string, customer: boolean, operator: boolean): DailyActivityRow => ({ day, conversationId, customer, operator });
const block = (conversationId: string, start: string, responded: string | null): FollowupBlockRow =>
  ({ conversationId, startedAt: at(start), respondedAt: responded ? at(responded) : null, account: responded ? "9001" : null });

const rows = [
  row("2026-03-02", "c1", true, true),
  row("2026-03-02", "c2", true, false),
  row("2026-03-02", "c3", false, true),
  row("2026-03-03", "c1", true, true),   // la misma conversación, otro día
  row("2026-03-03", "c4", true, false),
];
const blocks = [
  block("c1", "2026-03-02T10:00", "2026-03-02T10:10"),
  block("c1", "2026-03-02T15:00", "2026-03-02T15:30"),
  block("c3", "2026-03-02T23:50", "2026-03-03T09:00"), // empezó el 02, respondido el 03: cuenta el 02
  block("c1", "2026-03-03T11:00", null),
];

test("por día: cada conversación cuenta en cada día en que tuvo actividad", () => {
  const r = buildActivityReport(rows, []);
  assert.deepEqual(r.days.map((d) => [d.day, d.activeCustomer, d.attended]), [["2026-03-02", 2, 2], ["2026-03-03", 2, 1]]);
});

test("período: conversaciones distintas, no la suma de los días", () => {
  const r = buildActivityReport(rows, []);
  assert.deepEqual(r.period, { activeCustomer: 3, attended: 2 });
  assert.ok(r.days.reduce((n, d) => n + d.activeCustomer, 0) > r.period.activeCustomer);
});

test("respuestas posteriores: mediana solo entre respondidos; los sin respuesta van aparte", () => {
  const r = buildActivityReport(rows, blocks);
  assert.deepEqual([r.followups.blocks, r.followups.answered, r.followups.unanswered], [4, 3, 1]);
  assert.equal(r.followups.response.n, 3);
  assert.equal(r.followups.response.median, 30); // 10, 30 y 550 minutos
});

test("respuestas posteriores: el bloque cuenta en el día en que empezó (hora de Buenos Aires)", () => {
  const r = buildActivityReport(rows, blocks);
  const d02 = r.days.find((d) => d.day === "2026-03-02")!;
  const d03 = r.days.find((d) => d.day === "2026-03-03")!;
  assert.deepEqual([d02.followups.blocks, d02.followups.unanswered], [3, 0]);
  assert.deepEqual([d03.followups.blocks, d03.followups.answered, d03.followups.unanswered], [1, 0, 1]);
  assert.equal(d03.followups.response.median, null, "sin respondidos no hay mediana, no cero");
});

test("un día con bloques pero sin filas de actividad igual aparece; sin datos, informe vacío", () => {
  const r = buildActivityReport([], [block("c9", "2026-03-05T10:00", null)]);
  assert.deepEqual(r.days.map((d) => [d.day, d.activeCustomer, d.attended, d.followups.blocks]), [["2026-03-05", 0, 0, 1]]);
  const empty = buildActivityReport([], []);
  assert.deepEqual([empty.days.length, empty.period.activeCustomer, empty.followups.blocks, empty.followups.response.median], [0, 0, 0, null]);
});

console.log(`\nmetrics/activity: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
