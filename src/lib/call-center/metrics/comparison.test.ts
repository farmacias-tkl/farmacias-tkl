/**
 * Regla de muestra chica y de días comparables. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/comparison.test.ts
 */
import assert from "node:assert/strict";
import { comparisonNote, comparisonVerdict, sameSchedule } from "./comparison";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const side = (answered: number, entries: number, hasPublicHours: boolean | null = true) => ({ answered, entries, hasPublicHours });

test("2 respondidas de 62 contra 148 de 211: muestra pequeña, sin interpretar", () => {
  const v = comparisonVerdict(side(2, 62), side(148, 211));
  assert.deepEqual(v, { kind: "SMALL_SAMPLE", side: "today", answered: 2, entries: 62 });
  assert.equal(comparisonNote(v), "Muestra pequeña: 2 conversaciones respondidas de 62. No permite concluir una mejora general.");
});

test("los dos umbrales: menos de 20 respondidas, o menos de la mitad respondida", () => {
  assert.equal(comparisonVerdict(side(19, 20), side(100, 120)).kind, "SMALL_SAMPLE", "19 respondidas no alcanzan aunque sean casi todas");
  assert.equal(comparisonVerdict(side(30, 100), side(100, 120)).kind, "SMALL_SAMPLE", "30 respondidas de 100 son menos de la mitad");
  assert.equal(comparisonVerdict(side(20, 40), side(100, 120)).kind, "OK", "justo en los dos umbrales");
  assert.equal(comparisonVerdict(side(0, 0), side(100, 120)).kind, "SMALL_SAMPLE", "sin entradas");
  assert.equal(comparisonNote(comparisonVerdict(side(1, 5), side(100, 120))), "Muestra pequeña: 1 conversación respondida de 5. No permite concluir una mejora general.");
});

test("la muestra chica del día de comparación también frena la lectura, y lo dice", () => {
  const v = comparisonVerdict(side(60, 80), side(3, 9));
  assert.deepEqual(v, { kind: "SMALL_SAMPLE", side: "previous", answered: 3, entries: 9 });
  assert.match(comparisonNote(v)!, /^Muestra pequeña en el día de comparación: 3 conversaciones respondidas de 9\./);
});

test("un día sin horario público contra uno con atención: se muestran los números, sin interpretarlos", () => {
  const v = comparisonVerdict(side(60, 80, false), side(70, 90, true));
  assert.equal(v.kind, "DIFFERENT_SCHEDULE");
  assert.match(comparisonNote(v)!, /no son comparables/);
  assert.equal(comparisonVerdict(side(60, 80, false), side(70, 90, false)).kind, "OK");
  // Sin dato de horario no se puede decir que sean distintos.
  assert.equal(sameSchedule(side(1, 1, null), side(1, 1, true)), true);
  assert.equal(comparisonNote({ kind: "OK" }), null);
});

console.log(`\nmetrics/comparison: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
