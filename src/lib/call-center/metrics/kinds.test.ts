/**
 * Clasificación por tipo. PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/kinds.test.ts
 */
import assert from "node:assert/strict";
import { buildKindsReport, classifyKind, type KindRow } from "./kinds";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
let n = 0;
const row = (over: Partial<KindRow> = {}): KindRow => ({
  conversationId: `k${++n}`, createdAt: at("2026-03-03T10:00"), claim: false, prescription: false, homeDelivery: false, pickup: false,
  botOrderComplete: false, confirmed: false, saleLost: false, saleElsewhere: false, saleProbable: false, notALoss: false, boughtAtTkl: false, declined: false, followUp: false, hasHumanResponse: false,
  operatorInPersonOnly: false, operatorNoStock: false, operatorDerived: false, customerMedia: false, hasFreeText: true, onlyEmptyText: false,
  hasQuestionMark: false, services: false, price: false, stock: false, hours: false, coverage: false, paymentMethod: false, onlineStore: false, ...over,
});
const kind = (over: Partial<KindRow>) => classifyKind(row(over));

test("prioridad: un reclamo gana aunque también sea pedido, venta perdida o consulta", () => {
  assert.deepEqual(kind({ claim: true, prescription: true, confirmed: true, saleLost: true, price: true }), { main: "RECLAMO", sub: null });
});

test("pedido confirmado: el operador lo confirma o hay pago; la modalidad sale del bot", () => {
  assert.deepEqual(kind({ confirmed: true, homeDelivery: true }), { main: "PEDIDO", sub: "DOMICILIO" });
  assert.deepEqual(kind({ confirmed: true, pickup: true }), { main: "PEDIDO", sub: "RETIRO" });
  assert.deepEqual(kind({ confirmed: true, prescription: true }), { main: "PEDIDO", sub: "RECETA" });
  assert.deepEqual(kind({ confirmed: true }), { main: "PEDIDO", sub: "SIN_MODALIDAD" });
});

test("pedido confirmado gana sobre la falta o la derivación: si después se concretó, es una venta", () => {
  assert.equal(kind({ confirmed: true, botOrderComplete: true, operatorNoStock: true }).main, "PEDIDO");
  assert.equal(kind({ confirmed: true, botOrderComplete: true, operatorDerived: true }).main, "PEDIDO");
  assert.equal(kind({ confirmed: true, saleLost: true }).main, "PEDIDO");
});

test("el cliente dice que ya compró: en TKL es una venta presencial; si no, venta perdida", () => {
  assert.deepEqual(kind({ saleLost: true, boughtAtTkl: true }), { main: "COMPRO_TKL", sub: null });
  assert.deepEqual(kind({ saleLost: true, saleElsewhere: true }), { main: "VENTA_PERDIDA", sub: "OTRO_LADO" });
  assert.deepEqual(kind({ saleLost: true }), { main: "VENTA_PERDIDA", sub: "NO_DICE_DONDE" });
  assert.deepEqual(kind({ saleProbable: true }), { main: "VENTA_PERDIDA", sub: "PROBABLE" });
  // Pasa a pagar después de que le ofrecieron stock: la marca ya viene resuelta en boughtAtTkl.
  assert.deepEqual(kind({ boughtAtTkl: true }), { main: "COMPRO_TKL", sub: null });
  // Se confundió de receta: no es una pérdida.
  assert.deepEqual(kind({ saleLost: true, notALoss: true }), { main: "SIN_MOTIVO", sub: null });
  assert.equal(kind({ saleLost: true, botOrderComplete: true, operatorNoStock: true }).main, "VENTA_PERDIDA", "gana sobre no se pudo tomar");
  assert.equal(kind({ saleLost: true, prescription: true }).main, "VENTA_PERDIDA", "mandó la receta y después compró en otro lado");
});

