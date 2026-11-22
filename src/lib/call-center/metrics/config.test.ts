/**
 * Validación y vigencia de la configuración de las métricas. PURO, sin base. Todos los
 * datos son inventados (cuentas, sucursales, horarios).
 *
 *   npx tsx src/lib/call-center/metrics/config.test.ts
 */
import assert from "node:assert/strict";
import { parseConfigData, hhmmToMinutes, type CallCenterMetricsConfigData } from "./config-schema";
import { configForDay, sortVersions, type ConfigVersion } from "./config";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const weekdays = [{ from: "10:00", to: "18:00" }];
const base = (): CallCenterMetricsConfigData => ({
  schemaVersion: 1,
  publicHours: { "1": weekdays, "2": weekdays, "3": weekdays, "4": weekdays, "5": weekdays, "6": [{ from: "09:00", to: "12:00" }], "7": [] },
  operatorHours: {
    "1": [{ from: "09:00", to: "19:00" }], "2": [{ from: "09:00", to: "19:00" }], "3": [{ from: "09:00", to: "19:00" }],
    "4": [{ from: "09:00", to: "19:00" }], "5": [{ from: "09:00", to: "19:00" }],
    "6": [{ from: "09:00", to: "12:00" }, { from: "15:00", to: "19:30" }], "7": [{ from: "15:00", to: "20:00" }],
  },
  firstResponseGoalMinutes: 20,
  accounts: [
    { externalId: "9001", alias: "Cuenta inventada 1", active: true, borrowed: false, historical: false },
    { externalId: "9002", alias: null, active: true, borrowed: true, historical: false },
    { externalId: "9003", alias: null, active: false, borrowed: false, historical: true },
  ],
  callCenterVendors: [{ branchId: "branch-inventada-a", code: "V01" }, { branchId: "branch-inventada-b", code: "V01" }],
});
const errorsOf = (raw: unknown): string[] => {
  const r = parseConfigData(raw);
  return r.ok ? [] : r.errors;
};

test("configuración completa válida", () => {
  const r = parseConfigData(base());
  assert.equal(r.ok, true);
});

test("el mismo código de vendedor en dos sucursales es válido; repetido en la misma, no", () => {
  const cfg = base();
  cfg.callCenterVendors.push({ branchId: "branch-inventada-a", code: "V01" });
  assert.ok(errorsOf(cfg).some((e) => e.startsWith("callCenterVendors")));
});

test("cuenta repetida → error", () => {
  const cfg = base();
  cfg.accounts.push({ externalId: "9001", alias: null, active: true, borrowed: false, historical: false });
  assert.ok(errorsOf(cfg).some((e) => e.startsWith("accounts")));
});

test("cuenta activa e histórica a la vez → error", () => {
  const cfg = base();
  cfg.accounts[0].historical = true;
  assert.ok(errorsOf(cfg).length > 0);
});

test("franja que termina antes de empezar, hora mal formada y franjas superpuestas → error", () => {
  const a = base(); a.publicHours["1"] = [{ from: "18:00", to: "10:00" }];
  assert.ok(errorsOf(a).length > 0);
  const b = base(); b.publicHours["1"] = [{ from: "9:00", to: "18:00" }];
  assert.ok(errorsOf(b).length > 0);
  const c = base(); c.operatorHours["6"] = [{ from: "09:00", to: "13:00" }, { from: "12:00", to: "19:00" }];
  assert.ok(errorsOf(c).length > 0);
});

test("falta un día de la semana o sobra una clave → error", () => {
  const a = base() as unknown as Record<string, unknown>;
  delete (a.publicHours as Record<string, unknown>)["7"];
  assert.ok(errorsOf(a).length > 0);
  const b = { ...base(), extra: true };
  assert.ok(errorsOf(b).length > 0);
});

test("meta fuera de rango o no entera → error", () => {
  assert.ok(errorsOf({ ...base(), firstResponseGoalMinutes: 0 }).length > 0);
  assert.ok(errorsOf({ ...base(), firstResponseGoalMinutes: 12.5 }).length > 0);
});

test("los mensajes de error llevan la ruta del campo, no el valor", () => {
  const cfg = base();
  cfg.accounts[1].externalId = "valor con espacios 12345";
  const errors = errorsOf(cfg);
  assert.ok(errors.length > 0);
  assert.ok(!errors.join(" ").includes("12345"));
});

test("hhmmToMinutes: 00:00, 09:30 y 24:00 como fin", () => {
  assert.equal(hhmmToMinutes("00:00"), 0);
  assert.equal(hhmmToMinutes("09:30"), 570);
  assert.equal(hhmmToMinutes("24:00"), 1440);
});

// ── Vigencia ────────────────────────────────────────────────────────────────────────
const v = (id: string, validFrom: string, createdAt: string): ConfigVersion =>
  ({ id, validFrom, createdAt: new Date(createdAt), data: base() });
const versions = [
  v("a", "2026-01-01", "2026-01-01T12:00:00Z"),
  v("b", "2026-03-01", "2026-02-20T12:00:00Z"),
  v("b2", "2026-03-01", "2026-02-25T12:00:00Z"), // corrige a "b": misma vigencia, creada después
  v("c", "2026-06-15", "2026-06-01T12:00:00Z"),
];

test("vigencia: antes de la primera versión no hay configuración", () => {
  assert.equal(configForDay(versions, "2025-12-31"), null);
  assert.equal(configForDay([], "2026-05-01"), null);
});

test("vigencia: el día de inicio ya rige la versión nueva; el anterior, la vieja", () => {
  assert.equal(configForDay(versions, "2026-01-01")?.id, "a");
  assert.equal(configForDay(versions, "2026-02-28")?.id, "a");
  assert.equal(configForDay(versions, "2026-06-14")?.id, "b2");
  assert.equal(configForDay(versions, "2026-06-15")?.id, "c");
  assert.equal(configForDay(versions, "2030-01-01")?.id, "c");
});

test("vigencia: a igual fecha gana la creada más tarde", () => {
  assert.equal(configForDay(versions, "2026-03-01")?.id, "b2");
  assert.deepEqual(sortVersions(versions).map((x) => x.id), ["c", "b2", "b", "a"]);
});

test("vigencia: una versión futura no afecta el pasado", () => {
  const conFutura = [...versions, v("z", "2027-01-01", "2026-06-02T12:00:00Z")];
  assert.equal(configForDay(conFutura, "2026-12-31")?.id, "c");
});

console.log(`\nmetrics/config: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
