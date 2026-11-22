/**
 * Respuesta del bloque "Ahora". PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/now.test.ts
 */
import assert from "node:assert/strict";
import { toNowPayload } from "./now";
import { buildQueueSnapshot, type WaitingRow } from "./queue";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const NOW = new Date("2026-03-10T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const SINCE = hoursAgo(24 * 30);
const row = (id: string, over: Partial<WaitingRow> = {}): WaitingRow => ({
  conversationId: id, open: false, createdAt: hoursAgo(5), waitStart: hoursAgo(5), hasHumanResponse: false,
  botExitAt: hoursAgo(4.9), botOrderComplete: false, customerChars: 200, customerSentMedia: false,
  customerSentLink: false, previousResolvedRecently: false, ...over,
});
const FRESH = { lastWebhookAt: hoursAgo(0.01), lastMessageAt: hoursAgo(0.05) };
const payload = (rows: WaitingRow[], maxRows?: number) =>
  toNowPayload(buildQueueSnapshot(rows, NOW, SINCE), null, FRESH, 72, maxRows);

test("la lista muestra todas las abiertas y solo las cerradas de la ventana; los conteos no cambian", () => {
  const p = payload([
    row("abierta-vieja", { open: true, waitStart: hoursAgo(24 * 40) }),
    row("cerrada-reciente", { waitStart: hoursAgo(10) }),
    row("cerrada-vieja", { waitStart: hoursAgo(200) }),
  ]);
  assert.deepEqual(p.list.map((i) => i.conversationId), ["abierta-vieja", "cerrada-reciente"]);
  assert.equal(p.listTotal, 2);
  assert.equal(p.openWaiting.total, 1);
  assert.equal(p.closedUnanswered.total, 2);
  assert.equal(p.openOlderThanListWindow, 1);
  assert.equal(p.listWindowHours, 72);
});

test("tope de filas: quedan las esperas más viejas y se informa el total sin recortar", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(`c${i}`, { open: true, waitStart: hoursAgo(i + 1) }));
  const p = payload(rows, 3);
  assert.deepEqual(p.list.map((i) => i.conversationId), ["c9", "c8", "c7"]);
  assert.equal(p.listTotal, 10);
  assert.equal(p.openWaiting.total, 10);
});

test("cada fila: minutos de espera, marcas y sin salida del bot", () => {
  const p = payload([
    row("a", { open: true, waitStart: hoursAgo(1.5), botOrderComplete: true, botExitAt: null }),
    row("b", { waitStart: hoursAgo(2), previousResolvedRecently: true, customerChars: 6 }),
    row("c", { waitStart: hoursAgo(3), hasHumanResponse: true }),
  ]);
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i]));
  assert.equal(by.a.waitMinutes, 90);
  assert.deepEqual([by.a.botOrderComplete, by.a.noBotExit, by.a.thanksCandidate], [true, true, false]);
  assert.equal(by.b.thanksCandidate, true);
  assert.equal(by.c.hasHumanResponse, true);
  assert.equal(by.a.waitStart, hoursAgo(1.5).toISOString());
});

test("pedidos completos esperando: abiertas y cerradas, solo sin respuesta de una persona", () => {
  const p = payload([
    row("a", { open: true, botOrderComplete: true }),
    row("b", { botOrderComplete: true }),
    row("c", { botOrderComplete: true, hasHumanResponse: true }),
  ]);
  assert.equal(p.completedOrdersWaiting, 2);
});

test("histórico anterior a la ventana: se informa si está; si no se pudo calcular queda null, no cero", () => {
  const snap = buildQueueSnapshot([], NOW, SINCE);
  assert.equal(toNowPayload(snap, null, FRESH).closedBefore, null);
  const con = toNowPayload(snap, { before: SINCE, total: 7424, neverHuman: 2944, awaitingNext: 4480, completedOrders: 49 }, FRESH);
  assert.deepEqual(con.closedBefore, { total: 7424, neverHuman: 2944, awaitingNext: 4480, completedOrders: 49 });
  assert.equal(con.closedSince, SINCE.toISOString());
});

test("evidencia de actualización: fechas en ISO, o null si no hay datos", () => {
  const snap = buildQueueSnapshot([], NOW, SINCE);
  const p = toNowPayload(snap, null, { lastWebhookAt: null, lastMessageAt: hoursAgo(1) });
  assert.equal(p.freshness.lastWebhookAt, null);
  assert.equal(p.freshness.lastMessageAt, hoursAgo(1).toISOString());
  assert.equal(p.generatedAt, NOW.toISOString());
  assert.equal(p.openWaiting.oldestWaitStart, null);
});

test("la respuesta no lleva teléfono, nombre ni texto, y se puede serializar", () => {
  const p = payload([row("a", { open: true })]);
  const json = JSON.stringify(p);
  assert.ok(!/phone|displayName|body|customerChars/i.test(json));
  assert.deepEqual(JSON.parse(json), p);
});

console.log(`\nmetrics/now: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