test("no se pudo tomar: sin stock, derivado a compra presencial, o por tipo de medicamento", () => {
  assert.deepEqual(kind({ botOrderComplete: true, operatorNoStock: true }), { main: "NO_SE_PUDO_TOMAR", sub: "SIN_STOCK" });
  assert.deepEqual(kind({ botOrderComplete: true, operatorDerived: true, operatorNoStock: true }), { main: "NO_SE_PUDO_TOMAR", sub: "DERIVADO_PRESENCIAL" });
  assert.deepEqual(kind({ botOrderComplete: true, operatorInPersonOnly: true, operatorNoStock: true }), { main: "NO_SE_PUDO_TOMAR", sub: "DERIVADO_MEDICAMENTO" });
  assert.deepEqual(kind({ prescription: true, operatorNoStock: true }), { main: "NO_SE_PUDO_TOMAR", sub: "SIN_STOCK" });
  // Sin intención de pedido, un aviso de falta es la respuesta a una consulta de stock.
  assert.deepEqual(kind({ stock: true, operatorNoStock: true }), { main: "CONSULTA", sub: "STOCK" });
});

test("receta digital: es un pedido, salvo que el cliente avise que no necesita nada", () => {
  assert.deepEqual(kind({ prescription: true }), { main: "PEDIDO", sub: "RECETA" });
  assert.deepEqual(kind({ prescription: true, declined: true }), { main: "SIN_MOTIVO", sub: null });
});

