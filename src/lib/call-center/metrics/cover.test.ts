/**
 * Portada de "Ahora". PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/cover.test.ts
 */
import assert from "node:assert/strict";
import { buildTodayClosures, coverStatus } from "./cover";
import { closureMapOf } from "./closure-outcome";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const none = { criticalCurrent: 0, urgent: 0, closing: 0, completedOrders: 0, insisting: 0 };

test("estado: rojo por demora crítica o posible urgencia; naranja por ventana, pedidos o insistencia; verde sin nada", () => {
  assert.deepEqual(coverStatus(none), { level: "AL_DIA", reasons: [] });
  assert.deepEqual(coverStatus({ ...none, completedOrders: 43 }), { level: "REVISAR", reasons: ["43 pedidos completos sin primera respuesta"] });
  assert.deepEqual(coverStatus({ ...none, closing: 1, insisting: 2 }), { level: "REVISAR", reasons: ["1 ventana de WhatsApp por vencer", "2 clientes insistiendo"] });
  const rojo = coverStatus({ ...none, criticalCurrent: 12, completedOrders: 43 });
  assert.deepEqual(rojo, { level: "ATENCION", reasons: ["12 casos en demora crítica", "43 pedidos completos sin primera respuesta"] });
  assert.equal(coverStatus({ ...none, urgent: 1 }).level, "ATENCION");
  // Sin configuración no se sabe la demora crítica: no inventa un rojo.
  assert.equal(coverStatus({ ...none, criticalCurrent: null }).level, "AL_DIA");
});

const map = closureMapOf({ closureLabels: [
  { label: "cierre_venta", outcome: "VENTA" }, { label: "cierre_consulta", outcome: "CONSULTA" },
  { label: "cierre_no_siguio", outcome: "PEDIDO_NO_CONCRETADO" }, { label: "cierre_sin_stock", outcome: "SIN_STOCK" },
  { label: "cierre_no_trabajamos", outcome: "NO_LO_TRABAJAMOS" }, { label: "cierre_solo_bot", outcome: "SOLO_BOT" },
] });
const rows = (...names: Array<string | null>) => names.map((closureTypeName) => ({ closureTypeName }));

test("cierres de hoy: los grupos cuentan solo los que tienen tipo; no concretadas va aparte y desglosada", () => {
  const t = buildTodayClosures(rows("cierre_venta", "cierre_venta", "cierre_consulta", "cierre_no_siguio", "cierre_sin_stock", "cierre_no_trabajamos", "cierre_solo_bot", null), map);
  assert.deepEqual(t, { closed: 8, typed: 7, sales: 2, queries: 1, notCompleted: { customerLeft: 1, noStockOrNotCarried: 2 }, other: 1, lowCoverage: false });
});

test("cobertura: menos de la mitad con tipo es dato parcial; un nombre que la configuración no conoce no cuenta como tipo", () => {
  const t = buildTodayClosures(rows("cierre_venta", null, null, "nombre_desconocido"), map);
  assert.deepEqual([t.closed, t.typed, t.sales, t.lowCoverage], [4, 1, 1, true]);
  assert.equal(buildTodayClosures(rows("cierre_venta", null), map).lowCoverage, false, "justo la mitad no es dato parcial");
  assert.deepEqual(buildTodayClosures([], map), { closed: 0, typed: 0, sales: 0, queries: 0, notCompleted: { customerLeft: 0, noStockOrNotCarried: 0 }, other: 0, lowCoverage: false });
});

console.log(`\nmetrics/cover: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
