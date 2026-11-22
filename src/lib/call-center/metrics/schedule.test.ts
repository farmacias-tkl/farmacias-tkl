/**
 * Horarios con la lista real de feriados nacionales de la plataforma. Horarios inventados.
 *
 *   npx tsx src/lib/call-center/metrics/schedule.test.ts
 */
import assert from "node:assert/strict";
import { publicHours, operatorHours } from "./schedule";
import { addBusinessMinutes, businessMinutesBetween } from "./business-time";
import type { ConfigVersion } from "./config";
import type { WeekSchedule } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const week = (from: string, to: string): WeekSchedule => {
  const d = [{ from, to }];
  return { "1": d, "2": d, "3": d, "4": d, "5": d, "6": [], "7": [] };
};
const versions: ConfigVersion[] = [{
  id: "v1", validFrom: "2026-01-01", createdAt: new Date("2026-01-01T00:00:00Z"),
  data: {
    schemaVersion: 1, publicHours: week("10:00", "18:00"), operatorHours: week("09:00", "19:00"),
    firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [],
  },
}];

// Lunes 23/11/2026: feriado nacional (Día de la Soberanía Nacional, trasladado del 20/11).
test("feriado nacional: sin franjas en el horario público ni en el de operadores", () => {
  assert.deepEqual(publicHours(versions)("2026-11-23"), []);
  assert.deepEqual(operatorHours(versions)("2026-11-23"), []);
  assert.equal(publicHours(versions)("2026-11-24").length, 1);
});

test("lo que entra el viernes al cierre vence el martes: el fin de semana y el feriado no cuentan", () => {
  const r = publicHours(versions);
  assert.equal(businessMinutesBetween(at("2026-11-20T17:55"), at("2026-11-24T10:05"), r), 10);
  assert.equal(addBusinessMinutes(at("2026-11-20T17:55"), 15, r)?.toISOString(), at("2026-11-24T10:10").toISOString());
});

test("el 20/11 (fecha original del feriado trasladado) es un día hábil común", () => {
  assert.equal(publicHours(versions)("2026-11-20").length, 1);
});

console.log(`\nmetrics/schedule: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
