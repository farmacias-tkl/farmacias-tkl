/**
 * "Motivos de contacto". PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/motives.test.ts
 */
import assert from "node:assert/strict";
import { buildMotivesReport, classifyMotive, orderSignalOf, selectMotiveCases, type MotiveFlags } from "./motives";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const NONE: MotiveFlags = {
  firstClaim: false, strictClaim: false, prescription: false, prescriptionLink: false, prescriptionPlatform: null, botOrderComplete: false,
  orderButton: false, orderText: false, followUp: false, followUpArrival: false, advisorButton: false, infoHours: false, infoOnline: false,
  hasCustomerMessage: true, customerMedia: false, hasFreeText: false, onlyEmptyText: false, hasQuestionMark: false,
  services: false, price: false, stock: false, hours: false, coverage: false, paymentMethod: false, onlineStore: false,
};
const f = (over: Partial<MotiveFlags>): MotiveFlags => ({ ...NONE, ...over });
const text = { hasFreeText: true };
const main = (over: Partial<MotiveFlags>) => classifyMotive(f(over)).main;

test("solicitar un pedido: receta, datos completos del bot o pedido en texto; aunque nadie haya respondido", () => {
  assert.deepEqual([classifyMotive(f({ prescription: true })).main, classifyMotive(f({ prescription: true })).orderSignal], ["PEDIDO", "RECETA"]);
  assert.equal(orderSignalOf(f({ prescriptionLink: true })), "RECETA");
  assert.equal(orderSignalOf(f({ botOrderComplete: true, orderButton: true })), "DATOS_COMPLETOS");
  assert.equal(orderSignalOf(f({ ...text, orderText: true })), "TEXTO");
});

test("el botón 'Pedir medicamentos' no alcanza solo: hace falta un adjunto o texto propio que no sea una consulta", () => {
  const solo = classifyMotive(f({ orderButton: true }));
  assert.deepEqual([solo.main, solo.unknownReason], ["NO_IDENTIFICADO", "BOTON_PEDIDO"]);
  assert.equal(orderSignalOf(f({ orderButton: true, customerMedia: true })), "BOTON_Y_CONTENIDO");
  assert.equal(orderSignalOf(f({ orderButton: true, ...text })), "BOTON_Y_CONTENIDO", "escribió algo propio, lo más parecido a un producto");
  // Tocó el botón y solo pregunta un precio: es una consulta.
  assert.equal(main({ orderButton: true, ...text, price: true, hasQuestionMark: true }), "CONSULTA");
  // Tocó el botón y solo saludó: no alcanza.
  assert.equal(main({ orderButton: true, ...text, onlyEmptyText: true }), "NO_IDENTIFICADO");
});

test("el motivo es la necesidad que originó el contacto: un reclamo o un seguimiento posterior no lo reemplaza", () => {
  const m = classifyMotive(f({ botOrderComplete: true, strictClaim: true, followUpArrival: true, ...text, price: true }));
  assert.deepEqual([m.main, m.extra], ["PEDIDO", ["CONSULTA", "SEGUIMIENTO", "RECLAMO"]]);
  // Excepción: si el primer contacto ya es un reclamo, el principal es el reclamo.
  const r = classifyMotive(f({ botOrderComplete: true, firstClaim: true, strictClaim: true, ...text }));
  assert.deepEqual([r.main, r.extra, r.orderSignal], ["RECLAMO", ["PEDIDO"], null]);
});

test("seguimiento frente a reclamo: preguntar cuándo llega es seguimiento; decir que no llegó es reclamo", () => {
  assert.equal(main({ ...text, followUpArrival: true, hasQuestionMark: true }), "SEGUIMIENTO", "gana a la consulta: la frase es más específica que el signo de pregunta");
  assert.equal(main({ ...text, followUp: true }), "SEGUIMIENTO");
  assert.equal(main({ ...text, firstClaim: true, strictClaim: true }), "RECLAMO");
  // Un reclamo que aparece más adelante, sin otro motivo reconocible.
  assert.equal(main({ ...text, strictClaim: true }), "RECLAMO");
  // Consultó y después reclamó: sigue siendo una consulta, con el reclamo como tema adicional.
  const c = classifyMotive(f({ ...text, stock: true, strictClaim: true }));
  assert.deepEqual([c.main, c.consult, c.extra], ["CONSULTA", "STOCK", ["RECLAMO"]]);
});

test("consulta: un tema, una pregunta o las opciones informativas del bot", () => {
  assert.deepEqual([classifyMotive(f({ ...text, coverage: true })).consult, classifyMotive(f({ ...text, hasQuestionMark: true })).consult], ["COBERTURA", "OTRAS"]);
  assert.deepEqual([main({ infoHours: true }), classifyMotive(f({ infoHours: true })).consult], ["CONSULTA", "HORARIOS"]);
  assert.equal(classifyMotive(f({ infoOnline: true })).consult, "TIENDA_ONLINE");
});

