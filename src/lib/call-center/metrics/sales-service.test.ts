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
const build = (rows: VendorSalesRow[], entries: ReturnType<typeof entry>[], siafLastDay: string | null = "2026-03-11", to = "2026-03-11") =>
  toSalesPayload(buildSalesReport(rows, { from: "2026-03-09", to, versions }), ordersByDay(entries), { now: NOW, hasConfig: true, siafLastDay });

test("pedidos por día: pedido en el bot y receta de Meducar; lo demás no; el día es el de Buenos Aires", () => {
  const m = ordersByDay([entry("2026-03-09T10:00", true), entry("2026-03-09T23:59", false, true), entry("2026-03-09T11:00", false), entry("2026-03-10T00:00", true)]);
  assert.deepEqual([...m.entries()].sort(), [["2026-03-09", 2], ["2026-03-10", 1]]);
});

test("comprobantes cada 100 pedidos por día; un día sin pedidos queda sin dato, no en cero", () => {
  const p = build([sale("2026-03-09", 1000, 5), sale("2026-03-10", 500, 2)], [entry("2026-03-09T10:00", true), entry("2026-03-09T11:00", true)]);
  assert.deepEqual(p.byDay.map((d) => [d.day, d.receipts, d.orders, d.receiptsPer100Orders]), [["2026-03-09", 5, 2, 250], ["2026-03-10", 2, 0, null]]);
});

test("total: los pedidos son solo los de los días con ventas cargadas", () => {
  const p = build([sale("2026-03-09", 1000, 5)], [entry("2026-03-09T10:00", true), entry("2026-03-11T10:00", true)]);
  assert.deepEqual([p.orders, p.relationDays, p.total.receipts, p.receiptsPer100Orders], [1, 1, 5, 500]);
  // Un día cargado en el que el Call Center no vendió sí cuenta: sus pedidos entran con cero comprobantes.
  const q = build([sale("2026-03-09", 1000, 5), sale("2026-03-10", 80, 2, "V09")], [entry("2026-03-09T10:00", true), entry("2026-03-10T10:00", true)]);
  assert.deepEqual([q.orders, q.relationDays, q.receiptsPer100Orders], [2, 2, 250]);
});

test("días sin datos todavía: los posteriores al último cargado, hasta hoy; no valen cero ni entran en la relación", () => {
  // Hoy es 12/03; SIAF está cargado hasta el 11/03 (ayer): normal, sin aviso de atraso.
  const p = build([sale("2026-03-10", 100, 1), sale("2026-03-11", 100, 1)], [entry("2026-03-12T09:00", true)], "2026-03-11", "2026-03-14");
  assert.deepEqual([p.siafLastDay, p.siafDelayed, p.daysNotLoaded], ["2026-03-11", false, ["2026-03-12"]]);
  assert.deepEqual([p.orders, p.byDay.some((d) => d.day === "2026-03-12")], [0, false]);
});

test("atraso: el último día cargado es anterior a ayer", () => {
  const p = build([sale("2026-03-09", 100, 1)], [], "2026-03-09");
  assert.deepEqual([p.siafDelayed, p.daysNotLoaded], [true, ["2026-03-10", "2026-03-11"]]);
  // Un período viejo, ya cargado entero, no lista días sin datos aunque haya atraso hoy.
  const viejo = toSalesPayload(buildSalesReport([], { from: "2026-03-01", to: "2026-03-05", versions }), new Map(), { now: NOW, hasConfig: true, siafLastDay: "2026-03-09" });
  assert.deepEqual([viejo.siafDelayed, viejo.daysNotLoaded], [true, []]);
});

test("sin ningún dato de SIAF: no hay último día, no es atraso, y todo el período queda sin datos todavía", () => {
  const p = build([], [], null);
  assert.deepEqual([p.siafLastDay, p.siafDelayed, p.daysNotLoaded], [null, false, ["2026-03-09", "2026-03-10", "2026-03-11"]]);
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

test("por operador: conversaciones atendidas de la cuenta en el mismo período; sin cuenta o sin dato queda null", () => {
  const vs: ConfigVersion[] = [{
    id: "vo", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"),
    data: {
      schemaVersion: 1, publicHours: {} as never, operatorHours: {} as never, firstResponseGoalMinutes: 15,
      accounts: [{ externalId: "9001", alias: "Alias inventado", active: true, borrowed: false, historical: false }, { externalId: "9002", alias: null, active: true, borrowed: false, historical: false }],
      callCenterVendors: [{ branchId: "b1", code: "V01", accountId: "9001" }, { branchId: "b1", code: "V02", accountId: "9002" }, { branchId: "b1", code: "V03" }],
    },
  }];
  const report = buildSalesReport([sale("2026-03-10", 100, 2, "V01"), sale("2026-03-10", 50, 1, "V02"), sale("2026-03-10", 20, 1, "V03")], { from: "2026-03-09", to: "2026-03-11", versions: vs });
  const con = toSalesPayload(report, new Map(), { now: NOW, hasConfig: true, siafLastDay: "2026-03-11", attendedByAccount: new Map([["9001", 37]]) });
  // 9002 no escribió en el período: cero conversaciones. El código sin cuenta: null.
  assert.deepEqual(con.byOperator.map((o) => [o.account, o.conversations]), [["9001", 37], ["9002", 0], [null, null]]);
  // Si el informe de Operadores no se pudo calcular: null, no cero.
  const sin = toSalesPayload(report, new Map(), { now: NOW, hasConfig: true, siafLastDay: "2026-03-11", attendedByAccount: null });
  assert.deepEqual(sin.byOperator.map((o) => o.conversations), [null, null, null]);
});

console.log(`\nmetrics/sales-service: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
