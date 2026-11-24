/**
 * Operadores por cuenta de Emozion. PURO, datos inventados (cuentas 9001 a 9004).
 *
 *   npx tsx src/lib/call-center/metrics/accounts.test.ts
 *
 * Horario de prueba: público lunes a viernes 10–18; operadores lunes a viernes 09–19.
 */
import assert from "node:assert/strict";
import { buildAccountsReport, type FollowupBlockRow, type OperatorMessageRow } from "./accounts";
import { toEntryFact, type EntryRow } from "./attention";
import { publicHours } from "./schedule";
import type { ConfigVersion } from "./config";
import type { ConfigAccount, WeekSchedule } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const week = (from: string, to: string): WeekSchedule => {
  const d = [{ from, to }];
  return { "1": d, "2": d, "3": d, "4": d, "5": d, "6": [], "7": [] };
};
const acc = (externalId: string, over: Partial<ConfigAccount> = {}): ConfigAccount =>
  ({ externalId, alias: null, active: true, borrowed: false, historical: false, ...over });
const versions: ConfigVersion[] = [{
  id: "v1", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"),
  data: {
    schemaVersion: 1, publicHours: week("10:00", "18:00"), operatorHours: week("09:00", "19:00"), firstResponseGoalMinutes: 15,
    accounts: [acc("9001", { alias: "Cuenta inventada" }), acc("9002", { borrowed: true }), acc("9003", { active: false, historical: true }), acc("9005")],
    callCenterVendors: [],
  },
}];
const NOW = at("2026-03-04T12:00");
const msg = (account: string | null, conversationId: string, t: string, isPrivate = false): OperatorMessageRow =>
  ({ account, conversationId, sentAt: at(t), isPrivate });
const block = (conversationId: string, start: string, responded: string | null, account: string | null): FollowupBlockRow =>
  ({ conversationId, startedAt: at(start), respondedAt: responded ? at(responded) : null, account });
let n = 0;
const fact = (created: string, answered: string | null, account: string | null) => {
  const createdAt = at(created);
  const row: EntryRow = {
    conversationId: `f${++n}`, createdAt, firstCustomerAt: createdAt, botExitAt: createdAt, botOrderCompleteAt: null,
    firstHumanAt: answered ? at(answered) : null, firstHumanAccount: account, orderFlow: false,
    firstCustomerMessageIsMeducar: false, customerChars: 100, customerSentMedia: false, customerSentLink: false,
    previousResolvedRecently: false,
  };
  return toEntryFact(row, NOW, versions, publicHours(versions));
};
const build = (i: { messages?: OperatorMessageRow[]; followups?: FollowupBlockRow[]; facts?: ReturnType<typeof fact>[] }, v = versions) =>
  buildAccountsReport({ messages: i.messages ?? [], followups: i.followups ?? [], facts: i.facts ?? [] }, { now: NOW, versions: v });
const of = (r: ReturnType<typeof build>, account: string | null) => r.accounts.find((a) => a.account === account)!;

test("una conversación con dos cuentas cuenta para las dos y una vez en el equipo", () => {
  const r = build({ messages: [
    msg("9001", "c1", "2026-03-02T10:00"), msg("9002", "c1", "2026-03-02T11:00"), msg("9001", "c2", "2026-03-02T12:00"),
  ] });
  assert.equal(of(r, "9001").conversations, 2);
  assert.equal(of(r, "9002").conversations, 1);
  assert.equal(r.team.conversations, 2);
  assert.equal(r.team.conversationsWithSeveralAccounts, 1);
});

test("las notas internas se cuentan aparte y no dan participación", () => {
  const r = build({ messages: [msg("9001", "c1", "2026-03-02T10:00", true), msg("9001", "c1", "2026-03-02T10:05", true)] });
  assert.equal(of(r, "9001").privateNotes, 2);
  assert.equal(of(r, "9001").publicMessages, 0);
  assert.equal(of(r, "9001").conversations, 0);
  assert.equal(r.team.conversations, 0);
  assert.equal(r.team.privateNotes, 2);
});

test("primeras respuestas: se atribuyen a la cuenta que respondió; las pendientes no entran", () => {
  const r = build({ facts: [
    fact("2026-03-02T10:00", "2026-03-02T10:10", "9001"),
    fact("2026-03-02T10:00", "2026-03-02T10:30", "9001"),
    fact("2026-03-02T10:00", "2026-03-02T11:00", "9002"),
    fact("2026-03-02T10:00", null, null),
  ] });
  assert.deepEqual(of(r, "9001").firstResponses, { n: 2, median: 20, p90: 28 });
  assert.equal(of(r, "9002").firstResponses.n, 1);
  assert.equal(r.team.firstResponses.n, 3);
});

