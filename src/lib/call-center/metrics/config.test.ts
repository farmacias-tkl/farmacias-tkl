/**
 * Validación y vigencia de la configuración de las métricas. PURO, sin base. Todos los
 * datos son inventados (cuentas, sucursales, horarios).
 *
 *   npx tsx src/lib/call-center/metrics/config.test.ts
 */
import assert from "node:assert/strict";
import { parseConfigData, hhmmToMinutes, isSystemAccount, type CallCenterMetricsConfigData } from "./config-schema";
import { configForDay, sortVersions, versionPeriodLabel, versionPeriods, type ConfigVersion } from "./config";

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

test("cuenta de sistema: campo opcional; una versión guardada sin él sigue siendo válida y equivale a false", () => {
  const sinCampo = parseConfigData(base()); // ninguna cuenta de base() trae `system`
  assert.equal(sinCampo.ok, true);
  if (sinCampo.ok) {
    assert.equal(sinCampo.data.accounts.every((a) => !isSystemAccount(a)), true);
    assert.equal("system" in sinCampo.data.accounts[0], false, "no se inventa el campo al leer");
  }
  const con = base();
  con.accounts[0].system = true;
  con.accounts[1].system = false;
  const r = parseConfigData(con);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(isSystemAccount(r.data.accounts[0]), true);
    assert.equal(isSystemAccount(r.data.accounts[1]), false);
    assert.equal(isSystemAccount(r.data.accounts[2]), false);
  }
});

test("cuenta de sistema: tiene que ser sí o no", () => {
  const cfg = base() as unknown as { accounts: Array<Record<string, unknown>> };
  cfg.accounts[0].system = "sí";
  assert.ok(errorsOf(cfg).some((e) => e.startsWith("accounts")));
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

// ── Período de cada versión (tabla de versiones) ─────────────────────────────────────
test("períodos: la corregida reemplaza a la de su misma fecha; las que rigen llegan hasta el día anterior a la siguiente", () => {
  const p = versionPeriods(versions);
  assert.deepEqual(p.get("a"), { superseded: false, from: "2026-01-01", to: "2026-02-28" });
  assert.deepEqual(p.get("b"), { superseded: true });
  assert.deepEqual(p.get("b2"), { superseded: false, from: "2026-03-01", to: "2026-06-14" });
  assert.deepEqual(p.get("c"), { superseded: false, from: "2026-06-15", to: null });
  assert.equal(p.size, versions.length);
});

test("períodos: coinciden con configForDay en el primer y el último día de cada uno", () => {
  for (const [id, period] of versionPeriods(versions)) {
    if (period.superseded) continue;
    assert.equal(configForDay(versions, period.from)?.id, id, `${id} primer día`);
    if (period.to) assert.equal(configForDay(versions, period.to)?.id, id, `${id} último día`);
  }
  // Una versión reemplazada no rige ningún día: nunca es la respuesta de configForDay.
  for (const day of ["2026-03-01", "2026-04-15", "2026-06-14"]) assert.notEqual(configForDay(versions, day)?.id, "b");
});

test("períodos: tres versiones de la misma fecha → rige la última creada y las otras dos quedan reemplazadas", () => {
  const tres = [
    v("x1", "2026-09-01", "2026-11-22T14:48:00Z"), v("x2", "2026-09-01", "2026-11-22T14:58:00Z"),
    v("x3", "2026-09-01", "2026-11-22T15:01:00Z"), v("y", "2026-11-06", "2026-11-22T15:01:00Z"),
  ];
  const p = versionPeriods(tres);
  assert.deepEqual([p.get("x1"), p.get("x2")], [{ superseded: true }, { superseded: true }]);
  assert.deepEqual(p.get("x3"), { superseded: false, from: "2026-09-01", to: "2026-11-05" });
  assert.deepEqual(p.get("y"), { superseded: false, from: "2026-11-06", to: null });
  assert.equal(versionPeriodLabel(p.get("x3")!, "2026-11-22"), "Rige del 01/09 al 05/11");
  assert.equal(versionPeriodLabel(p.get("y")!, "2026-11-22"), "Rige desde el 06/11");
  assert.equal(versionPeriodLabel(p.get("x1")!, "2026-11-22"), "Reemplazada");
});

test("períodos: texto con el año cuando no es el actual, y en futuro si todavía no empezó", () => {
  assert.equal(versionPeriodLabel({ superseded: false, from: "2025-12-01", to: "2026-01-31" }, "2026-11-22"), "Rige del 01/12/2025 al 31/01");
  assert.equal(versionPeriodLabel({ superseded: false, from: "2027-01-01", to: null }, "2026-11-22"), "Regirá desde el 01/01/2027");
  assert.equal(versionPeriodLabel({ superseded: false, from: "2026-12-01", to: "2026-12-31" }, "2026-11-22"), "Regirá del 01/12 al 31/12");
  assert.equal(versionPeriodLabel({ superseded: false, from: "2026-11-22", to: null }, "2026-11-22"), "Rige desde el 22/11");
});

test("períodos: sin versiones no hay nada; con una sola, rige sin fecha de fin", () => {
  assert.equal(versionPeriods([]).size, 0);
  assert.deepEqual(versionPeriods([versions[0]]).get("a"), { superseded: false, from: "2026-01-01", to: null });
});

console.log(`\nmetrics/config: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
