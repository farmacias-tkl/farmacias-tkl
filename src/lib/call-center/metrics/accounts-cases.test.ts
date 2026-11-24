/**
 * Detalle de casos de "Operadores". PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/accounts-cases.test.ts
 */
import assert from "node:assert/strict";
import { isOperatorCaseKind, selectOperatorCases, type OperatorCasesInput } from "./accounts-cases";
import type { EntryFact } from "./attention";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const at = (s: string) => new Date(`${s}:00.000-03:00`);
const accounts = [
  { externalId: "9001", alias: "Mostrador Uno", system: false, supervision: false },
  { externalId: "9002", alias: null, system: false, supervision: false },
  { externalId: "9009", alias: "Supervisión", system: false, supervision: true },
];
const opts = { now: at("2026-03-05T12:00"), accounts, outsideTeam: (a: string | null) => a === "9009" };
const block = (conversationId: string, started: string, responded: string | null, account: string | null) =>
  ({ conversationId, startedAt: at(started), respondedAt: responded ? at(responded) : null, account });
const msg = (account: string, conversationId: string, sent: string, isPrivate = false) => ({ account, conversationId, sentAt: at(sent), isPrivate });
const fact = (conversationId: string, over: Partial<EntryFact>) =>
  ({ conversationId, clockStart: at("2026-03-02T20:00"), firstHumanAt: at("2026-03-03T10:00"), firstHumanAccount: "9001", answeredSameDay: false, clockMinutes: 840, botOrderCompleteAt: null, ...over }) as EntryFact;

const input: OperatorCasesInput = {
  followups: [
    block("c1", "2026-03-03T10:00", "2026-03-03T10:05", "9001"),
    block("c2", "2026-03-03T11:00", "2026-03-03T12:30", "9002"),
    block("c3", "2026-03-03T12:00", "2026-03-03T12:40", "9001"),
    block("c4", "2026-03-04T09:00", "2026-03-04T15:00", "9009"),
    block("c5", "2026-03-04T10:00", null, null),
    block("c6", "2026-03-03T09:00", null, null),
  ],
  messages: [
    msg("9001", "c1", "2026-03-03T10:05"), msg("9002", "c1", "2026-03-03T10:30"),
    msg("9001", "c2", "2026-03-03T12:30"), msg("9002", "c2", "2026-03-03T12:31", true),
    msg("9001", "c3", "2026-03-03T12:40"), msg("9009", "c3", "2026-03-03T12:50"),
  ],
  facts: [
    fact("c1", {}),
    fact("c2", { firstHumanAccount: "9002", clockMinutes: 900, botOrderCompleteAt: at("2026-03-02T19:59") }),
    fact("c3", { answeredSameDay: true }),
    fact("c4", { firstHumanAt: null, clockMinutes: null }),
  ],
};

test("respuestas posteriores que más tardaron: de mayor a menor, del equipo o de una cuenta", () => {
  const team = selectOperatorCases(input, "slow_followups", null, opts);
  assert.deepEqual(team.map((c) => [c.conversationId, c.waitMinutes, c.accounts]), [["c2", 90, ["Cuenta 9002"]], ["c3", 40, ["Mostrador Uno"]], ["c1", 5, ["Mostrador Uno"]]], "la de supervisión no es del equipo");
  assert.deepEqual(selectOperatorCases(input, "slow_followups", "9001", opts).map((c) => c.conversationId), ["c3", "c1"]);
  assert.deepEqual(selectOperatorCases(input, "slow_followups", "9009", opts).map((c) => c.waitMinutes), [360], "pedida por cuenta, sí se ve");
});

test("bloques sin respuesta: del más viejo al más nuevo y sin atribuir a ninguna cuenta", () => {
  const list = selectOperatorCases(input, "unanswered_blocks", "9001", opts);
  assert.deepEqual(list.map((c) => [c.conversationId, c.accounts]), [["c6", []], ["c5", []]]);
  assert.equal(list[0].waitMinutes, 51 * 60);
});

test("varias cuentas: solo mensajes a clientes de cuentas del equipo", () => {
  const list = selectOperatorCases(input, "several_accounts", null, opts);
  // c2: la segunda cuenta solo dejó una nota. c3: la segunda es de supervisión.
  assert.deepEqual(list.map((c) => [c.conversationId, c.accounts, c.waitMinutes]), [["c1", ["Cuenta 9002", "Mostrador Uno"], null]]);
  assert.equal(selectOperatorCases(input, "several_accounts", "9002", opts).length, 1);
});

test("primeras respuestas a conversaciones de un día anterior: las respondidas otro día, con la marca de pedido", () => {
  const list = selectOperatorCases(input, "first_response_later_day", null, opts);
  assert.deepEqual(list.map((c) => [c.conversationId, c.waitMinutes, c.order]), [["c2", 900, true], ["c1", 840, false]]);
  assert.deepEqual(selectOperatorCases(input, "first_response_later_day", "9001", opts).map((c) => c.conversationId), ["c1"]);
});

test("los casos no llevan datos del cliente, y el indicador se valida", () => {
  const all = (["slow_followups", "unanswered_blocks", "several_accounts", "first_response_later_day"] as const).flatMap((k) => selectOperatorCases(input, k, null, opts));
  for (const c of all) assert.deepEqual(Object.keys(c).sort(), ["accounts", "at", "conversationId", "order", "waitMinutes"]);
  assert.equal(isOperatorCaseKind("slow_followups"), true);
  assert.equal(isOperatorCaseKind("otra"), false);
});

console.log(`\nmetrics/accounts-cases: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
