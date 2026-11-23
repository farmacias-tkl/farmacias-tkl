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
  botOrderComplete: false, confirmed: false, saleLost: false, operatorNoStock: false, operatorDerived: false, customerMedia: false, hasFreeText: true, onlyEmptyText: false,
  hasQuestionMark: false, buttonHours: false, buttonOnlineStore: false, buttonAdvisor: false, services: false, price: false, stock: false, hours: false, coverage: false,
  paymentMethod: false, onlineStore: false, ...over,
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
  // Confirmado gana sobre la venta perdida y sobre el aviso de falta.
  assert.equal(kind({ confirmed: true, saleLost: true, operatorNoStock: true, botOrderComplete: true }).main, "PEDIDO");
});

test("venta perdida: por lo que dice el cliente, haya completado el bot o no", () => {
  assert.deepEqual(kind({ saleLost: true }), { main: "VENTA_PERDIDA", sub: null });
  assert.equal(kind({ saleLost: true, botOrderComplete: true, operatorNoStock: true }).main, "VENTA_PERDIDA", "gana sobre no se pudo tomar");
  assert.equal(kind({ saleLost: true, prescription: true }).main, "VENTA_PERDIDA", "mandó la receta y después compró en otro lado");
});

test("no se pudo tomar: quería pedir y el operador avisó la falta o lo derivó a la sucursal", () => {
  assert.deepEqual(kind({ botOrderComplete: true, operatorNoStock: true }), { main: "NO_SE_PUDO_TOMAR", sub: "SIN_STOCK" });
  assert.deepEqual(kind({ botOrderComplete: true, operatorDerived: true }), { main: "NO_SE_PUDO_TOMAR", sub: "DERIVADO_PRESENCIAL" });
  assert.deepEqual(kind({ prescription: true, operatorNoStock: true }), { main: "NO_SE_PUDO_TOMAR", sub: "SIN_STOCK" });
  assert.equal(kind({ botOrderComplete: true, operatorDerived: true, operatorNoStock: true }).sub, "DERIVADO_PRESENCIAL");
  // Sin intención de pedido, un aviso de falta es la respuesta a una consulta de stock.
  assert.deepEqual(kind({ stock: true, operatorNoStock: true }), { main: "CONSULTA", sub: "STOCK" });
});

test("receta digital de cualquier plataforma: es un pedido", () => {
  assert.deepEqual(kind({ prescription: true }), { main: "PEDIDO", sub: "RECETA" });
  assert.deepEqual(kind({ prescription: true, hasQuestionMark: true }), { main: "PEDIDO", sub: "RECETA" });
});

test("pedido sin confirmar: completó el bot y no hay confirmación, falta ni venta perdida; no suma como pedido", () => {
  assert.deepEqual(kind({ botOrderComplete: true, homeDelivery: true, price: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
  assert.deepEqual(kind({ botOrderComplete: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
});

test("saludo o agradecimiento: solo saludos, agradecimientos o botones, y sin adjuntos", () => {
  assert.equal(kind({ onlyEmptyText: true }).main, "SALUDO");
  assert.equal(kind({ hasFreeText: false }).main, "SALUDO");
  assert.equal(kind({ onlyEmptyText: true, customerMedia: true }).main, "CONSULTA", "un agradecimiento con una foto tiene contenido");
  assert.equal(kind({ hasFreeText: false, buttonHours: true }).main, "CONSULTA", "pidió sucursales y horarios desde el menú");
  assert.equal(kind({ hasFreeText: false, buttonAdvisor: true }).main, "SIN_MOTIVO", "pidió un asesor y no dijo para qué");
});

test("consulta: necesita un tema, una pregunta o un adjunto; el subtipo sale de las palabras", () => {
  assert.equal(kind({ services: true, stock: true }).sub, "SERVICIOS");
  assert.equal(kind({ price: true, stock: true, coverage: true }).sub, "PRECIO");
  assert.equal(kind({ stock: true, hours: true }).sub, "STOCK");
  assert.equal(kind({ buttonHours: true, coverage: true }).sub, "HORARIOS");
  assert.equal(kind({ coverage: true, paymentMethod: true }).sub, "COBERTURA");
  assert.equal(kind({ paymentMethod: true, onlineStore: true }).sub, "PAGO");
  assert.equal(kind({ buttonOnlineStore: true }).sub, "TIENDA_ONLINE");
  assert.deepEqual(kind({ hasQuestionMark: true }), { main: "CONSULTA", sub: "OTRAS" });
  assert.deepEqual(kind({ customerMedia: true, hasFreeText: false }), { main: "CONSULTA", sub: "OTRAS" });
});

test("sin motivo claro: escribió algo y no hay evidencia; que un operador responda no alcanza", () => {
  assert.deepEqual(kind({}), { main: "SIN_MOTIVO", sub: null });
});

test("informe: totales, subtipos, por día y por hora de Buenos Aires", () => {
  const r = buildKindsReport([
    row({ confirmed: true, pickup: true, createdAt: at("2026-03-03T09:30") }),
    row({ prescription: true, createdAt: at("2026-03-03T15:00") }),
    row({ price: true, createdAt: at("2026-03-03T23:59") }),   // 04/03 en UTC: tiene que quedar el 03/03 a las 23
    row({ claim: true, createdAt: at("2026-03-04T10:00") }),
    row({ onlyEmptyText: true, createdAt: at("2026-03-04T10:00") }),
    row({ botOrderComplete: true, createdAt: at("2026-03-04T11:00") }),
    row({ botOrderComplete: true, operatorDerived: true, createdAt: at("2026-03-04T11:00") }),
    row({ saleLost: true, createdAt: at("2026-03-04T11:30") }),
    row({ createdAt: at("2026-03-04T12:00") }),
  ], { now: at("2026-03-05T12:00"), from: "2026-03-03", to: "2026-03-04" });
  assert.deepEqual(r.total, { RECLAMO: 1, PEDIDO: 2, VENTA_PERDIDA: 1, NO_SE_PUDO_TOMAR: 1, PEDIDO_SIN_CONFIRMAR: 1, CONSULTA: 1, SALUDO: 1, SIN_MOTIVO: 1 });
  assert.deepEqual([r.conversations, r.source], [9, "DETECTADO"]);
  assert.deepEqual([r.orders.RETIRO, r.orders.RECETA, r.orders.DOMICILIO, r.consults.PRECIO], [1, 1, 0, 1]);
  assert.deepEqual(r.noTake, { SIN_STOCK: 0, DERIVADO_PRESENCIAL: 1 });
  assert.deepEqual(r.byDay.map((d) => [d.day, d.PEDIDO, d.CONSULTA, d.RECLAMO]), [["2026-03-03", 2, 1, 0], ["2026-03-04", 0, 0, 1]]);
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
