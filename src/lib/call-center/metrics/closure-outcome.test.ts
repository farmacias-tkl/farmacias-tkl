/**
 * Resultado de cierre confirmado por el operador. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/closure-outcome.test.ts
 */
import assert from "node:assert/strict";
import { closureMapOf, closureOutcomeOf } from "./closure-outcome";
import { buildAccountsReport, type OperatorMessageRow } from "./accounts";
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

test("Operadores: resultados de cierre de las conversaciones en las que escribió cada cuenta", () => {
  const at = (s: string) => new Date(`${s}:00.000-03:00`);
  const msg = (account: string, conversationId: string): OperatorMessageRow => ({ account, conversationId, sentAt: at("2026-03-03T11:00"), isPrivate: false });
  const messages = [msg("9001", "c1"), msg("9001", "c2"), msg("9001", "c3"), msg("9002", "c1")];
  const outcomes = new Map([["c1", "VENTA"], ["c2", "CONSULTA"]] as const);
  const r = buildAccountsReport({ messages, followups: [], facts: [], outcomes }, { now: at("2026-03-04T12:00"), versions: [] });
  const by = Object.fromEntries(r.accounts.map((a) => [a.account, a.closures]));
  assert.deepEqual([by["9001"]!.VENTA, by["9001"]!.CONSULTA, by["9001"]!.PEDIDO_NO_CONCRETADO], [1, 1, 0]);
  assert.deepEqual([by["9002"]!.VENTA, by["9002"]!.CONSULTA], [1, 0], "una conversación con dos cuentas cuenta en las dos");
  // Sin etiquetas de cierre en la configuración: sin dato, no cero.
  const sin = buildAccountsReport({ messages, followups: [], facts: [] }, { now: at("2026-03-04T12:00"), versions: [] });
  assert.equal(sin.accounts[0].closures, null);
});

console.log(`\nmetrics/closure-outcome: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
