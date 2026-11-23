/**
 * Respuesta del bloque "Ahora". PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/now.test.ts
 */
import assert from "node:assert/strict";
import { ownerOf, toNowPayload, type NowExtras } from "./now";
import { buildQueueSnapshot, type WaitingRow } from "./queue";
import { buildClosedUnanswered, type ClosedBlockRow } from "./closed-unanswered";

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
  customerSentLink: false, previousResolvedRecently: false, urgent: false, insisting: false, ...over,
});
const open = (id: string, over: Partial<WaitingRow> = {}) => row(id, { open: true, status: "SIN_ASIGNAR", ...over });
const FRESH = { lastWebhookAt: hoursAgo(0.01), lastMessageAt: hoursAgo(0.05) };
const NONE: NowExtras = { history: null, today: null, closed: null, wait: null, accounts: [], openBlocks: null, progress: null, checks: null };
const payload = (rows: WaitingRow[], extras: NowExtras = NONE, maxRows?: number) =>
  toNowPayload(buildQueueSnapshot(rows, NOW, SINCE), extras, FRESH, 72, maxRows);

test("clientes esperando: recientes hasta 72 horas; las más viejas son posibles pendientes antiguos y las cerradas van aparte", () => {
  const p = payload([
    open("reciente", { waitStart: hoursAgo(2) }),
    open("otra", { waitStart: hoursAgo(50), hasHumanResponse: true }),
    open("vieja", { waitStart: hoursAgo(24 * 40) }),
    open("mas-vieja", { waitStart: hoursAgo(24 * 90) }),
    row("cerrada", { waitStart: hoursAgo(10) }),
  ]);
  assert.deepEqual(p.waiting, { total: 2, oldPending: 2, neverHuman: 1, awaitingNext: 1, completedOrders: 0, critical: null, oldestWaitStart: hoursAgo(50).toISOString(), urgent: 0, insisting: 0 });
  // Las antiguas sin señal de cierre entran en la lista, marcadas, antes que las recientes.
  assert.deepEqual(p.list.map((i) => [i.conversationId, i.oldPending]), [["mas-vieja", true], ["vieja", true], ["otra", false], ["reciente", false]]);
  assert.equal(p.listTotal, 4);
  assert.equal(p.stale.total, 2);
  assert.equal(p.stale.oldestWaitStart, hoursAgo(24 * 90).toISOString());
  assert.deepEqual(p.stale.items.map((i) => i.conversationId), ["mas-vieja", "vieja"]);
  assert.equal(p.windowHours, 72);
});

test("los conteos completos de la cola no cambian: quedan en calidad de datos", () => {
  const p = payload([open("a"), open("vieja", { waitStart: hoursAgo(200), botExitAt: null }), row("c1"), row("c2", { waitStart: hoursAgo(200) })]);
  assert.equal(p.quality.openWaiting.total, 2);
  assert.equal(p.quality.openWaiting.noBotExit, 1);
  assert.equal(p.quality.closedUnanswered.total, 2);
  assert.equal(p.quality.closedSince, SINCE.toISOString());
});

test("sin nadie esperando: cero y sin espera más larga", () => {
  const p = payload([row("cerrada")]);
  assert.deepEqual(p.waiting, { total: 0, oldPending: 0, neverHuman: 0, awaitingNext: 0, completedOrders: 0, critical: null, oldestWaitStart: null, urgent: 0, insisting: 0 });
  assert.deepEqual([p.list.length, p.stale.total, p.stale.oldestWaitStart], [0, 0, null]);
});

test("tope de filas: quedan las esperas más viejas y se informa el total sin recortar", () => {
  const rows = Array.from({ length: 10 }, (_, i) => open(`c${i}`, { waitStart: hoursAgo(i + 1) }));
  const p = payload(rows, NONE, 3);
  assert.deepEqual(p.list.map((i) => i.conversationId), ["c9", "c8", "c7"]);
  assert.equal(p.listTotal, 10);
  assert.equal(p.waiting.total, 10);
  // La demora crítica se cuenta sobre todos los que esperan, no solo sobre los de la lista.
  const wait = { pub: () => [{ from: 0, to: 1440 }], ops: () => [{ from: 0, to: 1440 }], goalMinutes: 15, criticalMinutes: 60 };
  const q = payload(rows.map((r) => ({ ...r, botExitAt: r.waitStart })), { ...NONE, wait }, 3);
  assert.deepEqual([q.list.length, q.waiting.critical], [3, 9]);
});