test("saludo solo si escribió y todo son saludos; el resto es no identificado, con su razón", () => {
  assert.equal(main({ ...text, onlyEmptyText: true }), "SALUDO");
  const reason = (over: Partial<MotiveFlags>) => classifyMotive(f(over)).unknownReason;
  assert.equal(reason({ hasCustomerMessage: false }), "SIN_MENSAJES");
  assert.equal(reason({ customerMedia: true }), "ADJUNTO");
  assert.equal(reason({ advisorButton: true }), "ASESOR");
  assert.equal(reason({}), "SOLO_BOTONES");
  assert.equal(reason({ ...text }), "TEXTO");
  assert.equal(main({ ...text, onlyEmptyText: true, advisorButton: true }), "NO_IDENTIFICADO", "pidió un asesor: quería algo, no se sabe qué");
});

test("la receta es una característica del contacto, no un motivo", () => {
  assert.deepEqual(classifyMotive(f({ prescriptionLink: true, prescriptionPlatform: "plataforma-a" })).prescription, { has: true, platform: "plataforma-a" });
  assert.deepEqual(classifyMotive(f({ prescription: true })).prescription, { has: true, platform: "otra" });
  assert.deepEqual(classifyMotive(f({ ...text })).prescription, { has: false, platform: null });
});

test("informe: los motivos suman el total, con día, hora y el cruce con la clasificación anterior", () => {
  const at = (s: string) => new Date(`${s}:00.000-03:00`);
  const rows = [
    { ...f({ botOrderComplete: true }), createdAt: at("2026-03-02T10:00"), old: "PEDIDO_SIN_CONFIRMAR" as const },
    { ...f({ prescriptionLink: true, prescriptionPlatform: "plataforma-a", strictClaim: true }), createdAt: at("2026-03-02T10:30"), old: "RECLAMO" as const },
    { ...f({ ...text, price: true }), createdAt: at("2026-03-03T15:00"), old: "CONSULTA" as const },
    { ...f({ ...text, onlyEmptyText: true }), createdAt: at("2026-03-03T16:00"), old: "SALUDO" as const },
    { ...f({ orderButton: true }), createdAt: at("2026-03-03T16:10"), old: "SALUDO" as const },
  ];
  const r = buildMotivesReport(rows, (x) => x.old);
  assert.deepEqual(r.total, { PEDIDO: 2, CONSULTA: 1, SEGUIMIENTO: 0, RECLAMO: 0, SALUDO: 1, NO_IDENTIFICADO: 1 });
  assert.equal(Object.values(r.total).reduce((a, b) => a + b, 0), r.conversations);
  assert.equal(r.extra.RECLAMO, 1);
  assert.deepEqual([r.orderSignals.DATOS_COMPLETOS, r.orderSignals.RECETA, r.unknownReasons.BOTON_PEDIDO, r.consults.PRECIO], [1, 1, 1, 1]);
  assert.deepEqual(r.prescription, { has: 1, byPlatform: [{ platform: "plataforma-a", count: 1 }] });
  assert.deepEqual(r.byDay.map((d) => [d.day, d.PEDIDO, d.CONSULTA]), [["2026-03-02", 2, 0], ["2026-03-03", 0, 1]]);
  assert.equal(r.byHour[10].PEDIDO, 2);
  // El reclamo detectado antes pasa a "solicitar un pedido": el reclamo fue posterior.
  assert.deepEqual([r.fromKind.RECLAMO.PEDIDO, r.fromKind.SALUDO.SALUDO, r.fromKind.SALUDO.NO_IDENTIFICADO], [1, 1, 1]);
});

test("casos de un motivo: los de ese motivo principal, del más nuevo al más viejo, con el total antes del tope y sin datos del cliente", () => {
  const at = (s: string) => new Date(`${s}:00.000-03:00`);
  const rows = [
    { ...f({ botOrderComplete: true }), conversationId: "c1", createdAt: at("2026-03-02T10:00") },
    { ...f({ prescriptionLink: true, strictClaim: true }), conversationId: "c2", createdAt: at("2026-03-03T10:00") },
    { ...f({ hasFreeText: true, price: true }), conversationId: "c3", createdAt: at("2026-03-03T11:00") },
  ];
  const all = selectMotiveCases(rows, "PEDIDO");
  assert.deepEqual([all.total, all.cases.map((c) => c.conversationId)], [2, ["c2", "c1"]]);
  assert.deepEqual(all.cases[0], { conversationId: "c2", createdAt: at("2026-03-03T10:00").toISOString(), extra: ["RECLAMO"], consult: null, orderSignal: "RECETA", unknownReason: null, prescription: true });
  assert.deepEqual([selectMotiveCases(rows, "PEDIDO", 1).total, selectMotiveCases(rows, "PEDIDO", 1).cases.length], [2, 1]);
  assert.equal(selectMotiveCases(rows, "SALUDO").total, 0);
});

console.log(`\nmetrics/motives: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
