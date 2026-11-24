/**
 * Respuesta del bloque "Ahora". PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/now.test.ts
 */
import assert from "node:assert/strict";
import { ownerOf, toNowPayload, type NowExtras, attentionRank } from "./now";
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
  // En estas filas el cliente volvió a escribir hace 5 horas: las antiguas son de atención actual.
  assert.deepEqual(p.waiting, { total: 2, oldPending: 2, current: 4, historical: 0, ordersUntaken: 0, queriesUnanswered: 3, awaitingNextCurrent: 1, criticalByType: null, criticalCurrent: null, criticalHistorical: null, neverHuman: 1, awaitingNext: 1, completedOrders: 0, critical: null, oldestWaitStart: hoursAgo(50).toISOString(), urgent: 0, insisting: 0, claims: null });
  assert.deepEqual(p.list.map((i) => [i.conversationId, i.oldPending, i.historical]), [["mas-vieja", true, false], ["vieja", true, false], ["otra", false, false], ["reciente", false, false]]);
  assert.deepEqual([p.listTotal, p.historicalTotal], [4, 0]);
  // Sin un mensaje nuevo del cliente, las antiguas son históricos por verificar: aparte, no encabezan la lista.
  const h = payload([
    open("reciente", { waitStart: hoursAgo(2), lastCustomerAt: hoursAgo(2) }),
    open("otra", { waitStart: hoursAgo(50), lastCustomerAt: hoursAgo(50), hasHumanResponse: true }),
    open("vieja", { waitStart: hoursAgo(24 * 40), lastCustomerAt: hoursAgo(24 * 40) }),
    open("mas-vieja", { waitStart: hoursAgo(24 * 90), lastCustomerAt: hoursAgo(24 * 90) }),
    open("vieja-volvio", { waitStart: hoursAgo(24 * 50), lastCustomerAt: hoursAgo(3) }),
  ]);
  assert.deepEqual([h.waiting.total, h.waiting.oldPending, h.waiting.current, h.waiting.historical], [2, 3, 3, 2]);
  assert.deepEqual(h.historicalList.map((i) => [i.conversationId, i.historical]), [["mas-vieja", true], ["vieja", true]]);
  assert.deepEqual([h.listTotal, h.historicalTotal], [3, 2]);
  assert.ok(h.list.every((i) => !i.historical) && h.list.some((i) => i.conversationId === "vieja-volvio"), "si el cliente escribe de nuevo, vuelve a atención actual");
  assert.equal(h.waiting.current + h.waiting.historical, h.waiting.total + h.waiting.oldPending);
  assert.equal(p.stale.total, 2);
  assert.equal(p.stale.oldestWaitStart, hoursAgo(24 * 90).toISOString());
  assert.deepEqual(p.stale.items.map((i) => i.conversationId), ["mas-vieja", "vieja"]);
  assert.equal(p.windowHours, 72);
});

test("orden de atención actual: urgente, insistiendo, por vencer, demora crítica, pedido completo, ventana cerrada y el resto", () => {
  const base = { alert: null, window: "ABIERTA", level: null, botOrderComplete: false, hasHumanResponse: false } as const;
  assert.deepEqual([
    attentionRank({ ...base, alert: "URGENTE", window: "CERRADA" }),
    attentionRank({ ...base, alert: "INSISTIENDO" }),
    attentionRank({ ...base, window: "POR_VENCER", level: "CRITICO" }),
    attentionRank({ ...base, level: "CRITICO" }),
    attentionRank({ ...base, botOrderComplete: true }),
    attentionRank({ ...base, window: "CERRADA", level: "CRITICO" }),
    attentionRank({ ...base, botOrderComplete: true, hasHumanResponse: true }),
  ], [0, 1, 2, 3, 4, 5, 6]);
  // Un caso reciente con la ventana por vencer va antes que uno con la ventana ya cerrada.
  const p = payload([
    open("cerrada-ayer", { waitStart: hoursAgo(30), lastCustomerAt: hoursAgo(30) }),
    open("por-vencer", { waitStart: hoursAgo(22), lastCustomerAt: hoursAgo(22) }),
    open("vence-antes", { waitStart: hoursAgo(23), lastCustomerAt: hoursAgo(23) }),
    open("urgente", { waitStart: hoursAgo(1), lastCustomerAt: hoursAgo(1), urgent: true }),
    open("pedido", { waitStart: hoursAgo(3), lastCustomerAt: hoursAgo(3), botOrderComplete: true }),
    open("comun", { waitStart: hoursAgo(4), lastCustomerAt: hoursAgo(4) }),
  ]);
  assert.deepEqual(p.list.map((i) => i.conversationId), ["urgente", "vence-antes", "por-vencer", "pedido", "cerrada-ayer", "comun"]);
});

