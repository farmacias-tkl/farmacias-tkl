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
  conversationId: `k${++n}`, createdAt: at("2026-03-03T10:00"), claim: false, meducar: false, orderMenu: false, homeDelivery: false, pickup: false,
  botOrderComplete: false, hasHumanResponse: false, payment: false, coordination: false, customerMedia: false, hasFreeText: true, onlyEmptyText: false,
  hasQuestionMark: false, buttonHours: false, buttonOnlineStore: false, buttonAdvisor: false, price: false, stock: false, hours: false, coverage: false,
  paymentMethod: false, onlineStore: false, ...over,
});
const kind = (over: Partial<KindRow>) => classifyKind(row(over));

test("prioridad: un reclamo gana aunque también sea pedido o consulta", () => {
  assert.deepEqual(kind({ claim: true, meducar: true, payment: true, price: true }), { main: "RECLAMO", sub: null });
});

test("pedido: receta de Meducar, o evidencia de pago o de coordinación", () => {
  assert.deepEqual(kind({ meducar: true }), { main: "PEDIDO", sub: "MEDUCAR" });
  assert.deepEqual(kind({ payment: true, homeDelivery: true }), { main: "PEDIDO", sub: "DOMICILIO" });
  assert.deepEqual(kind({ coordination: true, pickup: true }), { main: "PEDIDO", sub: "RETIRO" });
  assert.deepEqual(kind({ payment: true }), { main: "PEDIDO", sub: "SIN_MODALIDAD" });
});

test("elegir 'Pedir medicamentos' no alcanza: sin evidencia es una consulta", () => {
  assert.deepEqual(kind({ orderMenu: true, pickup: true, price: true, hasHumanResponse: true }), { main: "CONSULTA", sub: "PRECIO" });
  assert.deepEqual(kind({ orderMenu: true, stock: true }), { main: "CONSULTA", sub: "STOCK" });
  assert.deepEqual(kind({ orderMenu: true, hasHumanResponse: true }), { main: "CONSULTA", sub: "OTRAS" });
});

test("pedido sin confirmar: completó el bot sin pago ni coordinación; va aparte, no como pedido", () => {
  assert.deepEqual(kind({ orderMenu: true, botOrderComplete: true, hasHumanResponse: true, homeDelivery: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
  assert.deepEqual(kind({ orderMenu: true, botOrderComplete: true }), { main: "PEDIDO_SIN_CONFIRMAR", sub: null });
  // Con evidencia de pago, es un pedido.
  assert.equal(kind({ orderMenu: true, botOrderComplete: true, payment: true }).main, "PEDIDO");
});

test("adjunto sin menú ni otra evidencia: es una consulta, no un pedido", () => {
  assert.deepEqual(kind({ customerMedia: true, hasFreeText: false, hasHumanResponse: true }), { main: "CONSULTA", sub: "OTRAS" });
});

test("sin contenido: solo saludos, agradecimientos o botones, y sin adjuntos", () => {
  assert.equal(kind({ onlyEmptyText: true }).main, "SIN_CONTENIDO");
  assert.equal(kind({ hasFreeText: false }).main, "SIN_CONTENIDO");
  assert.equal(kind({ hasFreeText: false, orderMenu: true }).main, "SIN_CONTENIDO", "tocó botones y abandonó");
  assert.equal(kind({ onlyEmptyText: true, customerMedia: true }).main, "CONSULTA", "un agradecimiento con una foto tiene contenido");
  assert.equal(kind({ hasFreeText: false, buttonHours: true }).main, "CONSULTA", "pidió sucursales y horarios desde el menú");
});

test("consultas: subtipo por palabras, con el orden precio, stock, horarios, cobertura, pago, tienda online", () => {
  assert.equal(kind({ price: true, stock: true, coverage: true }).sub, "PRECIO");
  assert.equal(kind({ stock: true, hours: true }).sub, "STOCK");
  assert.equal(kind({ buttonHours: true, coverage: true }).sub, "HORARIOS");
  assert.equal(kind({ coverage: true, paymentMethod: true }).sub, "COBERTURA");
  assert.equal(kind({ paymentMethod: true, onlineStore: true }).sub, "PAGO");
  assert.equal(kind({ buttonOnlineStore: true }).sub, "TIENDA_ONLINE");
  assert.equal(kind({ hasQuestionMark: true }).sub, "OTRAS");
});

test("sin clasificar: escribió algo y ninguna regla alcanzó", () => {
  assert.deepEqual(kind({}), { main: "SIN_CLASIFICAR", sub: null });
});

test("informe: totales, subtipos, por día y por hora de Buenos Aires", () => {
  const r = buildKindsReport([
    row({ payment: true, pickup: true, createdAt: at("2026-03-03T09:30") }),
    row({ meducar: true, createdAt: at("2026-03-03T15:00") }),
    row({ price: true, createdAt: at("2026-03-03T23:59") }),   // 04/03 en UTC: tiene que quedar el 03/03 a las 23
    row({ claim: true, createdAt: at("2026-03-04T10:00") }),
    row({ onlyEmptyText: true, createdAt: at("2026-03-04T10:00") }),
    row({ orderMenu: true, botOrderComplete: true, createdAt: at("2026-03-04T11:00") }),
    row({ createdAt: at("2026-03-04T12:00") }),
  ], { now: at("2026-03-05T12:00"), from: "2026-03-03", to: "2026-03-04" });
  assert.deepEqual(r.total, { RECLAMO: 1, PEDIDO: 2, PEDIDO_SIN_CONFIRMAR: 1, CONSULTA: 1, SIN_CONTENIDO: 1, SIN_CLASIFICAR: 1 });
  assert.deepEqual([r.conversations, r.source], [7, "DETECTADO"]);
  assert.deepEqual([r.orders.RETIRO, r.orders.MEDUCAR, r.orders.DOMICILIO, r.consults.PRECIO], [1, 1, 0, 1]);
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
