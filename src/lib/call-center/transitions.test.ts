/**
 * Transiciones: acciones de operador y transiciones esperadas de la ingesta. PURO.
 *
 *   npx tsx src/lib/call-center/transitions.test.ts
 */
import assert from "node:assert/strict";
import { canTransition, isExpectedIngestedTransition } from "./transitions";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const STATUSES = ["PENDIENTE", "SIN_ASIGNAR", "ASIGNADA", "RESUELTA"] as const;
const HABITUALES = ["PENDIENTE>ASIGNADA", "SIN_ASIGNAR>RESUELTA", "RESUELTA>ASIGNADA"];

test("la ingesta espera las transiciones de operador más las tres habituales de Emozion, y ninguna otra", () => {
  for (const from of STATUSES) for (const to of STATUSES) {
    const expected = canTransition(from, to) || HABITUALES.includes(`${from}>${to}`);
    assert.equal(isExpectedIngestedTransition(from, to), expected, `${from}→${to}`);
  }
  // Siguen dando aviso, por ejemplo:
  assert.equal(isExpectedIngestedTransition("PENDIENTE", "RESUELTA"), false);
  assert.equal(isExpectedIngestedTransition("ASIGNADA", "PENDIENTE"), false);
  assert.equal(isExpectedIngestedTransition("ASIGNADA", "SIN_ASIGNAR"), false);
});

test("la lista de la ingesta no habilita nada para las acciones de operador", () => {
  assert.equal(canTransition("PENDIENTE", "ASIGNADA"), false);
  assert.equal(canTransition("SIN_ASIGNAR", "RESUELTA"), false);
  assert.equal(canTransition("RESUELTA", "ASIGNADA"), false);
});

console.log(`\ntransitions: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