test("portada: pedidos sin tomar son los que parecen un pedido y siguen sin primera respuesta; el resto son consultas", () => {
  const p = payload([
    open("bot-completo", { botOrderComplete: true }),
    open("receta", { customerSentPrescriptionLink: true }),
    open("frase-pedido", { customerAskedOrder: true }),
    open("consulta"),
    open("pedido-ya-respondido", { botOrderComplete: true, hasHumanResponse: true }),
    // Histórico por verificar: no cuenta en la portada.
    open("pedido-historico", { botOrderComplete: true, waitStart: hoursAgo(24 * 30), lastCustomerAt: hoursAgo(24 * 30) }),
    row("cerrada", { botOrderComplete: true }),
  ]);
  assert.deepEqual([p.waiting.ordersUntaken, p.waiting.queriesUnanswered], [3, 1]);
  // Los tres grupos de la portada suman los que esperan, y sus críticos suman los críticos.
  assert.equal(p.waiting.ordersUntaken + p.waiting.queriesUnanswered + p.waiting.awaitingNextCurrent, p.waiting.current);
  const cb = p.waiting.criticalByType;
  if (cb) assert.equal(cb.orders + cb.queries + cb.awaitingNext, p.waiting.criticalCurrent);
  assert.deepEqual(Object.fromEntries(p.list.map((i) => [i.conversationId, i.orderRequest])), { "bot-completo": true, receta: true, "frase-pedido": true, consulta: false, "pedido-ya-respondido": true });
  assert.equal(p.todayClosures, null, "sin el dato queda null, no cero");
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
  assert.deepEqual(p.waiting, { total: 0, oldPending: 0, current: 0, historical: 0, ordersUntaken: 0, queriesUnanswered: 0, awaitingNextCurrent: 0, criticalByType: null, criticalCurrent: null, criticalHistorical: null, neverHuman: 0, awaitingNext: 0, completedOrders: 0, critical: null, oldestWaitStart: null, urgent: 0, insisting: 0, claims: null });
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
  // Con la ventana de WhatsApp cerrada son críticos, pero históricos: no cuentan en las alertas de atención actual.
  assert.deepEqual([viejos.waiting.critical, viejos.waiting.criticalCurrent, viejos.waiting.criticalHistorical, viejos.window.closed], [3, 0, 3, 0]);
  assert.deepEqual([viejos.historicalList[0].conversationId, viejos.historicalList[0].level, viejos.list.map((i) => i.conversationId)], ["sin-marcas", "CRITICO", ["reciente"]]);
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
  assert.deepEqual(p.schedule, { inPublicHours: true, operatorShiftActive: false, goalMinutes: 15, criticalMinutes: 60, operatorsToday: "STARTED", operatorsStartAt: "2026-03-10T03:00:00.000Z", businessSince: null });
  assert.ok(p.list.every((i) => !i.businessPartial), "sin fecha de inicio de la configuración no se marca nada como parcial");
  const sin = payload([open("a")]);
  assert.deepEqual([sin.schedule, sin.list[0].level, sin.list[0].businessMinutes], [null, null, null]);
});

test("horario de operadores de hoy: no hay, todavía no empezó o ya empezó", () => {
  // NOW son las 12:00 de Buenos Aires.
  const base = { pub: () => [{ from: 0, to: 1440 }], goalMinutes: 15, criticalMinutes: 60 };
  const sch = (ops: () => Array<{ from: number; to: number }>) => payload([open("a")], { ...NONE, wait: { ...base, ops } }).schedule!;
  assert.deepEqual([sch(() => []).operatorsToday, sch(() => []).operatorsStartAt], ["NONE", null]);
  assert.deepEqual([sch(() => [{ from: 13 * 60, to: 20 * 60 }]).operatorsToday, sch(() => [{ from: 13 * 60, to: 20 * 60 }]).operatorsStartAt], ["NOT_STARTED", "2026-03-10T16:00:00.000Z"]);
  assert.equal(sch(() => [{ from: 8 * 60, to: 11 * 60 }]).operatorsToday, "STARTED", "ya empezó, aunque haya terminado");
});

