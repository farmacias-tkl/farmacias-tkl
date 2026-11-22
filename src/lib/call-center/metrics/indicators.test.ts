/**
 * Integridad del diccionario de indicadores. PURO.
 *
 *   npx tsx src/lib/call-center/metrics/indicators.test.ts
 */
import assert from "node:assert/strict";
import {
  INDICATORS, EVIDENCE_LABELS, POPULATION_LABELS, indicator, indicatorsOfBlock, effectiveEvidence,
  type IndicatorBlock,
} from "./indicators";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

test("claves únicas", () => {
  const keys = INDICATORS.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("cada indicador tiene nombre, definición y fuente; nivel y población conocidos", () => {
  for (const i of INDICATORS) {
    assert.ok(i.label.trim().length > 0, `${i.key}: sin nombre`);
    assert.ok(i.definition.trim().length >= 20, `${i.key}: definición muy corta`);
    assert.ok(i.source.trim().length > 0, `${i.key}: sin fuente`);
    assert.ok(i.evidence in EVIDENCE_LABELS, `${i.key}: nivel desconocido`);
    assert.ok(i.population in POPULATION_LABELS, `${i.key}: población desconocida`);
    assert.notEqual(i.evidence, "NO_DISPONIBLE", `${i.key}: "No disponible" no es un nivel propio de un indicador`);
  }
});

test("ningún indicador de la v1 se declara Confirmado: todavía no hay validación de una persona", () => {
  assert.equal(INDICATORS.filter((i) => i.evidence === "CONFIRMADO").length, 0);
});

test("todos los bloques tienen indicadores", () => {
  const blocks: IndicatorBlock[] = ["AHORA", "ATENCION", "OPERADORES", "VENTAS", "DETECTADOS", "DATOS"];
  for (const b of blocks) assert.ok(indicatorsOfBlock(b).length > 0, `bloque ${b} vacío`);
});

test("lo que sale de interpretar texto es Detectado, con sus límites", () => {
  for (const key of ["queue.thanks_candidates", "queue.completed_orders_waiting", "management_type", "detected.candidates", "late_orders_same_day"]) {
    assert.equal(indicator(key).evidence, "DETECTADO", key);
    assert.ok(indicator(key).limitations.length > 0, `${key}: sin límites`);
  }
});

test("las ventas y todo lo que usa horario o meta necesitan configuración", () => {
  for (const i of indicatorsOfBlock("VENTAS")) assert.equal(i.needsConfig, true, i.key);
  for (const key of ["first_response.business", "goal.compliance", "pending_at_close", "account.observed_activity"]) {
    assert.equal(indicator(key).needsConfig, true, key);
  }
});

test("sin configuración, un indicador que la necesita se muestra No disponible; el resto no cambia", () => {
  assert.equal(effectiveEvidence(indicator("goal.compliance"), false), "NO_DISPONIBLE");
  assert.equal(effectiveEvidence(indicator("goal.compliance"), true), "MEDIDO");
  assert.equal(effectiveEvidence(indicator("entries"), false), "MEDIDO");
});

test("las medianas declaran que se calculan entre respondidas", () => {
  for (const key of ["first_response.clock", "first_response.business", "first_response.from_first_message"]) {
    assert.match(indicator(key).denominator ?? "", /respondidas/i, key);
  }
});

test("el indicador de volúmenes no se presenta como conversión", () => {
  const def = indicator("sales.receipts_per_100_orders");
  assert.ok(!/conversi[oó]n/i.test(def.label));
  assert.ok(def.limitations.some((l) => /no una tasa de conversi[oó]n/i.test(l)));
});

test("no hay indicadores de CSAT, NPS ni porcentaje de resolución", () => {
  for (const i of INDICATORS) {
    assert.ok(!/csat|nps|satisfacci[oó]n|resoluci[oó]n/i.test(`${i.key} ${i.label}`), i.key);
  }
});

test("clave inexistente → error", () => {
  assert.throws(() => indicator("no.existe"));
});

console.log(`\nmetrics/indicators: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
