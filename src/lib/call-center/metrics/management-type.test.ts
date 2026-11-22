/**
 * Tipo de gestión y vía de salida del bot. PURO, textos inventados salvo las plantillas.
 *
 *   npx tsx src/lib/call-center/metrics/management-type.test.ts
 */
import assert from "node:assert/strict";
import { classifyBotExit, classifyManagementType, isMeducarFirstMessage } from "./management-type";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

test("Meducar: frase + enlace en el primer mensaje", () => {
  assert.equal(isMeducarFirstMessage("Hola, quiero realizar un pedido sobre esta receta https://cdn.meducar.com/r/inventado.pdf"), true);
  assert.equal(isMeducarFirstMessage("QUIERO REALIZAR UN PEDIDO SOBRE ESTA RECETA: https://CDN.MEDUCAR.COM/x"), true);
});

test("Meducar: solo el enlace, solo la frase, otro dominio o sin texto → no", () => {
  assert.equal(isMeducarFirstMessage("https://cdn.meducar.com/r/inventado.pdf"), false);
  assert.equal(isMeducarFirstMessage("quiero realizar un pedido sobre esta receta"), false);
  assert.equal(isMeducarFirstMessage("quiero realizar un pedido sobre esta receta https://cdn-meducar.example.com/x"), false);
  assert.equal(isMeducarFirstMessage(null), false);
  assert.equal(isMeducarFirstMessage(""), false);
});

test("tipo de gestión: Meducar tiene prioridad sobre pedido; sin marcas → otros", () => {
  assert.equal(classifyManagementType({ firstCustomerMessageIsMeducar: true, orderFlow: true }), "MEDUCAR");
  assert.equal(classifyManagementType({ firstCustomerMessageIsMeducar: false, orderFlow: true }), "PEDIDO");
  assert.equal(classifyManagementType({ firstCustomerMessageIsMeducar: false, orderFlow: false }), "OTROS");
});

const t = (s: string) => new Date(`2026-03-02T${s}.000Z`);
test("salida del bot: pegada al mensaje final → pedido completo", () => {
  assert.equal(classifyBotExit(t("13:00:02"), t("13:00:00")), "PEDIDO_COMPLETO");
  assert.equal(classifyBotExit(t("13:00:05"), t("13:00:00")), "PEDIDO_COMPLETO");
});

test("salida del bot: lejos del mensaje final o sin mensaje final → sin completar", () => {
  assert.equal(classifyBotExit(t("13:00:06"), t("13:00:00")), "SIN_MENSAJE_FINAL");
  assert.equal(classifyBotExit(t("13:11:00"), null), "SIN_MENSAJE_FINAL");
});

test("salida del bot: sin cambio de estado → sin registro, aunque exista el mensaje final", () => {
  assert.equal(classifyBotExit(null, null), "SIN_REGISTRO");
  assert.equal(classifyBotExit(null, t("13:00:00")), "SIN_REGISTRO");
});

console.log(`\nmetrics/management-type: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
