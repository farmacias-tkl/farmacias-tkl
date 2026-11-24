/**
 * Detalle de casos de "Atención y demoras". PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/attention-cases.test.ts
 *
 * Horario de prueba: público lunes a viernes 09–19. Meta: 15 minutos hábiles.
 */
import assert from "node:assert/strict";
import { isAttentionCaseKind, selectCases, toAttentionCases, type CaseState } from "./attention-cases";
import { summarize, toEntryFact, type EntryRow } from "./attention";
import { publicHours } from "./schedule";
import type { ConfigVersion } from "./config";
import type { WeekSchedule } from "./config-schema";

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
const acc = (externalId: string, over: object = {}) => ({ externalId, alias: null, active: true, borrowed: false, historical: false, ...over });
const versions: ConfigVersion[] = [{
  id: "v1", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"),
  data: {
    schemaVersion: 1, publicHours: week("09:00", "19:00"), operatorHours: week("08:00", "20:00"), firstResponseGoalMinutes: 15,
    accounts: [acc("9000", { system: true, active: false }), acc("9001", { alias: "Alias inventado" })], callCenterVendors: [],
  },
}];
const NOW = at("2026-03-04T12:00"); // miércoles
const row = (id: string, created: string, answered: string | null, over: Partial<EntryRow> = {}): EntryRow => ({
  conversationId: id, createdAt: at(created), firstCustomerAt: at(created), botExitAt: at(created), botOrderCompleteAt: null,
  firstHumanAt: answered ? at(answered) : null, firstHumanAccount: answered ? "9001" : null, orderFlow: false,
  firstCustomerMessageIsMeducar: false, customerChars: 100, customerSentMedia: false, customerSentLink: false, previousResolvedRecently: false, ...over,
});
const rows = [
  row("a-tiempo", "2026-03-03T10:00", "2026-03-03T10:05"),
  row("tarde", "2026-03-03T10:00", "2026-03-03T12:00"),
  row("otro-dia", "2026-03-03T18:00", "2026-03-04T09:30"),
  row("vencida", "2026-03-03T11:00", null, { botOrderCompleteAt: at("2026-03-03T11:00") }),
  row("vencida-vieja", "2026-03-02T11:00", null),
  row("en-plazo", "2026-03-04T11:50", null),
];
const facts = rows.map((r) => toEntryFact(r, NOW, versions, publicHours(versions)));
const ids = (kind: Parameters<typeof selectCases>[1]) => selectCases(facts, kind).map((f) => f.conversationId).sort();
const accounts = versions[0].data.accounts;

test("cada lista tiene exactamente los casos que cuenta el informe", () => {
  const s = summarize(facts, NOW);
  assert.equal(ids("pending").length, s.pending.total);
  assert.equal(ids("overdue").length, s.goal!.pendingOverdue);
  assert.equal(ids("unanswered_same_day").length, s.unansweredSameDay.total);
  // Las que no cumplieron la meta: respondidas tarde más pendientes vencidas.
  assert.equal(ids("goal_missed").length, s.goal!.answeredLate + s.goal!.pendingOverdue);
  // Las que más esperaron: solo respondidas con meta, de la que más tiempo hábil esperó a la que menos.
  const slow = selectCases(facts, "slowest");
  assert.ok(slow.every((f) => f.firstHumanAt && f.goal));
  assert.deepEqual(slow.map((f) => f.goal!.businessMinutes), [...slow.map((f) => f.goal!.businessMinutes)].sort((x, y) => y - x));
  // Los nuevos conteos de la tarjeta cierran con los que ya había.
  assert.equal(s.unansweredSameDay.answeredLater + s.unansweredSameDay.stillPending, s.unansweredSameDay.total);
  assert.equal(s.goal!.evaluable, s.goal!.answeredWithin + s.goal!.answeredLate + s.goal!.pendingOverdue);
  assert.equal(s.goal!.evaluable + s.goal!.pendingWithin + s.outsidePublicHours.answered + s.withoutConfig, s.entries, "evaluables más fuera del cálculo son las entradas");
  assert.ok(s.windowClosedAnsweredLater <= s.windowClosed);
});

test("sin primera respuesta: las pendientes, vencidas o no", () => {
  assert.deepEqual(ids("pending"), ["en-plazo", "vencida", "vencida-vieja"]);
});

test("meta vencida: solo pendientes que ya pasaron la meta; la que sigue en plazo no entra", () => {
  assert.deepEqual(ids("overdue"), ["vencida", "vencida-vieja"]);
});

test("sin respuesta el mismo día: incluye la respondida al día siguiente", () => {
  assert.deepEqual(ids("unanswered_same_day"), ["en-plazo", "otro-dia", "vencida", "vencida-vieja"]);
});

test("filas: de la espera más vieja a la más nueva, con horas, minutos hábiles y etiquetas", () => {
  const states = new Map<string, CaseState>([
    ["vencida", { status: "ASIGNADA", externalAssigneeId: "9001" }],
    ["vencida-vieja", { status: "RESUELTA", externalAssigneeId: "9000" }],
  ]);
  const list = toAttentionCases(selectCases(facts, "pending"), NOW, states, accounts);
  assert.deepEqual(list.map((c) => c.conversationId), ["vencida-vieja", "vencida", "en-plazo"]);
  const [vieja, vencida, plazo] = list;
  assert.deepEqual([vieja.open, vieja.owner, vieja.overdue], [false, { kind: "SYSTEM" }, true]);
  assert.deepEqual([vencida.open, vencida.owner, vencida.orderComplete], [true, { kind: "ACCOUNT", label: "Alias inventado" }, true]);
  // Sin estado leído: no se inventa si está abierta ni quién la tiene.
  assert.deepEqual([plazo.open, plazo.owner, plazo.overdue, plazo.businessMinutes, plazo.waitMinutes], [null, { kind: "UNKNOWN" }, false, 10, 10]);
  // 11:00 a 19:00 del martes (480) más 09:00 a 12:00 del miércoles (180).
  assert.deepEqual([vencida.businessMinutes, vencida.waitMinutes, vencida.answeredAt], [660, 25 * 60, null]);
});

test("respondida otro día: lleva la hora de la respuesta y la espera hasta ese momento", () => {
  const [c] = toAttentionCases(facts.filter((f) => f.conversationId === "otro-dia"), NOW, new Map(), accounts);
  assert.deepEqual([c.answeredAt, c.waitMinutes, c.overdue], [at("2026-03-04T09:30").toISOString(), 15.5 * 60, true]);
});

test("sin configuración vigente: sin minutos hábiles ni marca de meta, no cero", () => {
  const sin = rows.map((r) => toEntryFact(r, NOW, [], publicHours([])));
  assert.deepEqual(selectCases(sin, "overdue"), []);
  const [c] = toAttentionCases(selectCases(sin, "pending"), NOW, new Map(), []);
  assert.deepEqual([c.businessMinutes, c.overdue], [null, null]);
});

test("las filas no llevan teléfono, nombre ni texto; el indicador se valida", () => {
  const json = JSON.stringify(toAttentionCases(facts, NOW, new Map(), accounts));
  assert.ok(!/phone|displayName|body|customerChars/i.test(json));
  assert.deepEqual([isAttentionCaseKind("pending"), isAttentionCaseKind("otra"), isAttentionCaseKind(null)], [true, false, false]);
});

console.log(`\nmetrics/attention-cases: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