test("cada caso: espera, hora de entrada, estado y marcas", () => {
  const p = payload([
    open("a", { status: "ASIGNADA", createdAt: hoursAgo(8), waitStart: hoursAgo(1.5), botOrderComplete: true }),
    open("b", { waitStart: hoursAgo(2), previousResolvedRecently: true, customerChars: 6 }),
    open("c", { waitStart: hoursAgo(3), hasHumanResponse: true }),
  ]);
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i]));
  assert.deepEqual([by.a.waitMinutes, by.a.status, by.a.createdAt, by.a.waitStart], [90, "ASIGNADA", hoursAgo(8).toISOString(), hoursAgo(1.5).toISOString()]);
  assert.deepEqual([by.a.botOrderComplete, by.a.thanksCandidate], [true, false]);
  assert.equal(by.b.thanksCandidate, true);
  assert.equal(by.c.hasHumanResponse, true);
});

test("casos antiguos: probable cierre o pendiente; ninguno desaparece del total", () => {
  const block = (id: string, over: Partial<ClosedBlockRow>): ClosedBlockRow => ({
    conversationId: id, lastCustomerAt: hoursAgo(100), hasHumanResponse: true, botOrderComplete: false, botInfoAnswer: false,
    blockHasAttachment: false, blockHasQuestion: false, blockHasOrderRequest: false, blockAlreadyBought: false, blockNotCustomer: false, lastMessageIsClosing: false, ...over,
  });
  const rows = [
    open("gracias", { waitStart: hoursAgo(100) }), open("gracias-foto", { waitStart: hoursAgo(110) }),
    open("pregunta", { waitStart: hoursAgo(120) }), open("sin-marcas", { waitStart: hoursAgo(130) }), open("reciente", { waitStart: hoursAgo(2) }),
  ];
  const openBlocks = [
    block("gracias", { lastMessageIsClosing: true }),
    block("gracias-foto", { lastMessageIsClosing: true, blockHasAttachment: true }),
    block("pregunta", { blockHasQuestion: true }),
    block("reciente", { lastMessageIsClosing: true }),
  ];
  const p = payload(rows, { ...NONE, openBlocks });
  assert.deepEqual([p.stale.total, p.stale.probableClose, p.stale.pending], [4, 1, 3]);
  assert.deepEqual(p.stale.items.map((i) => [i.conversationId, i.kind]), [["sin-marcas", "PENDING"], ["pregunta", "PENDING"], ["gracias-foto", "PENDING"], ["gracias", "PROBABLE_CLOSE"]]);
  assert.equal(p.waiting.total, 1, "la reciente sigue en la cola aunque su último mensaje sea un cierre");
  // Total de pendientes: la reciente más los tres posibles pendientes antiguos. La probablemente resuelta no suma ni entra en la lista.
  assert.deepEqual([p.waiting.oldPending, p.listTotal], [3, 4]);
  assert.deepEqual(p.list.map((i) => i.conversationId).sort(), ["gracias-foto", "pregunta", "reciente", "sin-marcas"]);
  // Con la ventana de WhatsApp cerrada son críticos y cuentan en las alertas.
  const viejos = payload(rows.map((r) => ({ ...r, lastCustomerAt: r.waitStart })), { ...NONE, openBlocks });
  assert.deepEqual([viejos.waiting.critical, viejos.window.closed, viejos.list[0].conversationId, viejos.list[0].level], [3, 3, "sin-marcas", "CRITICO"]);
  // Sin las marcas no se clasifica: null, no cero.
  const sin = payload(rows);
  assert.deepEqual([sin.stale.total, sin.stale.probableClose, sin.stale.pending, sin.stale.items[0].kind], [4, null, null, null]);
});

test("responsable: asignación automática, cuenta con alias o número, o sin responsable identificado", () => {
  const acc = (externalId: string, over: object = {}) => ({ externalId, alias: null, active: true, borrowed: false, historical: false, ...over });
  const accounts = [acc("9000", { system: true, active: false }), acc("9001", { alias: "Alias inventado" }), acc("9002")];
  assert.deepEqual(ownerOf("9000", accounts), { kind: "SYSTEM" });
  assert.deepEqual(ownerOf("9001", accounts), { kind: "ACCOUNT", label: "Alias inventado" });
  assert.deepEqual(ownerOf("9002", accounts), { kind: "ACCOUNT", label: "Cuenta 9002" });
  // Una cuenta que no está en la configuración se muestra por su número: el asignado es un dato medido.
  assert.deepEqual(ownerOf("9999", accounts), { kind: "ACCOUNT", label: "Cuenta 9999" });
  assert.deepEqual(ownerOf(null, accounts), { kind: "UNKNOWN" });
  assert.deepEqual(ownerOf("9001", []), { kind: "ACCOUNT", label: "Cuenta 9001" });
  // En la respuesta, y sin depender de si ya hubo primera respuesta.
  const p = payload([open("a", { externalAssigneeId: "9000" }), open("b", { externalAssigneeId: "9001", hasHumanResponse: true })], { ...NONE, accounts });
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i]));
  assert.deepEqual([by.a.owner.kind, by.a.hasHumanResponse, by.b.owner.kind, by.b.hasHumanResponse], ["SYSTEM", false, "ACCOUNT", true]);
});

