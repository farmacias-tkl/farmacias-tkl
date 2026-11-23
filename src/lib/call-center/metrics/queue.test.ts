/**
 * Resumen de la cola a partir de filas ya leídas. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/queue.test.ts
 */
import assert from "node:assert/strict";
import { ageBucket, buildQueueSnapshot, itemsForList, type WaitingRow } from "./queue";
import { isThanksCandidate } from "./patterns";

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
  conversationId: id, open: false, status: "RESUELTA", externalAssigneeId: null, createdAt: hoursAgo(5), waitStart: hoursAgo(5), lastCustomerAt: hoursAgo(5), hasHumanResponse: false,
  botExitAt: hoursAgo(4.9), botOrderComplete: false, customerChars: 200, customerSentMedia: false,
  customerSentLink: false, previousResolvedRecently: false, ...over,
});

test("antigüedad: límites de 24 h, 72 h y 30 días", () => {
  assert.equal(ageBucket(hoursAgo(23.9), NOW), "lt24h");
  assert.equal(ageBucket(hoursAgo(24), NOW), "h24to72");
  assert.equal(ageBucket(hoursAgo(71.9), NOW), "h24to72");
  assert.equal(ageBucket(hoursAgo(72), NOW), "d3to30");
  assert.equal(ageBucket(hoursAgo(24 * 30), NOW), "gt30d");
});

test("abiertas y cerradas van por separado; nunca respondidas y esperando la siguiente también", () => {
  const s = buildQueueSnapshot([
    row("a", { open: true }),
    row("b", { open: true, hasHumanResponse: true }),
    row("c"),
    row("d", { hasHumanResponse: true }),
    row("e", { hasHumanResponse: true }),
  ], NOW, SINCE);
  assert.equal(s.openWaiting.total, 2);
  assert.equal(s.openWaiting.neverHuman, 1);
  assert.equal(s.openWaiting.awaitingNext, 1);
  assert.equal(s.closedUnanswered.total, 3);
  assert.equal(s.closedUnanswered.neverHuman, 1);
  assert.equal(s.closedUnanswered.awaitingNext, 2);
});

test("una abierta de hace 45 días sigue contando y sigue en la lista", () => {
  const s = buildQueueSnapshot([row("vieja", { open: true, waitStart: hoursAgo(24 * 45), createdAt: hoursAgo(24 * 45) })], NOW, SINCE);
  assert.equal(s.openWaiting.total, 1);
  assert.equal(s.openWaiting.byAge.gt30d, 1);
  assert.equal(s.openOlderThanListWindow, 1);
  assert.equal(itemsForList(s).length, 1);
});

test("las 72 horas filtran la lista de cerradas, no el conteo", () => {
  const s = buildQueueSnapshot([
    row("reciente", { waitStart: hoursAgo(10) }),
    row("vieja", { waitStart: hoursAgo(100) }),
  ], NOW, SINCE);
  assert.equal(s.closedUnanswered.total, 2);
  assert.equal(s.closedUnanswered.byAge.d3to30, 1);
  assert.deepEqual(itemsForList(s).map((i) => i.conversationId), ["reciente"]);
  assert.equal(itemsForList(s, 24 * 30).length, 2);
});

test("sin salida del bot registrada: entra en la cola y se cuenta aparte", () => {
  const s = buildQueueSnapshot([row("x", { open: true, botExitAt: null }), row("y", { botExitAt: null })], NOW, SINCE);
  assert.equal(s.openWaiting.total, 1);
  assert.equal(s.openWaiting.noBotExit, 1);
  assert.equal(s.closedUnanswered.noBotExit, 1);
});

test("pedido completo esperando: solo si nunca tuvo respuesta de una persona", () => {
  const s = buildQueueSnapshot([
    row("p1", { botOrderComplete: true }),
    row("p2", { botOrderComplete: true, hasHumanResponse: true }),
  ], NOW, SINCE);
  assert.equal(s.closedUnanswered.completedOrders, 1);
});

test("candidato a agradecimiento: se cuenta aparte y NO se resta del total", () => {
  const cand = row("g", { previousResolvedRecently: true, customerChars: 7 });
  const s = buildQueueSnapshot([cand, row("otro")], NOW, SINCE);
  assert.equal(s.closedUnanswered.total, 2);
  assert.equal(s.closedUnanswered.neverHuman, 2);
  assert.equal(s.closedUnanswered.thanksCandidates, 1);
  assert.equal(s.items.find((i) => i.conversationId === "g")?.thanksCandidate, true);
});

test("no es candidato: con adjunto, con enlace, con pedido completo, largo, sin cierre previo o ya respondido", () => {
  const base = { hasHumanResponse: false, previousResolvedRecently: true, customerChars: 10, customerSentMedia: false, customerSentLink: false, botOrderComplete: false };
  assert.equal(isThanksCandidate(base), true);
  assert.equal(isThanksCandidate({ ...base, customerChars: 40 }), true);
  assert.equal(isThanksCandidate({ ...base, customerChars: 41 }), false);
  assert.equal(isThanksCandidate({ ...base, customerSentMedia: true }), false);
  assert.equal(isThanksCandidate({ ...base, customerSentLink: true }), false);
  assert.equal(isThanksCandidate({ ...base, botOrderComplete: true }), false);
  assert.equal(isThanksCandidate({ ...base, previousResolvedRecently: false }), false);
  assert.equal(isThanksCandidate({ ...base, hasHumanResponse: true }), false);
});

test("orden: de la espera más vieja a la más nueva; espera más vieja por grupo", () => {
  const s = buildQueueSnapshot([
    row("n", { open: true, waitStart: hoursAgo(1) }),
    row("v", { open: true, waitStart: hoursAgo(30) }),
    row("m", { waitStart: hoursAgo(8) }),
  ], NOW, SINCE);
  assert.deepEqual(s.items.map((i) => i.conversationId), ["v", "m", "n"]);
  assert.equal(s.openWaiting.oldestWaitStart?.getTime(), hoursAgo(30).getTime());
  assert.equal(s.closedUnanswered.oldestWaitStart?.getTime(), hoursAgo(8).getTime());
  assert.equal(Math.round(s.items[0].waitHours), 30);
});

test("sin filas: todo en cero y sin espera más vieja", () => {
  const s = buildQueueSnapshot([], NOW, SINCE);
  assert.equal(s.openWaiting.total, 0);
  assert.equal(s.closedUnanswered.total, 0);
  assert.equal(s.openWaiting.oldestWaitStart, null);
  assert.deepEqual(s.items, []);
});

test("las filas no llevan teléfono, nombre ni texto del cliente", () => {
  const s = buildQueueSnapshot([row("z")], NOW, SINCE);
  assert.ok(!/phone|name|body|displayName/i.test(Object.keys(s.items[0]).join(",")));
});

console.log(`\nmetrics/queue: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
