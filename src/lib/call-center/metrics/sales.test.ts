/**
 * Ventas SIAF del Call Center. PURO, datos inventados (sucursales A y B, vendedores V01–V03).
 *
 *   npx tsx src/lib/call-center/metrics/sales.test.ts
 *
 * Configuración de prueba: desde el 01/03 son del Call Center V01 en A y V01 en B; desde el
 * 10/03 se suma V02 en A y sale V01 de B.
 */
import assert from "node:assert/strict";
import { buildSalesReport, receiptsPer100Orders, type VendorSalesRow } from "./sales";
import type { ConfigVersion } from "./config";
import type { ConfigVendor, WeekSchedule } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const EMPTY: WeekSchedule = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };
const version = (id: string, validFrom: string, createdAt: string, vendors: ConfigVendor[]): ConfigVersion => ({
  id, validFrom, createdAt: new Date(createdAt),
  data: { schemaVersion: 1, publicHours: EMPTY, operatorHours: EMPTY, firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: vendors },
});
const A = "branch-a", B = "branch-b";
const versions = [
  version("v1", "2026-03-01", "2026-02-20T00:00:00Z", [{ branchId: A, code: "V01" }, { branchId: B, code: "V01" }]),
  version("v2", "2026-03-10", "2026-03-05T00:00:00Z", [{ branchId: A, code: "V01" }, { branchId: A, code: "V02" }]),
];
const row = (day: string, branchId: string, code: string, gross: number, receipts = 1, over: Partial<VendorSalesRow> = {}): VendorSalesRow => ({
  day, branchId, branchName: branchId === A ? "Sucursal Inventada A" : "Sucursal Inventada B", code,
  name: `Vendedor ${code}`, gross, receipts, discounts: 0, units: receipts, ...over,
});
const report = (rows: VendorSalesRow[], from = "2026-03-01", to = "2026-03-20", v = versions) =>
  buildSalesReport(rows, { from, to, versions: v });
const vendor = (r: ReturnType<typeof report>, branchId: string, code: string) =>
  r.byVendor.find((x) => x.branchId === branchId && x.code === code);

test("un vendedor que entra a la lista el 10/03 suma solo desde el 10/03, aunque el período cruce el cambio", () => {
  const r = report([
    row("2026-03-08", A, "V02", 100), // antes de entrar: no suma
    row("2026-03-09", A, "V02", 200), // antes de entrar: no suma
    row("2026-03-10", A, "V02", 400), // el día en que empieza a regir: suma
    row("2026-03-11", A, "V02", 800),
  ]);
  const v = vendor(r, A, "V02")!;
  assert.equal(v.gross, 1200);
  assert.equal(v.days, 2);
  assert.equal(v.firstDay, "2026-03-10");
  assert.equal(r.total.gross, 1200);
  assert.deepEqual(r.byDay.map((d) => d.day), ["2026-03-10", "2026-03-11"]);
});

test("un vendedor que sale de la lista el 10/03 deja de sumar desde el 10/03", () => {
  const r = report([
    row("2026-03-09", B, "V01", 50),
    row("2026-03-10", B, "V01", 70),
    row("2026-03-15", B, "V01", 90),
  ]);
  assert.equal(vendor(r, B, "V01")!.gross, 50);
  assert.equal(vendor(r, B, "V01")!.lastDay, "2026-03-09");
  assert.equal(r.total.gross, 50);
});

test("no se aplica una sola versión a todo el rango: ni la primera ni la última dan el mismo total", () => {
  const rows = [
    row("2026-03-05", A, "V01", 10), row("2026-03-05", A, "V02", 20), row("2026-03-05", B, "V01", 40),
    row("2026-03-12", A, "V01", 100), row("2026-03-12", A, "V02", 200), row("2026-03-12", B, "V01", 400),
  ];
  const real = report(rows).total.gross;                                 // 10 + 40 + 100 + 200
  const soloPrimera = report(rows, "2026-03-01", "2026-03-20", [versions[0]]).total.gross; // 10 + 40 + 100 + 400
  const soloUltima = buildSalesReport(rows, { from: "2026-03-01", to: "2026-03-20", versions: [version("x", "2026-03-01", "2026-03-05T00:00:00Z", versions[1].data.callCenterVendors)] }).total.gross; // 10 + 20 + 100 + 200
  assert.equal(real, 350);
  assert.equal(soloPrimera, 550);
  assert.equal(soloUltima, 330);
  assert.deepEqual(report(rows).configVersionsUsed, [{ id: "v1", validFrom: "2026-03-01" }, { id: "v2", validFrom: "2026-03-10" }]);
});

