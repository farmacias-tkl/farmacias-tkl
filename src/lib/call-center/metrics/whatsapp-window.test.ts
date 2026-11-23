/**
 * Ventana de 24 horas de WhatsApp. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/whatsapp-window.test.ts
 */
import assert from "node:assert/strict";
import { WHATSAPP_WINDOW_HOURS, windowClosedUnanswered, windowClosesAt, windowMinutesLeft, windowState } from "./whatsapp-window";
import { DEFAULT_WINDOW_WARNING_HOURS, parseConfigData, windowWarningHoursOf } from "./config-schema";
import { toNowPayload, type NowExtras } from "./now";
import { buildQueueSnapshot, type WaitingRow } from "./queue";
import { buildClosedUnanswered, type ClosedBlockRow } from "./closed-unanswered";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);

test("la ventana es de 24 horas de reloj desde el último mensaje del cliente", () => {
  assert.equal(WHATSAPP_WINDOW_HOURS, 24);
  assert.equal(windowClosesAt(at("2026-03-06T18:30")).getTime(), at("2026-03-07T18:30").getTime());
});

test("estado: abierta, por vencer cuando falta menos que el aviso, cerrada pasadas las 24 horas", () => {
  const last = at("2026-03-03T10:00");
  assert.equal(windowState(last, at("2026-03-03T22:00"), 4), "ABIERTA");
  assert.equal(windowState(last, at("2026-03-04T06:00"), 4), "ABIERTA", "faltan exactamente 4 horas: todavía no avisa");
  assert.equal(windowState(last, at("2026-03-04T06:01"), 4), "POR_VENCER");
  assert.equal(windowState(last, at("2026-03-04T09:59"), 4), "POR_VENCER");
  assert.equal(windowState(last, at("2026-03-04T10:00"), 4), "CERRADA");
  assert.equal(windowState(last, at("2026-03-09T10:00"), 4), "CERRADA");
  // El aviso es configurable.
  assert.equal(windowState(last, at("2026-03-04T03:00"), 8), "POR_VENCER");
});

test("tiempo real: corre de noche, el fin de semana y los feriados", () => {
  // Viernes 06/03 a las 20:00: se cierra el sábado 07/03 a las 20:00, sin esperar al lunes.
  const last = at("2026-03-06T20:00");
  assert.equal(windowState(last, at("2026-03-07T17:00"), 4), "POR_VENCER");
  assert.equal(windowState(last, at("2026-03-08T09:00"), 4), "CERRADA");
  assert.equal(windowMinutesLeft(last, at("2026-03-07T17:25")), 155);
  assert.equal(windowMinutesLeft(last, at("2026-03-08T09:00")), 0);
});

test("ventana cerrada sin respuesta: sin respuesta a las 24 horas, o con una respuesta posterior", () => {
  const last = at("2026-03-03T10:00");
  assert.equal(windowClosedUnanswered(last, null, at("2026-03-04T09:00")), false, "todavía se puede responder");
  assert.equal(windowClosedUnanswered(last, null, at("2026-03-04T10:01")), true);
  assert.equal(windowClosedUnanswered(last, at("2026-03-04T09:30"), at("2026-03-10T10:00")), false, "respondida dentro de la ventana");
  assert.equal(windowClosedUnanswered(last, at("2026-03-04T11:00"), at("2026-03-10T10:00")), true, "la respuesta llegó con la ventana cerrada");
});

test("configuración: el aviso es opcional, vale 4 horas por defecto y va de 1 a 23", () => {
  const base = { schemaVersion: 1, publicHours: week(), operatorHours: week(), firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [] };
  const sin = parseConfigData(base);
  assert.ok(sin.ok, "una versión guardada antes del campo sigue siendo válida");
  assert.equal(windowWarningHoursOf(sin.ok ? sin.data : {}), DEFAULT_WINDOW_WARNING_HOURS);
  assert.equal(DEFAULT_WINDOW_WARNING_HOURS, 4);
  const con = parseConfigData({ ...base, windowWarningHours: 6 });
  assert.equal(con.ok && windowWarningHoursOf(con.data), 6);
  assert.equal(parseConfigData({ ...base, windowWarningHours: 24 }).ok, false);
  assert.equal(parseConfigData({ ...base, windowWarningHours: 0 }).ok, false);
});

// ── En la respuesta de "Ahora" ────────────────────────────────────────────────────────