test("respuestas posteriores: demora por bloque; los bloques sin respuesta van aparte", () => {
  const r = build({ followups: [
    block("c1", "2026-03-02T10:00", "2026-03-02T10:04", "9001"),
    block("c1", "2026-03-02T11:00", "2026-03-02T11:10", "9001"),
    block("c2", "2026-03-02T12:00", "2026-03-02T12:02", "9002"),
    block("c3", "2026-03-02T13:00", null, null),
  ] });
  assert.equal(of(r, "9001").followups.median, 7);
  assert.equal(of(r, "9002").followups.median, 2);
  assert.equal(r.team.followups.n, 3);
  assert.equal(r.team.followupsUnanswered, 1);
});

test("actividad observada: dentro del horario público, solo en el de operadores y fuera de ambos", () => {
  const r = build({ messages: [
    msg("9001", "c1", "2026-03-02T09:30"), // operadores, no público
    msg("9001", "c1", "2026-03-02T10:00"), // público
    msg("9001", "c1", "2026-03-02T17:59"), // público
    msg("9001", "c1", "2026-03-02T18:30"), // operadores, no público
    msg("9001", "c1", "2026-03-02T21:00"), // fuera de ambos
    msg("9001", "c2", "2026-03-03T11:00"), // público, otro día
  ] });
  const a = of(r, "9001").activity;
  assert.deepEqual([a.inPublicHours, a.inOperatorHoursOnly, a.outsideAllHours], [3, 2, 1]);
  // Una nota interna no entra en el desglose por horario: el desglose suma los mensajes a clientes.
  const conNota = build({ messages: [msg("9001", "c1", "2026-03-02T10:00"), { ...msg("9001", "c1", "2026-03-02T10:05"), isPrivate: true }] });
  const n = of(conNota, "9001");
  assert.deepEqual([n.publicMessages, n.privateNotes, n.activity.inPublicHours! + n.activity.inOperatorHoursOnly! + n.activity.outsideAllHours!], [1, 1, 1]);
  assert.equal(a.daysWithActivity, 2);
  assert.equal(a.firstMessageAt?.toISOString(), at("2026-03-02T09:30").toISOString());
  assert.equal(a.lastMessageAt?.toISOString(), at("2026-03-03T11:00").toISOString());
});

test("evolución por cuenta: por día, mensajes a clientes, conversaciones y respuestas posteriores por el día en que empezó el bloque", () => {
  const r = build({
    messages: [
      msg("9001", "c1", "2026-03-02T10:00"), msg("9001", "c1", "2026-03-02T10:30"), msg("9001", "c2", "2026-03-02T11:00"),
      { ...msg("9001", "c2", "2026-03-02T11:05"), isPrivate: true },
      msg("9001", "c3", "2026-03-04T11:00"),
    ],
    followups: [
      // Empezó el 02/03 a la noche y se respondió el 03/03: cuenta en el 02/03.
      { conversationId: "c1", startedAt: at("2026-03-02T23:00"), respondedAt: at("2026-03-03T10:00"), account: "9001" },
      { conversationId: "c2", startedAt: at("2026-03-02T11:10"), respondedAt: at("2026-03-02T11:20"), account: "9001" },
      { conversationId: "c3", startedAt: at("2026-03-04T11:10"), respondedAt: null, account: null },
    ],
  });
  assert.deepEqual(of(r, "9001").daily, [
    { day: "2026-03-02", publicMessages: 3, conversations: 2, followups: 2, followupMedian: 335 },
    { day: "2026-03-04", publicMessages: 1, conversations: 1, followups: 0, followupMedian: null },
  ]);
});

test("sin horario configurado: la actividad por horario queda no disponible, no en cero", () => {
  const r = build({ messages: [msg("9001", "c1", "2026-03-02T10:00")] }, []);
  const a = of(r, "9001").activity;
  assert.equal(a.inPublicHours, null);
  assert.equal(a.outsideAllHours, null);
  assert.equal(of(r, "9001").status, "SIN_CONFIGURAR");
});

test("estado y marcas desde la configuración: activa con alias, prestada, histórica y sin configurar", () => {
  const r = build({ messages: [
    msg("9001", "c1", "2026-03-02T10:00"), msg("9002", "c2", "2026-03-02T10:00"),
    msg("9003", "c3", "2026-03-02T10:00"), msg("9004", "c4", "2026-03-02T10:00"),
  ] });
  assert.deepEqual([of(r, "9001").status, of(r, "9001").alias], ["ACTIVA", "Cuenta inventada"]);
  assert.equal(of(r, "9002").borrowed, true);
  assert.equal(of(r, "9003").status, "HISTORICA");
  assert.equal(of(r, "9004").status, "SIN_CONFIGURAR");
});

test("cuenta activa sin mensajes en el período: se informa aparte (ausencia), la histórica no", () => {
  const r = build({ messages: [msg("9001", "c1", "2026-03-02T10:00")] });
  assert.deepEqual(r.activeWithoutMessages.map((a) => a.account), ["9002", "9005"]);
});