test("a igual fecha de vigencia rige la versión creada más tarde", () => {
  const corregida = [
    version("primera", "2026-03-01", "2026-02-20T10:00:00Z", [{ branchId: A, code: "V01" }, { branchId: A, code: "V03" }]),
    version("corregida", "2026-03-01", "2026-02-20T11:00:00Z", [{ branchId: A, code: "V01" }]),
  ];
  const r = report([row("2026-03-05", A, "V01", 10), row("2026-03-05", A, "V03", 999)], "2026-03-01", "2026-03-20", corregida);
  assert.equal(r.total.gross, 10);
  assert.equal(vendor(r, A, "V03"), undefined);
  assert.deepEqual(r.configVersionsUsed, [{ id: "corregida", validFrom: "2026-03-01" }]);
});

test("el mismo código en otra sucursal es otro vendedor", () => {
  const r = report([row("2026-03-12", A, "V02", 100), row("2026-03-12", B, "V02", 900)]);
  assert.equal(r.total.gross, 100);
  assert.equal(r.byBranch.length, 1);
  assert.equal(r.byBranch[0].branchId, A);
});

test("días sin configuración vigente: no suman y se informan aparte, no como cero", () => {
  const r = report([row("2026-02-27", A, "V01", 500), row("2026-02-28", A, "V01", 500), row("2026-03-01", A, "V01", 30)], "2026-02-25", "2026-03-05");
  assert.equal(r.total.gross, 30);
  assert.deepEqual(r.daysWithoutConfig, ["2026-02-27", "2026-02-28"]);
  assert.deepEqual(r.byDay.map((d) => d.day), ["2026-03-01"]);
});

test("sin ninguna configuración: nada suma y todos los días con ventas quedan sin configuración", () => {
  const r = report([row("2026-03-05", A, "V01", 10)], "2026-03-01", "2026-03-20", []);
  assert.equal(r.total.gross, 0);
  assert.deepEqual(r.daysWithoutConfig, ["2026-03-05"]);
  assert.deepEqual(r.configVersionsUsed, []);
});

test("importes negativos (notas de crédito) restan; comprobantes y descuentos se suman aparte", () => {
  const r = report([
    row("2026-03-05", A, "V01", 1000.105, 3, { discounts: 100.004, units: 5 }),
    row("2026-03-06", A, "V01", -200.1, 1, { discounts: 0, units: -1 }),
  ]);
  assert.equal(r.total.gross, 800.01); // redondeado a centavos una sola vez, al final
  assert.equal(r.total.receipts, 4);   // la nota de crédito cuenta como comprobante
  assert.equal(r.total.discounts, 100);
  assert.equal(r.total.units, 4);
});

test("por día, por sucursal y por vendedor suman lo mismo que el total", () => {
  const r = report([
    row("2026-03-05", A, "V01", 10, 2), row("2026-03-05", B, "V01", 40, 1), row("2026-03-12", A, "V01", 100, 4), row("2026-03-12", A, "V02", 200, 3),
  ]);
  const sum = (xs: Array<{ gross: number; receipts: number }>) => [xs.reduce((a, x) => a + x.gross, 0), xs.reduce((a, x) => a + x.receipts, 0)];
  assert.deepEqual(sum(r.byDay), [r.total.gross, r.total.receipts]);
  assert.deepEqual(sum(r.byBranch), [r.total.gross, r.total.receipts]);
  assert.deepEqual(sum(r.byVendor), [r.total.gross, r.total.receipts]);
  assert.equal(r.byDay.find((d) => d.day === "2026-03-12")!.vendors, 2);
});

test("fuera del período no entra; último día cargado dentro del período", () => {
  const r = report([row("2026-02-28", A, "V01", 1), row("2026-03-21", A, "V01", 1), row("2026-03-18", A, "V01", 7), row("2026-03-19", B, "V03", 9)]);
  assert.equal(r.total.gross, 7);
  assert.equal(r.lastLoadedDay, "2026-03-19"); // hay ventas cargadas ese día, aunque no sean del Call Center
  assert.equal(report([]).lastLoadedDay, null);
});

test("nombre del vendedor: el más reciente del período", () => {
  const r = report([row("2026-03-05", A, "V01", 1, 1, { name: "Nombre Viejo" }), row("2026-03-12", A, "V01", 1, 1, { name: "Nombre Nuevo" })]);
  assert.equal(vendor(r, A, "V01")!.name, "Nombre Nuevo");
});

test("comprobantes cada 100 pedidos: relación de volúmenes; sin pedidos queda no disponible", () => {
  assert.equal(receiptsPer100Orders(85, 118), 72);
  assert.equal(receiptsPer100Orders(1, 3), 33.3);
  assert.equal(receiptsPer100Orders(10, 0), null);
});

console.log(`\nmetrics/sales: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
