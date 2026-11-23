/**
 * Evolución de la cola. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/queue-trend.test.ts
 */
import assert from "node:assert/strict";
import { buildQueueTrend, pendingAt, type TrendRow } from "./queue-trend";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const NOW = new Date("2026-03-10T15:00:00.000Z");
/** Minutos antes de NOW, en milisegundos. */
const ago = (minutes: number) => NOW.getTime() - minutes * 60_000;
const row = (over: Partial<TrendRow>): TrendRow => ({ customer: [], operator: [], statusAt: [ago(100000)], statusTo: ["SIN_ASIGNAR"], ...over });

test("pendiente a una hora dada: abierta, último mensaje del cliente y hasta 72 horas de espera", () => {
  const r = row({ customer: [ago(300), ago(200), ago(50)], operator: [ago(100)] });
  assert.equal(pendingAt(r, ago(250)), true, "escribió y nadie respondió todavía");
  assert.equal(pendingAt(r, ago(80)), false, "ya le respondieron");
  assert.equal(pendingAt(r, ago(10)), true, "volvió a escribir después de la respuesta");
  assert.equal(pendingAt(r, ago(400)), false, "antes de su primer mensaje");
  // Una nota interna no llega acá (la consulta trae solo los mensajes públicos): sin operador sigue pendiente.
  assert.equal(pendingAt(row({ customer: [ago(30)] }), ago(0)), true);
});

test("pendiente: el estado es el de esa hora, no el de ahora", () => {
  const r = row({ customer: [ago(300)], statusAt: [ago(310), ago(200), ago(60)], statusTo: ["PENDIENTE", "RESUELTA", "SIN_ASIGNAR"] });
  assert.equal(pendingAt(r, ago(250)), true);
  assert.equal(pendingAt(r, ago(100)), false, "estaba resuelta");
  assert.equal(pendingAt(r, ago(10)), true, "se reabrió");
  // Sin ningún cambio de estado anterior, la conversación todavía no existía.
  assert.equal(pendingAt(row({ customer: [ago(300)], statusAt: [ago(100)], statusTo: ["PENDIENTE"] }), ago(200)), false);
});

test("pendiente: con más de 72 horas de espera deja de contar como reciente", () => {
  const r = row({ customer: [ago(73 * 60), ago(60)] });
  // Espera desde el primer mensaje sin responder, no desde el último.
  assert.equal(pendingAt(r, ago(0)), false);
  assert.equal(pendingAt(r, ago(120)), true, "dos horas antes llevaba 71 horas");
  assert.equal(pendingAt(row({ customer: [ago(73 * 60), ago(60)], operator: [ago(600)] }), ago(0)), true, "le respondieron en el medio: la espera cuenta desde el mensaje nuevo");
});

test("evolución: un punto cada 30 minutos desde el inicio y uno final ahora; últimos 60 minutos", () => {
  const rows = [
    row({ customer: [ago(170)] }),                         // pendiente todo el tramo
    row({ customer: [ago(170)], operator: [ago(100)] }),   // respondida hace 100 minutos
    row({ customer: [ago(170)], operator: [ago(40)] }),    // respondida en la última hora
    row({ customer: [ago(45)] }),                          // entró en la última hora
    row({ customer: [ago(200), ago(20)], operator: [ago(190), ago(30)] }), // respondida en la última hora y volvió a escribir
  ];
  const t = buildQueueTrend(rows, { now: NOW, from: new Date(ago(150)), fromIsShift: true, newConversations: 2 });
  assert.deepEqual(t.points.map((p) => [Math.round((NOW.getTime() - new Date(p.at).getTime()) / 60_000), p.pending]), [
    [150, 3], [120, 3], [90, 2], [60, 2], [30, 2], [0, 3],
  ]);
  assert.deepEqual(t.lastHour, { newConversations: 2, answered: 2, pendingBefore: 2, pendingNow: 3 });
  assert.deepEqual([t.fromIsShift, t.stepMinutes, t.generatedAt], [true, 30, NOW.toISOString()]);
  // La variación no es "entradas menos respondidas": entró 1, respondieron 2 y la cola subió 1.
  assert.equal(t.lastHour.pendingNow - t.lastHour.pendingBefore, 1);
});

test("evolución: inicio que no cae justo en un paso, y sin conversaciones", () => {
  const t = buildQueueTrend([], { now: NOW, from: new Date(ago(45)), fromIsShift: false, newConversations: 0 });
  assert.deepEqual(t.points.map((p) => Math.round((NOW.getTime() - new Date(p.at).getTime()) / 60_000)), [45, 15, 0]);
  assert.deepEqual(t.lastHour, { newConversations: 0, answered: 0, pendingBefore: 0, pendingNow: 0 });
});

console.log(`\nmetrics/queue-trend: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