test("tiempo hábil parcial: si la espera empezó antes del primer día con horarios, cuenta solo desde ese día", () => {
  const wait = { pub: () => [{ from: 0, to: 1440 }], ops: () => [{ from: 0, to: 1440 }], goalMinutes: 15, criticalMinutes: 60, coveredFrom: "2026-03-09" };
  const p = payload([
    open("antes", { waitStart: hoursAgo(24 * 10), botExitAt: hoursAgo(24 * 10), lastCustomerAt: hoursAgo(2) }),
    open("despues", { waitStart: hoursAgo(5), botExitAt: hoursAgo(5) }),
  ], { ...NONE, wait });
  const by = Object.fromEntries([...p.list, ...p.historicalList].map((i) => [i.conversationId, i.businessPartial]));
  assert.deepEqual(by, { antes: true, despues: false });
  assert.equal(p.schedule!.businessSince, "2026-03-09");
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

test("actividad observada: última respuesta de un operador, aviso para revisar y detalle por cuenta", () => {
  const acc = (externalId: string, over: object = {}) => ({ externalId, alias: null, active: true, borrowed: false, historical: false, ...over });
  const accounts = [acc("9000", { system: true }), acc("9001", { alias: "Alias inventado" }), acc("9002")];
  const always = () => [{ from: 0, to: 1440 }];
  const never = () => [];
  const wait = (ops: typeof always | typeof never, lastResponseWarningMinutes?: number) => ({ pub: never, ops, goalMinutes: 15, criticalMinutes: 60, lastResponseWarningMinutes });
  const since = hoursAgo(6);
  const observed = (rows: Array<[string | null, number, number]>) => ({
    rows: rows.map(([account, h, conversations]) => ({ account, lastAt: hoursAgo(h), conversations })), since, sinceIsShift: true,
  });
  // La cuenta de sistema respondió hace 1 minuto: no cuenta. La última de un operador fue hace 45 minutos.
  const rows = observed([["9000", 1 / 60, 9], ["9002", 0.75, 2], ["9001", 3, 5], [null, 40, 0]]);
  const p = payload([open("a")], { ...NONE, accounts, wait: wait(always), observed: rows });
  const o = p.observed!;
  assert.deepEqual([o.lastResponseAt, o.review, o.warningMinutes, o.inOperatorHours, o.sinceIsShift], [hoursAgo(0.75).toISOString(), true, 30, true, true]);
  assert.deepEqual(o.accounts, [
    { label: "Alias inventado", lastResponseAt: hoursAgo(3).toISOString(), conversations: 5 },
    { label: "Cuenta 9002", lastResponseAt: hoursAgo(0.75).toISOString(), conversations: 2 },
    { label: "Cuenta no registrada", lastResponseAt: hoursAgo(40).toISOString(), conversations: 0 },
  ]);
  // Sin aviso: umbral mayor en la configuración, sin pendientes, o fuera del horario de operadores.
  assert.equal(payload([open("a")], { ...NONE, accounts, wait: wait(always, 60), observed: rows }).observed!.review, false);
  assert.equal(payload([], { ...NONE, accounts, wait: wait(always), observed: rows }).observed!.review, false);
  assert.deepEqual([payload([open("a")], { ...NONE, accounts, wait: wait(never), observed: rows }).observed!.review], [false]);
  // Sin configuración no se conoce el horario de operadores: sin aviso y null.
  const sin = payload([open("a")], { ...NONE, accounts, observed: rows }).observed!;
  assert.deepEqual([sin.review, sin.inOperatorHours], [false, null]);
  // Ninguna respuesta en los últimos días, con pendientes y en horario: para revisar.
  const nadie = payload([open("a")], { ...NONE, accounts, wait: wait(always), observed: observed([]) }).observed!;
  assert.deepEqual([nadie.lastResponseAt, nadie.review, nadie.accounts], [null, true, []]);
  // Los posibles pendientes antiguos también cuentan como pendientes.
  assert.equal(payload([open("vieja", { waitStart: hoursAgo(200) })], { ...NONE, accounts, wait: wait(always), observed: rows }).observed!.review, true);
  // Sin la lectura no hay bloque.
  assert.equal(payload([open("a")], { ...NONE, accounts }).observed, null);
});

test("reclamos pendientes: pendientes con un reclamo detectado; sin la revisión queda sin dato", () => {
  const rows = [open("a"), open("b", { hasHumanResponse: true }), open("c"), open("vieja", { waitStart: hoursAgo(200) }), row("cerrada")];
  const claims = new Map([["a", ["DEMORA" as const]], ["vieja", ["SIN_NOVEDADES" as const, "PAGO" as const]], ["cerrada", ["DEMORA" as const]]]);
  const p = payload(rows, { ...NONE, claims });
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i.claims]));
  assert.deepEqual(by, { a: ["DEMORA"], b: [], c: [], vieja: ["SIN_NOVEDADES", "PAGO"] });
  // Cuenta conversaciones, no motivos; las cerradas no son pendientes.
  assert.equal(p.waiting.claims, 2);
  const sin = payload(rows);
  assert.deepEqual([sin.waiting.claims, sin.list[0].claims], [null, null]);
});

console.log(`\nmetrics/now: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