test("pedido sin confirmar: completó el bot sin confirmación; si solo pregunta por un producto es una consulta", () => {
  assert.deepEqual(kind({ botOrderComplete: true, homeDelivery: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
  assert.deepEqual(kind({ botOrderComplete: true, hasQuestionMark: true, hours: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
  assert.deepEqual(kind({ botOrderComplete: true, price: true }), { main: "CONSULTA", sub: "PRECIO" });
  assert.deepEqual(kind({ botOrderComplete: true, stock: true }), { main: "CONSULTA", sub: "STOCK" });
  // Con una receta o un adjunto, la pregunta por el precio es parte del pedido.
  assert.deepEqual(kind({ botOrderComplete: true, price: true, customerMedia: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
});

test("consulta: el cliente pregunta por un tema; el subtipo sale de las palabras", () => {
  assert.equal(kind({ services: true, stock: true }).sub, "SERVICIOS");
  assert.equal(kind({ price: true, stock: true, coverage: true }).sub, "PRECIO");
  assert.equal(kind({ stock: true, hours: true }).sub, "STOCK");
  assert.equal(kind({ hours: true, coverage: true }).sub, "HORARIOS");
  assert.equal(kind({ coverage: true, paymentMethod: true }).sub, "COBERTURA");
  assert.equal(kind({ paymentMethod: true, onlineStore: true }).sub, "PAGO");
  assert.equal(kind({ onlineStore: true }).sub, "TIENDA_ONLINE");
  // Una pregunta sin tema reconocible.
  assert.deepEqual(kind({ hasQuestionMark: true, customerMedia: true }), { main: "CONSULTA", sub: "OTRAS" });
  // Una receta o un adjunto solo, sin texto: pedido sin confirmar, no consulta.
  assert.deepEqual(kind({ customerMedia: true, hasFreeText: false }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
});

test("seguimiento / postventa: pregunta por un pago o un pedido ya hecho; un tema reconocible gana", () => {
  assert.deepEqual(kind({ followUp: true, hasQuestionMark: true }), { main: "SEGUIMIENTO", sub: null });
  assert.deepEqual(kind({ followUp: true, price: true }), { main: "CONSULTA", sub: "PRECIO" });
});

test("saludo o agradecimiento: saludos, agradecimientos o solo botones del bot, sin adjuntos", () => {
  assert.equal(kind({ onlyEmptyText: true }).main, "SALUDO");
  assert.equal(kind({ hasFreeText: false }).main, "SALUDO", "tocó botones del bot y no escribió nada");
  assert.equal(kind({ onlyEmptyText: true, customerMedia: true }).main, "PEDIDO_SIN_CONFIRMAR", "un agradecimiento con una foto tiene contenido");
});

test("sin motivo claro: escribió algo y no hay evidencia; que un operador responda no alcanza", () => {
  assert.deepEqual(kind({ hasHumanResponse: true }), { main: "SIN_MOTIVO", sub: null });
});

test("informe: totales, subtipos, por día y por hora de Buenos Aires", () => {
  const r = buildKindsReport([
    row({ confirmed: true, pickup: true, createdAt: at("2026-03-03T09:30") }),
    row({ prescription: true, createdAt: at("2026-03-03T15:00") }),
    row({ price: true, hasHumanResponse: true, createdAt: at("2026-03-03T23:59") }),   // 04/03 en UTC: tiene que quedar el 03/03 a las 23
    row({ stock: true, createdAt: at("2026-03-04T09:00") }),
    row({ claim: true, createdAt: at("2026-03-04T10:00") }),
    row({ onlyEmptyText: true, createdAt: at("2026-03-04T10:00") }),
    row({ botOrderComplete: true, createdAt: at("2026-03-04T11:00") }),
    row({ botOrderComplete: true, operatorDerived: true, createdAt: at("2026-03-04T11:00") }),
    row({ saleLost: true, createdAt: at("2026-03-04T11:30") }),
    row({ saleLost: true, boughtAtTkl: true, createdAt: at("2026-03-04T11:40") }),
    row({ followUp: true, createdAt: at("2026-03-04T11:50") }),
    row({ createdAt: at("2026-03-04T12:00") }),
  ], { now: at("2026-03-05T12:00"), from: "2026-03-03", to: "2026-03-04" });
  assert.deepEqual(r.total, { RECLAMO: 1, PEDIDO: 2, COMPRO_TKL: 1, VENTA_PERDIDA: 1, NO_SE_PUDO_TOMAR: 1, PEDIDO_SIN_CONFIRMAR: 1, CONSULTA: 2, SEGUIMIENTO: 1, SALUDO: 1, SIN_MOTIVO: 1 });
  assert.deepEqual([r.conversations, r.source], [12, "DETECTADO"]);
  assert.deepEqual([r.orders.RETIRO, r.orders.RECETA, r.orders.DOMICILIO, r.consults.PRECIO, r.consultsAnswered], [1, 1, 0, 1, 1]);
  assert.deepEqual(r.noTake, { SIN_STOCK: 0, DERIVADO_PRESENCIAL: 1, DERIVADO_MEDICAMENTO: 0 });
  assert.deepEqual(r.lost, { OTRO_LADO: 0, PROBABLE: 0, NO_DICE_DONDE: 1 });
  assert.deepEqual(r.byDay.map((d) => [d.day, d.PEDIDO, d.CONSULTA, d.RECLAMO]), [["2026-03-03", 2, 1, 0], ["2026-03-04", 0, 1, 1]]);
  assert.deepEqual([r.byHour.length, r.byHour[9].PEDIDO, r.byHour[15].PEDIDO, r.byHour[23].CONSULTA, r.byHour[10].RECLAMO], [24, 1, 1, 1, 1]);
  // Cada conversación cuenta una sola vez.
  assert.equal(Object.values(r.total).reduce((a, b) => a + b, 0), r.conversations);
  assert.ok(!/k\d+|phone|body/.test(JSON.stringify(r)), "solo conteos: sin ids ni datos del cliente");
});

test("sin conversaciones: todo en cero", () => {
  const r = buildKindsReport([], { now: at("2026-03-05T12:00"), from: "2026-03-03", to: "2026-03-04" });
  assert.deepEqual([r.conversations, r.byDay.length, r.total.PEDIDO], [0, 0, 0]);
});

console.log(`\nmetrics/kinds: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