test("semáforo: sale del horario y los umbrales vigentes; sin configuración queda sin nivel", () => {
  const wait = { pub: () => [{ from: 0, to: 1440 }], ops: () => [{ from: 0, to: 1440 }], goalMinutes: 15, criticalMinutes: 60 };
  const p = payload([open("ok", { waitStart: hoursAgo(0.1), botExitAt: hoursAgo(0.1) }), open("tarde", { waitStart: hoursAgo(0.5), botExitAt: hoursAgo(0.5) }), open("critico", { waitStart: hoursAgo(3), botExitAt: hoursAgo(3) })], { ...NONE, wait });
  assert.deepEqual(p.list.map((i) => [i.conversationId, i.level, i.businessMinutes]), [["critico", "CRITICO", 180], ["tarde", "DEMORADO", 30], ["ok", "EN_PLAZO", 6]]);
  assert.equal(p.waiting.critical, 1);
  assert.deepEqual(p.schedule, { inPublicHours: true, operatorShiftActive: false, goalMinutes: 15, criticalMinutes: 60 });
  const sin = payload([open("a")]);
  assert.deepEqual([sin.schedule, sin.list[0].level, sin.list[0].businessMinutes], [null, null, null]);
});

test("pedidos completos sin atender: abiertas sin respuesta de una persona, también las antiguas pendientes", () => {
  const p = payload([
    open("a", { botOrderComplete: true }),
    open("vieja", { botOrderComplete: true, waitStart: hoursAgo(100) }),
    open("respondida", { botOrderComplete: true, hasHumanResponse: true }),
    row("cerrada", { botOrderComplete: true }),
  ]);
  assert.equal(p.waiting.completedOrders, 2);
});

test("hoy, cerradas sin responder e histórico: si no se pudieron calcular quedan null, no cero", () => {
  const p = payload([]);
  assert.deepEqual([p.today, p.closedUnanswered, p.quality.closedBefore, p.quality.notCustomers], [null, null, null, null]);
});

test("hoy, cerradas sin responder e histórico pasan tal cual; los que no son clientes van solo a calidad de datos", () => {
  const block = (id: string, over: Partial<ClosedBlockRow>): ClosedBlockRow => ({
    conversationId: id, lastCustomerAt: hoursAgo(3), hasHumanResponse: true, botOrderComplete: false, botInfoAnswer: false,
    blockHasAttachment: false, blockHasQuestion: false, blockHasOrderRequest: false, blockAlreadyBought: false, blockNotCustomer: false, lastMessageIsClosing: false, ...over,
  });
  const closed = buildClosedUnanswered([block("q", { blockHasQuestion: true }), block("prov", { blockNotCustomer: true, blockHasAttachment: true })]);
  const p = payload([], { wait: null, accounts: [], openBlocks: null, progress: null, checks: null, today: { entered: 12, answered: 9, attended: 20 }, closed, history: { before: SINCE, total: 7424, neverHuman: 2944, awaitingNext: 4480, completedOrders: 49 } });
  assert.deepEqual(p.today, { entered: 12, answered: 9, attended: 20 });
  assert.deepEqual(p.closedUnanswered, { days: 7, total: 1, question: 1, order: 0, attachment: 0, items: [{ conversationId: "q", lastCustomerAt: hoursAgo(3).toISOString(), reason: "QUESTION", windowClosed: false }] });
  assert.deepEqual(p.quality.closedBefore, { total: 7424, neverHuman: 2944, awaitingNext: 4480, completedOrders: 49 });
  assert.deepEqual([p.quality.notCustomers, p.quality.notCustomersDays], [1, 7]);
});

test("evidencia de actualización: fechas en ISO, o null si no hay datos", () => {
  const p = toNowPayload(buildQueueSnapshot([], NOW, SINCE), NONE, { lastWebhookAt: null, lastMessageAt: hoursAgo(1) });
  assert.deepEqual(p.quality.freshness, { lastWebhookAt: null, lastMessageAt: hoursAgo(1).toISOString() });
  assert.equal(p.generatedAt, NOW.toISOString());
});

test("la respuesta no lleva teléfono, nombre ni texto, y se puede serializar", () => {
  const p = payload([open("a"), open("vieja", { waitStart: hoursAgo(500) })]);
  const json = JSON.stringify(p);
  assert.ok(!/phone|displayName|body|customerChars/i.test(json));
  assert.deepEqual(JSON.parse(json), p);
});

