/**
 * Derivaciones a compra presencial y horario de pedidos por sucursal. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/derivation.test.ts
 */
import assert from "node:assert/strict";
import { derivationTiming, normalizeBranchName, resolveBranchId, type DerivationRow } from "./derivation";
import { buildDetectedReport } from "./detected";
import type { ConfigVersion } from "./config";
import type { WeekSchedule } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);

const EMPTY: WeekSchedule = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };
const wk = [{ from: "09:30", to: "18:00" }];
/** Retiro: lunes a viernes 09:30–18:00, sábado 09:30–13:00. Envíos: solo lunes a viernes hasta las 16:00. */
const PICKUP: WeekSchedule = { "1": wk, "2": wk, "3": wk, "4": wk, "5": wk, "6": [{ from: "09:30", to: "13:00" }], "7": [] };
const short = [{ from: "09:30", to: "16:00" }];
const DELIVERY: WeekSchedule = { "1": short, "2": short, "3": short, "4": short, "5": short, "6": [], "7": [] };
const branches = [{ id: "b-norte", name: "Sucursal Norteña" }, { id: "b-sur", name: "Sur Inventada" }];
const version = (id: string, validFrom: string, branchOrderHours?: ConfigVersion["data"]["branchOrderHours"]): ConfigVersion => ({
  id, validFrom, createdAt: new Date("2026-02-20T00:00:00Z"),
  data: { schemaVersion: 1, publicHours: EMPTY, operatorHours: EMPTY, firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [], ...(branchOrderHours ? { branchOrderHours } : {}) },
});
const versions = [version("v1", "2026-03-01", [{ branchId: "b-norte", pickup: PICKUP, delivery: DELIVERY }])];
const notice = (when: string, over: Partial<DerivationRow> = {}) =>
  ({ at: at(when), delivery: false, noticeBranch: "sucursal norteña", customerBranch: null, botBranch: null, ...over });
// 2026-03-03 es martes, 2026-03-07 sábado, 2026-03-08 domingo.

test("dentro del horario de pedidos de la sucursal: derivado dentro del horario; fuera, la derivación es correcta", () => {
  assert.equal(derivationTiming(notice("2026-03-03T17:05"), branches, versions), "EN_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-03T18:00"), branches, versions), "FUERA_HORARIO", "a las 18:00 ya cerró");
  assert.equal(derivationTiming(notice("2026-03-03T19:05"), branches, versions), "FUERA_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-07T12:00"), branches, versions), "EN_HORARIO", "sábado a la mañana");
  assert.equal(derivationTiming(notice("2026-03-07T16:00"), branches, versions), "FUERA_HORARIO", "sábado a la tarde");
  assert.equal(derivationTiming(notice("2026-03-08T11:00"), branches, versions), "FUERA_HORARIO", "domingo");
});

test("retiro y envíos tienen cada uno su horario: un aviso sobre envíos se compara con el de envíos", () => {
  // Martes 17:05: la sucursal todavía toma pedidos para retirar, pero ya no envía.
  assert.equal(derivationTiming(notice("2026-03-03T17:05", { delivery: false }), branches, versions), "EN_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-03T17:05", { delivery: true }), branches, versions), "FUERA_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-03T11:00", { delivery: true }), branches, versions), "EN_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-07T11:00", { delivery: true }), branches, versions), "FUERA_HORARIO", "el sábado no hay envíos");
});

test("feriado: no hay horario de pedidos", () => {
  // 23/11/2026 es feriado y cae lunes.
  const vs = [version("v1", "2026-11-01", [{ branchId: "b-norte", pickup: PICKUP, delivery: DELIVERY }])];
  assert.equal(derivationTiming(notice("2026-11-23T11:00"), branches, vs), "FUERA_HORARIO");
  assert.equal(derivationTiming(notice("2026-11-24T11:00"), branches, vs), "EN_HORARIO");
});

test("sucursal: la del aviso; si no la nombra, la que eligió el cliente; si no, la del bot; sin ninguna no se marca", () => {
  const r = { noticeBranch: null, customerBranch: null, botBranch: null };
  assert.equal(resolveBranchId({ ...r, noticeBranch: "sur inventada", customerBranch: "sucursal norteña" }, branches), "b-sur");
  assert.equal(resolveBranchId({ ...r, customerBranch: "SUCURSAL NORTEÑA", botBranch: "sur inventada" }, branches), "b-norte");
  assert.equal(resolveBranchId({ ...r, botBranch: "Sucursal  Nortena" }, branches), "b-norte", "sin acentos y con espacios de más");
  assert.equal(resolveBranchId({ ...r, noticeBranch: "un lugar que no es sucursal", botBranch: "sur inventada" }, branches), "b-sur");
  assert.equal(resolveBranchId(r, branches), null);
  assert.equal(normalizeBranchName("  Sucursal   Norteña "), "sucursal nortena");
  assert.equal(derivationTiming(notice("2026-03-03T17:05", { noticeBranch: null }), branches, versions), "SIN_SUCURSAL");
  assert.equal(derivationTiming(notice("2026-03-03T17:05", { noticeBranch: null, customerBranch: "sucursal norteña" }), branches, versions), "EN_HORARIO");
});

test("sucursal sin horario cargado, o configuración sin el campo: no se marca dentro ni fuera", () => {
  assert.equal(derivationTiming(notice("2026-03-03T17:05", { noticeBranch: "sur inventada" }), branches, versions), "SIN_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-03T17:05"), branches, [version("v0", "2026-03-01")]), "SIN_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-03T17:05"), branches, []), "SIN_HORARIO");
});

test("el horario rige día por día: un cambio no recalcula el pasado", () => {
  const vs = [
    version("v1", "2026-03-01", [{ branchId: "b-norte", pickup: PICKUP, delivery: DELIVERY }]),
    version("v2", "2026-03-10", [{ branchId: "b-norte", pickup: { ...PICKUP, "2": [{ from: "09:30", to: "16:00" }] }, delivery: DELIVERY }]),
  ];
  assert.equal(derivationTiming(notice("2026-03-03T17:05"), branches, vs), "EN_HORARIO");
  assert.equal(derivationTiming(notice("2026-03-10T17:05"), branches, vs), "FUERA_HORARIO");
});

test("Reclamos y pérdidas: los derivados dentro del horario van como posible venta perdida, en su propio motivo", () => {
  const r = buildDetectedReport([], {
    now: at("2026-03-05T12:00"), from: "2026-03-03", to: "2026-03-04", conversations: 10,
    derivedInHours: [{ conversationId: "c1", createdAt: at("2026-03-03T17:00"), open: false }, { conversationId: "c2", createdAt: at("2026-03-04T11:00"), open: true }],
  });
  const count = (m: string) => r.sales.byMotive.find((b) => b.motive === m)?.count;
  assert.deepEqual([count("DERIVED_IN_HOURS"), count("ELSEWHERE"), r.sales.conversations], [2, 0, 2]);
  assert.deepEqual(r.sales.cases.map((c) => [c.conversationId, c.motive]), [["c2", "DERIVED_IN_HOURS"], ["c1", "DERIVED_IN_HOURS"]]);
  // Sin el dato, el informe queda como antes.
  const sin = buildDetectedReport([], { now: at("2026-03-05T12:00"), from: "2026-03-03", to: "2026-03-04", conversations: 10 });
  assert.equal(sin.sales.byMotive.find((b) => b.motive === "DERIVED_IN_HOURS")?.count, 0);
});

console.log(`\nmetrics/derivation: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
