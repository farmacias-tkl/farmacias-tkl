/**
 * Clasificación de "Cerradas sin responder". PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/closed-unanswered.test.ts
 */
import assert from "node:assert/strict";
import { buildClosedUnanswered, classifyClosedBlock, type ClosedBlockRow } from "./closed-unanswered";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const row = (id: string, over: Partial<ClosedBlockRow> = {}): ClosedBlockRow => ({
  conversationId: id, lastCustomerAt: at("2026-03-05T10:00"), hasHumanResponse: true, botOrderComplete: false, botInfoAnswer: false,
  blockHasAttachment: false, blockHasQuestion: false, blockHasOrderRequest: false, blockAlreadyBought: false, blockNotCustomer: false, ...over,
});

test("agradecimiento o cierre natural: no entra", () => {
  assert.equal(classifyClosedBlock(row("a")), "NONE");
});

test("consulta, pedido y adjunto entran, cada uno con su motivo", () => {
  assert.equal(classifyClosedBlock(row("a", { blockHasQuestion: true })), "QUESTION");
  assert.equal(classifyClosedBlock(row("a", { blockHasOrderRequest: true })), "ORDER");
  assert.equal(classifyClosedBlock(row("a", { blockHasAttachment: true })), "ATTACHMENT");
});

test("pedido completo en el bot: es pedido solo si nunca respondió una persona", () => {
  assert.equal(classifyClosedBlock(row("a", { botOrderComplete: true, hasHumanResponse: false })), "ORDER");
  assert.equal(classifyClosedBlock(row("a", { botOrderComplete: true, hasHumanResponse: true })), "NONE");
});

test("imagen sola después de la respuesta del operador: cuenta como receta o comprobante", () => {
  assert.equal(classifyClosedBlock(row("a", { hasHumanResponse: true, blockHasAttachment: true })), "ATTACHMENT");
});

test("aviso de que ya compró o ya fue: no entra, aunque traiga una pregunta o un adjunto", () => {
  assert.equal(classifyClosedBlock(row("a", { blockAlreadyBought: true, blockHasQuestion: true, blockHasAttachment: true })), "ALREADY_BOUGHT");
});

test("no es cliente: gana sobre todo lo demás", () => {
  assert.equal(classifyClosedBlock(row("a", { blockNotCustomer: true, blockHasAttachment: true, blockHasQuestion: true, blockHasOrderRequest: true })), "NOT_CUSTOMER");
});

test("consulta que el bot ya contestó: no cuenta; con respuesta de una persona o con adjunto, sí", () => {
  assert.equal(classifyClosedBlock(row("a", { hasHumanResponse: false, botInfoAnswer: true, blockHasQuestion: true })), "BOT_ANSWERED");
  assert.equal(classifyClosedBlock(row("a", { hasHumanResponse: true, botInfoAnswer: true, blockHasQuestion: true })), "QUESTION");
  assert.equal(classifyClosedBlock(row("a", { hasHumanResponse: false, botInfoAnswer: true, blockHasQuestion: true, blockHasAttachment: true })), "ATTACHMENT");
});

test("resumen: totales por motivo, no clientes aparte y lista del más nuevo al más viejo", () => {
  const r = buildClosedUnanswered([
    row("q", { blockHasQuestion: true, lastCustomerAt: at("2026-03-03T10:00") }),
    row("o", { blockHasOrderRequest: true, lastCustomerAt: at("2026-03-05T10:00") }),
    row("f", { blockHasAttachment: true, lastCustomerAt: at("2026-03-04T10:00") }),
    row("gracias"),
    row("compro", { blockAlreadyBought: true }),
    row("prov", { blockNotCustomer: true }),
    row("bot", { hasHumanResponse: false, botInfoAnswer: true, blockHasQuestion: true }),
  ]);
  assert.deepEqual([r.days, r.total, r.question, r.order, r.attachment, r.notCustomers], [7, 3, 1, 1, 1, 1]);
  assert.deepEqual(r.items.map((i) => [i.conversationId, i.reason]), [["o", "ORDER"], ["f", "ATTACHMENT"], ["q", "QUESTION"]]);
});

test("sin filas: todo en cero y lista vacía", () => {
  assert.deepEqual(buildClosedUnanswered([]), { days: 7, total: 0, question: 0, order: 0, attachment: 0, notCustomers: 0, items: [] });
});

console.log(`\nmetrics/closed-unanswered: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
