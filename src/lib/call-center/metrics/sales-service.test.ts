/**
 * Respuesta del bloque "Ventas SIAF". PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/sales-service.test.ts
 */
import assert from "node:assert/strict";
import { ordersByDay, toSalesPayload } from "./sales-service";
import { buildSalesReport, type VendorSalesRow } from "./sales";
import type { ConfigVersion } from "./config";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const NOW = at("2026-03-12T12:00");
const versions: ConfigVersion[] = [{
  id: "v1", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"),
  data: { schemaVersion: 1, publicHours: {} as never, operatorHours: {} as never, firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [{ branchId: "b1", code: "V01" }] },
}];
const sale = (day: string, gross: number, receipts: number, code = "V01"): VendorSalesRow =>
  ({ day, branchId: "b1", branchName: "Sucursal Inventada", code, name: `Vendedor Inventado ${code}`, gross, receipts, discounts: 0, units: receipts });
const entry = (created: string, orderFlow: boolean, meducar = false) => ({ createdAt: at(created), orderFlow, firstCustomerMessageIsMeducar: meducar });
const build = (rows: VendorSalesRow[], entries: ReturnType<typeof entry>[]) =>
  toSalesPayload(buildSalesReport(rows, { from: "2026-03-09", to: "2026-03-11", versions }), ordersByDay(entries), { now: NOW, hasConfig: true });

test("pedidos por día: pedido en el bot y receta de Meducar; lo demás no; el día es el de Buenos Aires", () => {
  const m = ordersByDay([entry("2026-03-09T10:00", true), entry("2026-03-09T23:59", false, true), entry("2026-03-09T11:00", false), entry("2026-03-10T00:00", true)]);
  assert.deepEqual([...m.entries()].sort(), [["2026-03-09", 2], ["2026-03-10", 1]]);
});

test("comprobantes cada 100 pedidos por día; un día sin pedidos queda sin dato, no en cero", () => {
  const p = build([sale("2026-03-09", 1000, 5), sale("2026-03-10", 500, 2)], [entry("2026-03-09T10:00", true), entry("2026-03-09T11:00", true)]);
  assert.deepEqual(p.byDay.map((d) => [d.day, d.receipts, d.orders, d.receiptsPer100Orders]), [["2026-03-09", 5, 2, 250], ["2026-03-10", 2, 0, null]]);
});

test("total: los pedidos son solo los de los días con comprobantes del Call Center", () => {
  const p = build([sale("2026-03-09", 1000, 5)], [entry("2026-03-09T10:00", true), entry("2026-03-11T10:00", true)]);
  assert.deepEqual([p.orders, p.total.receipts, p.receiptsPer100Orders], [1, 5, 500]);
});

test("notas de crédito: se cuenta el vendedor y día con importe negativo, solo si es del Call Center", () => {
  const p = build([sale("2026-03-09", 1000, 5), sale("2026-03-10", -300, 1), sale("2026-03-10", -50, 1, "V09")], []);
  assert.equal(p.negativeVendorDays, 1);
  assert.equal(p.total.gross, 700);
  assert.equal(p.total.receipts, 6, "la nota de crédito cuenta como comprobante");
});

test("sin comprobantes: totales en cero, sin relación y sin último día cargado", () => {
  const p = build([], [entry("2026-03-09T10:00", true)]);
  assert.deepEqual([p.total.receipts, p.orders, p.receiptsPer100Orders, p.lastLoadedDay, p.byVendor.length], [0, 0, null, null, 0]);
  assert.equal(p.generatedAt, NOW.toISOString());
});

console.log(`\nmetrics/sales-service: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