test("mensaje sin remitente: fila propia, sin configurar", () => {
  const r = build({ messages: [msg(null, "c1", "2026-03-02T10:00")] });
  assert.equal(of(r, null).publicMessages, 1);
  assert.equal(of(r, null).status, "SIN_CONFIGURAR");
});

test("orden por número de cuenta, no por demora ni por volumen", () => {
  const r = build({
    messages: [msg("9010", "c1", "2026-03-02T10:00"), msg("902", "c2", "2026-03-02T10:00"), msg("9001", "c3", "2026-03-02T10:00"), msg("9001", "c4", "2026-03-02T10:00")],
    facts: [fact("2026-03-02T10:00", "2026-03-02T16:00", "902")],
  });
  assert.deepEqual(r.accounts.map((a) => a.account), ["902", "9001", "9010"]);
});

test("el informe no lleva nombres de personas: solo número de cuenta y alias", () => {
  const r = build({ messages: [msg("9001", "c1", "2026-03-02T10:00")] });
  assert.ok(!/userName|employee|displayName|phone/i.test(Object.keys(r.accounts[0]).join(",")));
});

test("cuenta de sistema: si escribe va en un grupo aparte y no suma en el equipo ni en las activas sin mensajes", () => {
  const withSystem: ConfigVersion[] = [{ ...versions[0], data: { ...versions[0].data, accounts: [acc("9001"), acc("9009", { system: true }), acc("9008", { system: true })] } }];
  const r = build({
    messages: [msg("9001", "c1", "2026-03-02T10:00"), msg("9009", "c1", "2026-03-02T10:30"), msg("9009", "c2", "2026-03-02T11:00"), msg("9009", "c2", "2026-03-02T11:05", true)],
    followups: [block("c1", "2026-03-02T10:10", "2026-03-02T10:30", "9009"), block("c1", "2026-03-02T10:40", "2026-03-02T10:50", "9001")],
    facts: [fact("2026-03-02T10:00", "2026-03-02T10:20", "9009"), fact("2026-03-02T10:00", "2026-03-02T10:05", "9001")],
  }, withSystem);
  assert.deepEqual(r.accounts.map((a) => a.account), ["9001"]);
  assert.deepEqual(r.systemAccounts.map((a) => [a.account, a.conversations, a.privateNotes]), [["9009", 2, 1]]);
  assert.deepEqual([r.team.conversations, r.team.conversationsWithSeveralAccounts, r.team.privateNotes], [1, 0, 0]);
  assert.deepEqual([r.team.firstResponses.n, r.team.followups.n], [1, 1]);
  assert.deepEqual(r.activeWithoutMessages, []);
});

test("cuenta de supervisión: va en su grupo, aparte de los operadores y de las de sistema, y no suma en el equipo", () => {
  const withSup: ConfigVersion[] = [{ ...versions[0], data: { ...versions[0].data, accounts: [acc("9001"), acc("9007", { supervision: true, alias: "Supervisión inventada" }), acc("9009", { system: true })] } }];
  const r = build({
    messages: [msg("9001", "c1", "2026-03-02T10:00"), msg("9007", "c1", "2026-03-02T10:30"), msg("9007", "c2", "2026-03-02T11:00"), msg("9007", "c2", "2026-03-02T11:05", true)],
    followups: [block("c1", "2026-03-02T10:10", "2026-03-02T10:30", "9007"), block("c1", "2026-03-02T10:40", "2026-03-02T10:50", "9001")],
    facts: [fact("2026-03-02T10:00", "2026-03-02T10:20", "9007"), fact("2026-03-02T10:00", "2026-03-02T10:05", "9001")],
  }, withSup);
  assert.deepEqual(r.accounts.map((a) => a.account), ["9001"]);
  assert.deepEqual(r.supervisionAccounts.map((a) => [a.account, a.alias, a.conversations, a.privateNotes]), [["9007", "Supervisión inventada", 2, 1]]);
  assert.deepEqual(r.systemAccounts, []);
  // El equipo cuenta solo lo de los operadores.
  assert.deepEqual([r.team.conversations, r.team.conversationsWithSeveralAccounts, r.team.privateNotes], [1, 0, 0]);
  assert.deepEqual([r.team.firstResponses.n, r.team.followups.n], [1, 1]);
  // Sin mensajes en el período no aparece entre las cuentas activas sin mensajes: no es un operador.
  assert.deepEqual(build({ messages: [msg("9001", "c1", "2026-03-02T10:00")] }, withSup).activeWithoutMessages, []);
});

test("sin cuentas de sistema el grupo queda vacío", () => {
  assert.deepEqual(build({ messages: [msg("9001", "c1", "2026-03-02T10:00")] }).systemAccounts, []);
});

console.log(`\nmetrics/accounts: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
