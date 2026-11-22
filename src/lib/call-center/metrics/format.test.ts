/**
 * Formato de duraciones y porcentajes. PURO.
 *
 *   npx tsx src/lib/call-center/metrics/format.test.ts
 */
import assert from "node:assert/strict";
import { formatMinutes, formatMinutesOrMissing, formatRatio, formatShortDay } from "./format";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

test("minutos, horas y días", () => {
  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(59.4), "59 min");
  assert.equal(formatMinutes(59.6), "1 h 0 min");
  assert.equal(formatMinutes(95), "1 h 35 min");
  assert.equal(formatMinutes(47 * 60 + 59), "47 h 59 min");
  assert.equal(formatMinutes(3000), "2 d 2 h");
  assert.equal(formatMinutes(-5), "0 min");
});

test("un dato faltante no se muestra como cero", () => {
  assert.equal(formatMinutesOrMissing(null), "Sin datos");
  assert.equal(formatMinutesOrMissing(undefined, "No disponible"), "No disponible");
  assert.equal(formatMinutesOrMissing(0), "0 min");
  assert.equal(formatRatio(null), "Sin datos");
  assert.equal(formatRatio(0), "0 %");
});

test("porcentajes redondeados y día corto", () => {
  assert.equal(formatRatio(0.2449), "24 %");
  assert.equal(formatRatio(0.245), "25 %");
  assert.equal(formatRatio(1), "100 %");
  assert.equal(formatShortDay("2026-03-01"), "01/03");
});

console.log(`\nmetrics/format: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