test("cliente urgente o insistiendo: dos niveles; si es las dos cosas cuenta como urgente", () => {
  const p = payload([
    open("urgente", { urgent: true }), open("las-dos", { urgent: true, insisting: true }), open("insiste", { insisting: true }), open("normal"),
    // Los posibles pendientes antiguos entran en la alerta; las cerradas no.
    open("vieja", { waitStart: hoursAgo(200), urgent: true }), row("cerrada", { urgent: true }),
  ]);
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i.alert]));
  assert.deepEqual(by, { vieja: "URGENTE", urgente: "URGENTE", "las-dos": "URGENTE", insiste: "INSISTIENDO", normal: null });
  assert.deepEqual([p.waiting.urgent, p.waiting.insisting], [3, 1]);
});

test("quién tiene cada caso: una fila por cuenta asignada, filas especiales y el último en responder como dato detectado", () => {
  const acc = (externalId: string, over: object = {}) => ({ externalId, alias: null, active: true, borrowed: false, historical: false, ...over });
  const accounts = [
    acc("9000", { system: true, alias: "Automática inventada" }), acc("9001", { alias: "Alias inventado" }), acc("9002"),
    acc("9007", { supervision: true, alias: "Supervisión inventada" }), acc("9008", { system: true }),
  ];
  const own = (conversationId: string, externalAssigneeId: string | null, lastOperatorAccount: string | null = null) => ({ conversationId, externalAssigneeId, lastOperatorAccount });
  const openOwners = [
    own("a", "9001"), own("b", "9001"), own("c", "9001", "9002"), // c no espera: respondieron último
    own("d", "9002"), own("e", "9000"), own("f", "9008"), own("g", "9007"), own("h", "9999"),
    own("i", null, "9001"), own("j", null, "9001"), own("k", null, "9007"), own("l", null), own("vieja", "9001"),
  ];
  const rows = [
    open("a", { externalAssigneeId: "9001", waitStart: hoursAgo(30), lastCustomerAt: hoursAgo(30) }),
    open("b", { externalAssigneeId: "9001", waitStart: hoursAgo(2), lastCustomerAt: hoursAgo(2) }),
    open("e", { externalAssigneeId: "9000", waitStart: hoursAgo(1), lastCustomerAt: hoursAgo(1) }),
    open("i", { waitStart: hoursAgo(3), lastCustomerAt: hoursAgo(3) }),
    open("l", { waitStart: hoursAgo(4), lastCustomerAt: hoursAgo(4) }),
    // Espera hace más de 72 horas y sin señal de cierre: posible pendiente antiguo, está en "Casos" y cuenta como esperando.
    open("vieja", { externalAssigneeId: "9001", waitStart: hoursAgo(200), lastCustomerAt: hoursAgo(200) }),
  ];
  const p = payload(rows, { ...NONE, accounts, openOwners });
  const o = p.owners!;
  assert.equal(o.open, 13);
  assert.deepEqual(o.rows.map((r) => [r.key, r.group, r.label, r.open, r.waiting, r.windowClosed]), [
    ["a:9001", "OPERADOR", "Alias inventado", 4, 3, 2],
    ["a:9002", "OPERADOR", "Cuenta 9002", 1, 0, 0],
    ["a:9999", "OPERADOR", "Cuenta 9999", 1, 0, 0],
    ["a:9007", "SUPERVISION", "Supervisión inventada", 1, 0, 0],
    ["system", "SIN_TOMAR", "Sin tomar", 2, 1, 0],
    ["none", "SIN_DATO", "Sin dato de asignado", 4, 2, 0],
  ]);
  assert.equal(o.rows[0].oldestWaitStart, hoursAgo(200).toISOString());
  assert.equal(o.rows[1].oldestWaitStart, null);
  // El detectado va solo en "Sin dato de asignado" y no mueve la conversación de fila.
  assert.deepEqual(o.rows[5].detected, { byAccount: [{ label: "Alias inventado", open: 2 }, { label: "Supervisión inventada · supervisión", open: 1 }], none: 1 });
  assert.ok(o.rows.slice(0, 5).every((r) => r.detected === null));
  // Cada caso lleva la clave de su fila; el detectado solo si falta el asignado.
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i]));
  assert.deepEqual([by.a.ownerKey, by.e.ownerKey, by.i.ownerKey], ["a:9001", "system", "none"]);
  assert.deepEqual([by.a.detectedOwner, by.i.detectedOwner, by.l.detectedOwner], [null, "Alias inventado", null]);
  // Las filas suman las abiertas y los que esperan.
  assert.equal(o.rows.reduce((n, r) => n + r.open, 0), o.open);
  assert.equal(o.rows.reduce((n, r) => n + r.waiting, 0), p.waiting.total + p.waiting.oldPending);
  // Sin la lectura de abiertas no hay bloque: null, no vacío.
  assert.equal(payload(rows, { ...NONE, accounts }).owners, null);
});

console.log(`\nmetrics/now: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
