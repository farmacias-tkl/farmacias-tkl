/**
 * Período de consulta. PURO, sin base.
 *
 *   npx tsx src/lib/call-center/metrics/period.test.ts
 */
import assert from "node:assert/strict";
import { PERIOD_CACHE_PAST_MS, PERIOD_CACHE_TODAY_MS, PERIOD_MAX_DAYS, periodCacheMs, addDaysISO, isDayISO, periodLength, resolvePeriod } from "./period";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const TODAY = "2026-03-10";

test("sin parámetros: los últimos 7 días terminando hoy", () => {
  assert.deepEqual(resolvePeriod({}, TODAY), { ok: true, from: "2026-03-04", to: "2026-03-10" });
  assert.deepEqual(resolvePeriod({ from: "", to: null }, TODAY), { ok: true, from: "2026-03-04", to: "2026-03-10" });
});

test("solo hasta: 7 días terminando ese día; solo desde: hasta hoy", () => {
  assert.deepEqual(resolvePeriod({ to: "2026-03-02" }, TODAY), { ok: true, from: "2026-02-24", to: "2026-03-02" });
  assert.deepEqual(resolvePeriod({ from: "2026-03-09" }, TODAY), { ok: true, from: "2026-03-09", to: "2026-03-10" });
});

test("un solo día es un período válido", () => {
  assert.deepEqual(resolvePeriod({ from: TODAY, to: TODAY }, TODAY), { ok: true, from: TODAY, to: TODAY });
});

test("fechas mal formadas o inexistentes → error, no se corrigen", () => {
  for (const bad of ["10/03/2026", "2026-3-1", "2026-02-30", "2026-13-01", "hoy", "2026-03-10T00:00:00Z"]) {
    assert.equal(resolvePeriod({ from: bad }, TODAY).ok, false, `desde ${bad}`);
    assert.equal(resolvePeriod({ to: bad }, TODAY).ok, false, `hasta ${bad}`);
  }
});

test("hasta en el futuro, o desde posterior a hasta → error", () => {
  assert.equal(resolvePeriod({ to: "2026-03-11" }, TODAY).ok, false);
  assert.equal(resolvePeriod({ from: "2026-03-08", to: "2026-03-07" }, TODAY).ok, false);
});

test("tope de días: justo el máximo pasa, uno más no", () => {
  const from = addDaysISO(TODAY, -(PERIOD_MAX_DAYS - 1));
  assert.equal(periodLength(from, TODAY), PERIOD_MAX_DAYS);
  assert.equal(resolvePeriod({ from, to: TODAY }, TODAY).ok, true);
  assert.equal(resolvePeriod({ from: addDaysISO(from, -1), to: TODAY }, TODAY).ok, false);
});

test("addDaysISO cruza mes, año y febrero bisiesto; isDayISO", () => {
  assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysISO("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
  assert.equal(isDayISO("2028-02-29"), true);
  assert.equal(isDayISO("2026-02-29"), false);
  assert.equal(isDayISO(20260310), false);
});

test("caché: corta si el período llega a hoy, larga si terminó antes", () => {
  assert.equal(periodCacheMs(TODAY, TODAY), PERIOD_CACHE_TODAY_MS);
  assert.equal(periodCacheMs(addDaysISO(TODAY, -1), TODAY), PERIOD_CACHE_PAST_MS);
  assert.ok(PERIOD_CACHE_PAST_MS > PERIOD_CACHE_TODAY_MS);
});

console.log(`\nmetrics/period: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