const NOW = new Date("2026-03-10T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const SINCE = hoursAgo(24 * 30);
const open = (id: string, over: Partial<WaitingRow> = {}): WaitingRow => ({
  conversationId: id, open: true, status: "SIN_ASIGNAR", externalAssigneeId: null, createdAt: hoursAgo(5), waitStart: hoursAgo(5), lastCustomerAt: hoursAgo(5),
  hasHumanResponse: false, botExitAt: hoursAgo(4.9), botOrderComplete: false, customerChars: 200, customerSentMedia: false, customerSentLink: false,
  previousResolvedRecently: false, urgent: false, insisting: false, ...over,
});
const NONE: NowExtras = { history: null, today: null, closed: null, wait: null, accounts: [], openBlocks: null, progress: null, checks: null };
const payload = (rows: WaitingRow[], extras: NowExtras = NONE) =>
  toNowPayload(buildQueueSnapshot(rows, NOW, SINCE), extras, { lastWebhookAt: null, lastMessageAt: null }, 72);

test("Ahora: la ventana cuenta desde el último mensaje del cliente, no desde el inicio del bloque", () => {
  const p = payload([
    // Espera desde hace 30 horas, pero volvió a escribir hace 2: la ventana sigue abierta.
    open("insistio", { waitStart: hoursAgo(30), lastCustomerAt: hoursAgo(2) }),
    open("cerrada", { waitStart: hoursAgo(30), lastCustomerAt: hoursAgo(25) }),
    open("por-vencer", { waitStart: hoursAgo(22), lastCustomerAt: hoursAgo(21) }),
    open("abierta", { waitStart: hoursAgo(3), lastCustomerAt: hoursAgo(3) }),
  ]);
  const by = Object.fromEntries(p.list.map((i) => [i.conversationId, i.window]));
  assert.deepEqual(by, { insistio: "ABIERTA", cerrada: "CERRADA", "por-vencer": "POR_VENCER", abierta: "ABIERTA" });
  assert.equal(p.list.find((i) => i.conversationId === "insistio")!.lastCustomerAt, hoursAgo(2).toISOString());
  assert.deepEqual([p.window.hours, p.window.warningHours, p.window.closed, p.window.closing], [24, 4, 1, 1]);
});

test("Ahora: el aviso sale de la configuración vigente", () => {
  const wait = { pub: () => [{ from: 0, to: 1440 }], ops: () => [{ from: 0, to: 1440 }], goalMinutes: 15, criticalMinutes: 60, windowWarningHours: 8 };
  const p = payload([open("a", { lastCustomerAt: hoursAgo(17) })], { ...NONE, wait });
  assert.deepEqual([p.window.warningHours, p.window.closing, p.list[0].window], [8, 1, "POR_VENCER"]);
  // La ventana es independiente del semáforo: los dos van en el caso.
  assert.equal(p.list[0].level, "CRITICO");
});

test("Ahora: los antiguos y las cerradas sin responder marcan si su ventana está cerrada", () => {
  const block = (id: string, lastCustomerAt: Date): ClosedBlockRow => ({
    conversationId: id, lastCustomerAt, hasHumanResponse: true, botOrderComplete: false, botInfoAnswer: false,
    blockHasAttachment: false, blockHasQuestion: true, blockHasOrderRequest: false, blockAlreadyBought: false, blockNotCustomer: false, lastMessageIsClosing: false,
  });
  const closed = buildClosedUnanswered([block("c-vieja", hoursAgo(40)), block("c-reciente", hoursAgo(3))]);
  const p = payload([
    open("antigua", { waitStart: hoursAgo(200), lastCustomerAt: hoursAgo(190) }),
    open("antigua-insistio", { waitStart: hoursAgo(200), lastCustomerAt: hoursAgo(1) }),
  ], { ...NONE, closed });
  assert.deepEqual(p.stale.items.map((i) => [i.conversationId, i.windowClosed]), [["antigua", true], ["antigua-insistio", false]]);
  assert.deepEqual(p.closedUnanswered!.items.map((i) => [i.conversationId, i.windowClosed]), [["c-reciente", false], ["c-vieja", true]]);
  // El posible pendiente antiguo con la ventana cerrada cuenta también en la alerta de ventana cerrada.
  assert.deepEqual([p.window.staleClosed, p.window.closedUnansweredClosed, p.window.closed], [1, 1, 1]);
  // Sin las cerradas calculadas: null, no cero.
  assert.equal(payload([]).window.closedUnansweredClosed, null);
});

// ── Semáforo y ventana ────────────────────────────────────────────────────────────────

const at2 = (s: string) => new Date(`${s}:00.000-03:00`);
/** Público lunes a viernes 09–19, sábado 08–13; 2026-03-09 (lunes) es feriado de prueba. */
const pubHours = (day: string) => {
  if (day === "2026-03-09") return [];
  const wd = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  return wd === 0 ? [] : wd === 6 ? [{ from: 8 * 60, to: 13 * 60 }] : [{ from: 9 * 60, to: 19 * 60 }];
};
const waitCtx = { pub: pubHours, ops: pubHours, goalMinutes: 15, criticalMinutes: 60 };
const at36 = (rows: WaitingRow[], nowIso: string, extras: NowExtras = { ...NONE, wait: waitCtx }) =>
  toNowPayload(buildQueueSnapshot(rows, at2(nowIso), SINCE), extras, { lastWebhookAt: null, lastMessageAt: null }, 72);

test("semáforo: sábado 12:52 con 36 horas reales es crítico aunque sume 8 minutos hábiles", () => {
  const t = at2("2026-03-07T12:52");
  const p = at36([open("sabado", { createdAt: t, waitStart: t, lastCustomerAt: t, botExitAt: t })], "2026-03-09T00:52");
  const it = p.list[0];
  assert.deepEqual([it.level, it.businessMinutes, it.window, it.waitMinutes], ["CRITICO", 8, "CERRADA", 36 * 60]);
  assert.equal(p.waiting.critical, 1);
  assert.equal(p.schedule!.inPublicHours, false, "el reloj hábil está pausado y aun así es crítico");
});

test("semáforo: feriado con 2 horas reales conserva el color por minutos hábiles, con el reloj pausado", () => {
  // Lunes feriado 09/03: entra a las 10:00, son las 12:00. Cero minutos hábiles: en plazo, y el horario público está cerrado.
  const t = at2("2026-03-09T10:00");
  const p = at36([open("feriado", { createdAt: t, waitStart: t, lastCustomerAt: t, botExitAt: t })], "2026-03-09T12:00");
  assert.deepEqual([p.list[0].level, p.list[0].businessMinutes, p.list[0].window, p.list[0].waitMinutes], ["EN_PLAZO", 0, "ABIERTA", 120]);
  assert.equal(p.schedule!.inPublicHours, false);
  // Uno que venía demorado del sábado (30 minutos hábiles hasta las 13:00) sigue demorado en el feriado.
  const v = at2("2026-03-07T12:30");
  const q = at36([open("sabado", { createdAt: v, waitStart: v, lastCustomerAt: at2("2026-03-09T09:00"), botExitAt: v })], "2026-03-09T12:00");
  assert.deepEqual([q.list[0].level, q.list[0].businessMinutes], ["DEMORADO", 30]);
});

test("orden de casos: primero los de ventana cerrada, del que más espera real al que menos; después el resto como venía", () => {
  const p = payload([
    open("abierta-vieja", { waitStart: hoursAgo(40), lastCustomerAt: hoursAgo(2) }),
    open("cerrada-30", { waitStart: hoursAgo(30), lastCustomerAt: hoursAgo(30) }),
    open("cerrada-50", { waitStart: hoursAgo(60), lastCustomerAt: hoursAgo(50) }),
    open("cerrada-26", { waitStart: hoursAgo(70), lastCustomerAt: hoursAgo(26) }),
    open("abierta-nueva", { waitStart: hoursAgo(1), lastCustomerAt: hoursAgo(1) }),
  ]);
  assert.deepEqual(p.list.map((i) => i.conversationId), ["cerrada-50", "cerrada-30", "cerrada-26", "abierta-vieja", "abierta-nueva"]);
  // Sin configuración no hay semáforo, salvo los críticos por ventana cerrada.
  assert.deepEqual(p.list.map((i) => i.level), ["CRITICO", "CRITICO", "CRITICO", null, null]);
  assert.equal(p.waiting.critical, 3);
});

function week() {
  const d = [{ from: "09:00", to: "19:00" }];
  return { "1": d, "2": d, "3": d, "4": d, "5": d, "6": [], "7": [] };
}

console.log(`\nmetrics/whatsapp-window: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
