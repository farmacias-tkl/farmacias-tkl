/**
 * Importación del histórico de etiquetas. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/labels-import.test.ts
 */
import assert from "node:assert/strict";
import { parseLabelsFile, planLabelsImport, type ExistingConversation } from "./labels-import";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

test("archivo: una conversación por línea, solo id y labels; lo demás se rechaza sin copiar el contenido", () => {
  const text = [
    '{"id":"9001","labels":["solo_consulta","a_mi_domicilio"]}',
    '{"id":9002,"labels":[]}',
    "",
    '{"id":"9003","labels":["venta_concretada"],"phone":"+5491100000001"}',
    '{"id":"9004","labels":"no-es-lista"}',
    '{"labels":["x"]}',
    "esto no es json",
    '{"id":"9001","labels":["venta_concretada","texto libre con espacios"]}',
  ].join("\n");
  const p = parseLabelsFile(text);
  assert.deepEqual(p.rows, [{ externalConversationId: "9001", labels: ["venta_concretada"] }, { externalConversationId: "9002", labels: [] }]);
  assert.deepEqual(p.rejected.map((r) => r.line), [4, 5, 6, 7]);
  assert.equal(p.duplicatedIds, 1);
  assert.ok(!JSON.stringify(p.rejected).includes("5491100000001"), "el motivo no lleva el contenido de la línea");
});

test("plan: cambia etiquetas, completa el resultado solo en resueltas sin resultado, y no toca lo demás", () => {
  const existing: ExistingConversation[] = [
    { externalConversationId: "9001", resolved: true, externalLabels: [], closureTypeName: null },
    { externalConversationId: "9002", resolved: true, externalLabels: ["solo_consulta"], closureTypeName: "solo_consulta" },
    { externalConversationId: "9003", resolved: false, externalLabels: [], closureTypeName: null },
    { externalConversationId: "9004", resolved: true, externalLabels: ["a_mi_domicilio"], closureTypeName: null },
    { externalConversationId: "9005", resolved: true, externalLabels: [], closureTypeName: "venta_concretada" },
  ];
  const rows = [
    { externalConversationId: "9001", labels: ["a_mi_domicilio", "solo_consulta"] },
    { externalConversationId: "9002", labels: ["solo_consulta"] },
    { externalConversationId: "9003", labels: ["venta_concretada"] },
    { externalConversationId: "9004", labels: ["a_mi_domicilio"] },
    { externalConversationId: "9005", labels: ["solo_consulta"] },
    { externalConversationId: "9999", labels: ["solo_consulta"] },
  ];
  const plan = planLabelsImport(rows, existing, new Set(["solo_consulta", "venta_concretada"]));
  assert.deepEqual(plan.changes, [
    { externalConversationId: "9001", labels: ["a_mi_domicilio", "solo_consulta"], closureLabel: "solo_consulta" },
    // Abierta: se guardan las etiquetas, pero no hay resultado de cierre.
    { externalConversationId: "9003", labels: ["venta_concretada"], closureLabel: null },
    // Ya tiene resultado: no se pisa, solo cambian las etiquetas.
    { externalConversationId: "9005", labels: ["solo_consulta"], closureLabel: null },
  ]);
  assert.deepEqual([plan.unchanged, plan.notFound], [2, 1]);
  // Sin etiquetas de cierre en la configuración solo cambian etiquetas.
  assert.ok(planLabelsImport(rows, existing, new Set()).changes.every((c) => c.closureLabel === null));
});

console.log(`\nlabels-import: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
