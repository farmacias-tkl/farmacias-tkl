/**
 * Resultado de cierre confirmado por el operador. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/closure-outcome.test.ts
 */
import assert from "node:assert/strict";
import { closureMapOf, closureOutcomeOf } from "./closure-outcome";
import { buildAccountsReport, type ClosureAttribution, type OperatorMessageRow } from "./accounts";
import { closureLabelOf } from "../ingest";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const map = closureMapOf({ closureLabels: [{ label: "venta_concretada", outcome: "VENTA" }, { label: "solo_consulta", outcome: "CONSULTA" }] });
const conv = (over: Partial<Parameters<typeof closureOutcomeOf>[0]> = {}) => ({ resolved: true, closureTypeName: null, labels: [] as string[], ...over });

test("el resultado sale del que guardó la ingesta; si no hay, de las etiquetas de la conversación", () => {
  assert.deepEqual(closureOutcomeOf(conv({ closureTypeName: "venta_concretada", labels: ["solo_consulta"] }), map), { label: "venta_concretada", outcome: "VENTA" });
  assert.deepEqual(closureOutcomeOf(conv({ labels: ["a_mi_domicilio", "solo_consulta"] }), map), { label: "solo_consulta", outcome: "CONSULTA" });
  // Un nombre guardado que la configuración no conoce (un tipo de cierre de Emozion) no es un resultado: se miran las etiquetas.
  assert.deepEqual(closureOutcomeOf(conv({ closureTypeName: "Tipo inventado", labels: ["venta_concretada"] }), map)?.outcome, "VENTA");
});

test("etiquetas que no son de cierre, conversación reabierta o configuración sin etiquetas: sin resultado", () => {
  assert.equal(closureOutcomeOf(conv({ labels: ["a_mi_domicilio", "retiro_en_sucursal", "tkl_san_miguel", "dr_app"] }), map), null);
  assert.equal(closureOutcomeOf(conv({ resolved: false, closureTypeName: "venta_concretada", labels: ["venta_concretada"] }), map), null);
  assert.equal(closureOutcomeOf(conv({ closureTypeName: "venta_concretada" }), closureMapOf(null)), null);
  assert.equal(closureMapOf({}).size, 0);
});

test("ingesta: la etiqueta de cierre es la última de la lista que la configuración define como de cierre", () => {
  const set = new Set(["venta_concretada", "solo_consulta"]);
  assert.equal(closureLabelOf(["a_mi_domicilio", "solo_consulta", "dr_app"], set), "solo_consulta");
  assert.equal(closureLabelOf(["solo_consulta", "venta_concretada"], set), "venta_concretada");
  assert.equal(closureLabelOf(["a_mi_domicilio", "tkl_san_miguel"], set), null);
  assert.equal(closureLabelOf(null, set), null);
  assert.equal(closureLabelOf(["solo_consulta"], new Set()), null);
});

test("ingesta: la etiqueta de cierre se decide por diferencia contra las etiquetas guardadas", () => {
  const set = new Set(["venta_concretada", "solo_consulta"]);
  // La que el evento agrega, aunque no sea la última de la lista.
  assert.equal(closureLabelOf(["venta_concretada", "a_mi_domicilio", "solo_consulta"], set, ["a_mi_domicilio", "solo_consulta"]), "venta_concretada");
  // No agrega ninguna de cierre y hay una sola: esa (evento repetido, o misma resolución otra vez).
  assert.equal(closureLabelOf(["a_mi_domicilio", "solo_consulta"], set, ["a_mi_domicilio", "solo_consulta"]), "solo_consulta");
  // No agrega ninguna de cierre y hay varias: no se puede saber cuál vale.
  assert.equal(closureLabelOf(["solo_consulta", "venta_concretada"], set, ["venta_concretada", "solo_consulta"]), null);
  // Agrega una etiqueta que no es de cierre: no cambia nada de lo anterior.
  assert.equal(closureLabelOf(["solo_consulta", "venta_concretada", "dr_app"], set, ["solo_consulta", "venta_concretada"]), null);
});

test("Operadores: el cierre se atribuye a la cuenta asignada al resolver, una sola vez por conversación", () => {
  const at = (s: string) => new Date(`${s}:00.000-03:00`);
  const msg = (account: string, conversationId: string): OperatorMessageRow => ({ account, conversationId, sentAt: at("2026-03-03T11:00"), isPrivate: false });
  const messages = [msg("9001", "c1"), msg("9001", "c2"), msg("9001", "c3"), msg("9002", "c1")];
  // c1: escribieron 9001 y 9002, la cerró 9002. c2: la cerró 9001. c3: se resolvió sin asignado.
  // c4: la cerró 9003, que no escribió en el período. c9: sin mensajes de operador en el período, no entra.
  const outcomes = new Map<string, ClosureAttribution>([
    ["c1", { outcome: "VENTA", account: "9002" }], ["c2", { outcome: "CONSULTA", account: "9001" }],
    ["c3", { outcome: "SIN_STOCK", account: null }], ["c4", { outcome: "VENTA", account: "9003" }],
    ["c9", { outcome: "VENTA", account: "9001" }],
  ]);
  const r = buildAccountsReport({ messages: [...messages, msg("9001", "c4")], followups: [], facts: [], outcomes }, { now: at("2026-03-04T12:00"), versions: [] });
  const by = Object.fromEntries(r.accounts.map((a) => [a.account, a.closures]));
  assert.deepEqual([by["9001"]!.VENTA, by["9001"]!.CONSULTA, by["9001"]!.SIN_STOCK], [0, 1, 0], "escribir en una conversación no es cerrarla");
  assert.deepEqual([by["9002"]!.VENTA, by["9002"]!.CONSULTA], [1, 0]);
  assert.deepEqual([by["9003"]!.VENTA, r.accounts.find((a) => a.account === "9003")!.conversations], [1, 0], "la cuenta que cerró aparece aunque no haya escrito");
  assert.deepEqual([r.closuresWithoutAccount!.SIN_STOCK, r.closuresWithoutAccount!.VENTA], [1, 0], "resuelta sin asignado: no se atribuye a nadie");
  const total = r.accounts.reduce((n, a) => n + Object.values(a.closures!).reduce((x, y) => x + y, 0), 0);
  assert.equal(total, 3, "cada conversación cuenta una sola vez");
  // Sin etiquetas de cierre en la configuración: sin dato, no cero.
  const sin = buildAccountsReport({ messages, followups: [], facts: [] }, { now: at("2026-03-04T12:00"), versions: [] });
  assert.deepEqual([sin.accounts[0].closures, sin.closuresWithoutAccount], [null, null]);
});

console.log(`\nmetrics/closure-outcome: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
