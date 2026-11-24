/**
 * Etiquetas vistas. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/labels-seen.test.ts
 */
import assert from "node:assert/strict";
import { LABELS_SEEN_MAX, labelsEverSeen, mergeLabelsSeen } from "./labels-seen";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

test("unión en orden de aparición, sin repetidos; null y ausentes no aportan", () => {
  assert.deepEqual(mergeLabelsSeen(["sucursal_a", "retiro"], null, ["retiro", "cierre_x"], undefined, []), ["sucursal_a", "retiro", "cierre_x"]);
  assert.deepEqual(mergeLabelsSeen(), []);
  assert.deepEqual(mergeLabelsSeen(null, undefined), []);
});

test("solo suma: una lista actual más corta no quita lo ya visto", () => {
  const vistas = mergeLabelsSeen(["sucursal_a", "retiro"]);
  assert.deepEqual(mergeLabelsSeen(vistas, ["cierre_x"]), ["sucursal_a", "retiro", "cierre_x"]);
  assert.deepEqual(mergeLabelsSeen(vistas, []), ["sucursal_a", "retiro"]);
});

test("tope: no pasa de LABELS_SEEN_MAX", () => {
  const muchas = Array.from({ length: LABELS_SEEN_MAX + 20 }, (_, i) => `e_${i}`);
  const r = mergeLabelsSeen(["primera"], muchas);
  assert.equal(r.length, LABELS_SEEN_MAX);
  assert.equal(r[0], "primera");
});

test("etiquetas para leer sucursal o modalidad: vistas más actuales; sin el dato, solo las actuales", () => {
  assert.deepEqual(labelsEverSeen({ externalLabelsSeen: ["sucursal_a"], externalLabels: ["cierre_x"] }), ["sucursal_a", "cierre_x"]);
  assert.deepEqual(labelsEverSeen({ externalLabelsSeen: [], externalLabels: ["cierre_x"] }), ["cierre_x"]);
  assert.deepEqual(labelsEverSeen({ externalLabels: ["cierre_x"] }), ["cierre_x"]);
});

console.log(`\ncall-center/labels-seen: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
