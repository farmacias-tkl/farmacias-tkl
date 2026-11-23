/**
 * Atención y demoras: resumen a partir de filas ya leídas. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/attention.test.ts
 *
 * Calendario: lunes 02/03/2026 a domingo 08/03/2026. Horario público de prueba: lunes a
 * viernes 10–18, sábado 09–12. Meta de prueba: 15 minutos hábiles.
 */
import assert from "node:assert/strict";
import { buildAttentionReport, distribution, percentile, publicCloseOf, type EntryRow } from "./attention";
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

const wk = [{ from: "10:00", to: "18:00" }];
const PUBLIC: WeekSchedule = { "1": wk, "2": wk, "3": wk, "4": wk, "5": wk, "6": [{ from: "09:00", to: "12:00" }], "7": [] };
const versions: ConfigVersion[] = [{
  id: "v1", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"),
  data: { schemaVersion: 1, publicHours: PUBLIC, operatorHours: PUBLIC, firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [] },
}];

let n = 0;
/** Conversación creada en `created`; sale del bot a los 2 minutos salvo que se indique. */
function row(created: string, over: Partial<EntryRow> & { answered?: string | null; exit?: string | null } = {}): EntryRow {
  const createdAt = at(created);
  const { answered, exit, ...rest } = over;
  return {
    conversationId: `c${++n}`,
    createdAt,
    firstCustomerAt: createdAt,
    botExitAt: exit === null ? null : exit ? at(exit) : new Date(createdAt.getTime() + 2 * 60_000),
    botOrderCompleteAt: null,
    firstHumanAt: answered ? at(answered) : null,
    firstHumanAccount: answered ? "9001" : null,
    orderFlow: false,
    firstCustomerMessageIsMeducar: false,
    customerChars: 200,
    customerSentMedia: false,
    customerSentLink: false,
    previousResolvedRecently: false,
    ...rest,
  };
}
const report = (rows: EntryRow[], now: string, v: ConfigVersion[] = versions) =>
  buildAttentionReport(rows, { now: at(now), from: "2026-03-02", to: "2026-03-08", versions: v });

test("percentil: interpolación lineal, un solo valor y lista vacía", () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.9), 46);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(distribution([]), { n: 0, median: null, p90: null });
});

test("medianas solo entre respondidas; los pendientes van aparte con su antigüedad", () => {
  const r = report([
    row("2026-03-02T10:00", { answered: "2026-03-02T10:12" }), // 10 min desde la salida del bot
    row("2026-03-02T11:00", { answered: "2026-03-02T11:32" }), // 30 min
    row("2026-03-02T12:00"),                                    // pendiente
  ], "2026-03-02T14:02");
  assert.equal(r.total.entries, 3);
  assert.equal(r.total.answered, 2);
  assert.equal(r.total.firstResponseClock.n, 2);
  assert.equal(r.total.firstResponseClock.median, 20);
  assert.equal(r.total.pending.total, 1);
  assert.equal(r.total.pending.medianAgeMinutes, 120);
  assert.equal(r.total.pending.oldestClockStart?.toISOString(), at("2026-03-02T12:02").toISOString());
});

test("la espera desde el primer mensaje del cliente incluye el tiempo en el bot", () => {
  const r = report([row("2026-03-02T10:00", { exit: "2026-03-02T10:11", answered: "2026-03-02T10:20" })], "2026-03-02T15:00");
  assert.equal(r.total.firstResponseClock.median, 9);
  assert.equal(r.total.fromFirstMessage.median, 20);
});

test("meta: los cuatro grupos y el cumplimiento", () => {
  const r = report([
    row("2026-03-02T10:00", { answered: "2026-03-02T10:10" }), // dentro (8 min hábiles)
    row("2026-03-02T10:00", { answered: "2026-03-02T11:00" }), // fuera
    row("2026-03-02T10:00"),                                    // pendiente vencido
    row("2026-03-02T13:50"),                                    // pendiente en plazo (8 min al corte)
  ], "2026-03-02T14:00");
  const g = r.total.goal!;
  assert.equal(g.goalMinutes, 15);
  assert.deepEqual([g.answeredWithin, g.answeredLate, g.pendingOverdue, g.pendingWithin], [1, 1, 1, 1]);
  assert.equal(g.compliance, 1 / 3); // el pendiente en plazo todavía no entra en el denominador
});

test("meta: entró de noche; respondida a los 10 minutos de abrir cumple; la respondida antes de abrir queda fuera de la meta", () => {
  const r = report([
    row("2026-03-02T22:00", { answered: "2026-03-03T10:10" }),
    row("2026-03-02T22:00", { answered: "2026-03-03T08:30" }),
  ], "2026-03-03T12:00");
  const g = r.total.goal!;
  assert.equal(g.answeredWithin, 1);
  assert.equal(r.total.outsidePublicHours.answered, 1);
  assert.equal(r.total.firstResponseBusiness?.median, 10);
  assert.ok((r.total.firstResponseClock.median ?? 0) > 600); // en reloj son más de 10 horas
});

test("candidatos a agradecimiento: vencidos en el cumplimiento principal; al lado, la cifra sin ellos", () => {
  const r = report([
    row("2026-03-02T10:00", { answered: "2026-03-02T10:10" }),
    row("2026-03-02T10:00", { previousResolvedRecently: true, customerChars: 8 }), // candidato, pendiente
    row("2026-03-02T10:00"),                                                       // pendiente común
  ], "2026-03-02T16:00");
  const g = r.total.goal!;
  assert.equal(g.pendingOverdue, 2);
  assert.equal(g.thanksCandidatesOverdue, 1);
  assert.equal(g.compliance, 1 / 3);
  assert.equal(g.complianceExcludingThanks, 1 / 2);
  assert.equal(r.total.pending.thanksCandidates, 1);
  assert.equal(r.total.pending.total, 2); // no se restan de los pendientes
});

test("sin salida del bot registrada: el reloj corre desde la creación", () => {
  const r = report([row("2026-03-02T10:00", { exit: null, answered: "2026-03-02T10:14" })], "2026-03-02T15:00");
  assert.equal(r.total.byBotExitPath.SIN_REGISTRO.conversations, 1);
  assert.equal(r.total.firstResponseClock.median, 14);
  assert.equal(r.total.goal!.answeredWithin, 1);
});

test("vía de salida del bot y tiempo en el bot por vía", () => {
  const done = at("2026-03-02T10:02");
  const r = report([
    row("2026-03-02T10:00", { botOrderCompleteAt: done, answered: "2026-03-02T10:30" }),
    row("2026-03-02T10:00", { exit: "2026-03-02T10:11" }),
  ], "2026-03-02T15:00");
  assert.equal(r.total.byBotExitPath.PEDIDO_COMPLETO.conversations, 1);
  assert.equal(r.total.byBotExitPath.PEDIDO_COMPLETO.botTime.median, 2);
  assert.equal(r.total.byBotExitPath.PEDIDO_COMPLETO.answered, 1);
  assert.equal(r.total.byBotExitPath.SIN_MENSAJE_FINAL.botTime.median, 11);
});

test("sin respuesta el día de entrada: total, dentro del horario público y con pedido completo", () => {
  const r = report([
    row("2026-03-02T11:00", { answered: "2026-03-02T17:00" }),                                        // respondida en el día
    row("2026-03-02T11:00", { answered: "2026-03-03T10:30", botOrderCompleteAt: at("2026-03-02T11:02") }), // al día siguiente, pedido completo
    row("2026-03-02T21:00", { answered: "2026-03-03T10:05" }),                                        // entró fuera de horario
    row("2026-03-02T12:00"),                                                                           // nunca
  ], "2026-03-04T12:00");
  const day = r.days.find((d) => d.day === "2026-03-02")!;
  assert.equal(day.unansweredSameDay.total, 3);
  assert.equal(day.unansweredSameDay.enteredInPublicHours, 2);
  assert.equal(day.unansweredSameDay.completedOrders, 1);
});

test("pedidos desde las 17:00 respondidos en el día: solo pedidos y Meducar", () => {
  const r = report([
    row("2026-03-02T17:10", { orderFlow: true, answered: "2026-03-02T17:40" }),
    row("2026-03-02T18:30", { orderFlow: true, answered: "2026-03-03T10:10" }),
    row("2026-03-02T17:30", { firstCustomerMessageIsMeducar: true, answered: "2026-03-02T19:00" }),
    row("2026-03-02T17:30", { answered: "2026-03-02T17:35" }), // "otros": no cuenta
    row("2026-03-02T16:59", { orderFlow: true }),              // antes de las 17
  ], "2026-03-04T12:00");
  assert.deepEqual(r.total.lateOrders, { total: 3, answeredSameDay: 2 });
  assert.deepEqual(r.total.byManagementType, { MEDUCAR: 1, PEDIDO: 3, OTROS: 1 });
});

test("pendientes al cierre: salieron del bot dentro del horario y a las 18:00 no tenían respuesta", () => {
  const r = report([
    row("2026-03-02T11:00", { answered: "2026-03-02T12:00" }),
    row("2026-03-02T17:00", { answered: "2026-03-02T19:30" }), // respondida después del cierre
    row("2026-03-02T17:30"),                                   // nunca
    row("2026-03-02T19:00", { answered: "2026-03-02T19:10" }), // salió del bot fuera de horario: no entra
  ], "2026-03-03T09:00");
  const day = r.days.find((d) => d.day === "2026-03-02")!;
  assert.deepEqual(day.pendingAtClose, { leftBotInHours: 3, pending: 2 });
  assert.equal(publicCloseOf("2026-03-02", publicHours(versions))?.toISOString(), at("2026-03-02T18:00").toISOString());
});

test("pendientes al cierre: null si el horario del día todavía no cerró o ese día no hay atención", () => {
  const abierto = report([row("2026-03-02T11:00")], "2026-03-02T15:00");
  assert.equal(abierto.days[0].pendingAtClose, null);
  assert.equal(abierto.days[0].inProgress, true);
  const domingo = report([row("2026-03-08T11:00")], "2026-03-09T12:00");
  assert.equal(domingo.days[0].pendingAtClose, null);
  assert.equal(domingo.days[0].inProgress, false);
});

test("sin configuración vigente: reloj sí, meta y tiempo hábil no disponibles (no cero)", () => {
  const r = report([row("2026-03-02T10:00", { answered: "2026-03-02T10:30" }), row("2026-03-02T11:00")], "2026-03-02T15:00", []);
  assert.equal(r.hasConfig, false);
  assert.equal(r.total.goal, null);
  assert.equal(r.total.firstResponseBusiness, null);
  assert.equal(r.total.withoutConfig, 2);
  assert.equal(r.total.firstResponseClock.median, 28);
  assert.equal(r.total.unansweredSameDay.enteredInPublicHours, null);
  assert.equal(r.days[0].pendingAtClose, null);
});

test("por día: se agrupa por día de Buenos Aires de la creación, con entradas por hora", () => {
  const r = report([
    row("2026-03-02T23:30"), // 02:30 UTC del día 3: sigue siendo lunes 2 en Buenos Aires
    row("2026-03-03T00:10"),
    row("2026-03-03T16:45"),
  ], "2026-03-04T12:00");
  assert.deepEqual(r.days.map((d) => [d.day, d.entries]), [["2026-03-02", 1], ["2026-03-03", 2]]);
  const d3 = r.days[1];
  assert.equal(d3.byHour[0], 1);
  assert.equal(d3.byHour[16], 1);
  assert.equal(d3.byHour.reduce((a, b) => a + b, 0), 2);
});

test("período sin conversaciones: ceros en los conteos y null en las medianas", () => {
  const r = report([], "2026-03-04T12:00");
  assert.equal(r.total.entries, 0);
  assert.equal(r.total.firstResponseClock.median, null);
  assert.equal(r.total.goal, null);
  assert.deepEqual(r.days, []);
});

// ── Respondidas fuera del horario público ──────────────────────────────────────────────────────────

test("domingo: respondida el mismo día no cuenta como cumplida con cero minutos; se informa aparte con su espera real", () => {
  const r = report([row("2026-03-08T16:00", { answered: "2026-03-08T16:42" })], "2026-03-08T20:00");
  const t = r.total;
  assert.deepEqual([t.entries, t.answered], [1, 1]);
  assert.equal(t.goal, null, "sin conversaciones evaluables no hay cumplimiento, ni 100 %");
  assert.equal(t.firstResponseBusiness, null, "tampoco una mediana hábil de cero");
  assert.deepEqual([t.outsidePublicHours.answered, t.outsidePublicHours.clock.median], [1, 40]);
  assert.equal(t.withoutConfig, 0, "no es falta de configuración");
  assert.equal(r.hasConfig, true);
});

test("domingo sin respuesta que sigue al lunes: entra en la meta y el reloj corre desde que abre", () => {
  const rows = [row("2026-03-01T16:00"), row("2026-03-01T17:00", { answered: "2026-03-02T10:10" }), row("2026-03-01T18:00", { answered: "2026-03-02T11:00" })];
  // Lunes 10:30: el horario público abrió a las 10:00.
  const t = buildAttentionReport(rows, { now: at("2026-03-02T11:30"), from: "2026-03-01", to: "2026-03-02", versions }).total;
  assert.equal(t.outsidePublicHours.answered, 0);
  assert.deepEqual([t.goal!.answeredWithin, t.goal!.answeredLate, t.goal!.pendingOverdue], [1, 1, 1]);
  // 10 y 60 minutos hábiles desde las 10:00 del lunes.
  assert.deepEqual([t.firstResponseBusiness!.n, t.firstResponseBusiness!.median], [2, 35]);
});

test("domingo todavía sin respuesta, el mismo domingo: pendiente en plazo, no vencido ni cumplido", () => {
  const t = report([row("2026-03-08T16:00")], "2026-03-08T20:00").total;
  assert.deepEqual([t.goal!.pendingWithin, t.goal!.pendingOverdue, t.goal!.compliance, t.outsidePublicHours.answered], [1, 0, null, 0]);
});

test("feriado: igual que un domingo", () => {
  // 23/11/2026 es feriado y cae lunes: sin horario público aunque el horario semanal lo tenga.
  const rows = [row("2026-11-23T11:00", { answered: "2026-11-23T11:30" }), row("2026-11-24T11:00", { answered: "2026-11-24T11:05" })];
  const r = buildAttentionReport(rows, { now: at("2026-11-24T18:00"), from: "2026-11-23", to: "2026-11-24", versions });
  assert.deepEqual([r.total.outsidePublicHours.answered, r.total.outsidePublicHours.clock.median], [1, 28]);
  assert.deepEqual([r.total.goal!.answeredWithin, r.total.goal!.compliance], [1, 1]);
  const feriado = r.days.find((d) => d.day === "2026-11-23")!;
  assert.deepEqual([feriado.goal, feriado.outsidePublicHours.answered], [null, 1]);
});

test("sábado a la tarde: salió del bot después del cierre y se respondió esa tarde; fuera de la meta, con su espera real", () => {
  // El sábado 07/03 el horario público de prueba cierra a las 12:00.
  const t = report([row("2026-03-07T16:00", { answered: "2026-03-07T16:32" })], "2026-03-07T20:00").total;
  assert.equal(t.goal, null, "no cuenta como cumplida con cero minutos");
  assert.deepEqual([t.outsidePublicHours.answered, t.outsidePublicHours.clock.median, t.withoutConfig], [1, 30, 0]);
});

test("noche de día hábil respondida antes de abrir: fuera de la meta", () => {
  const rows = [row("2026-03-03T20:00", { answered: "2026-03-03T20:45" }), row("2026-03-03T22:00", { answered: "2026-03-04T08:30" })];
  const t = report(rows, "2026-03-04T12:00").total;
  assert.equal(t.goal, null);
  assert.deepEqual([t.outsidePublicHours.answered, t.firstResponseBusiness, t.answered], [2, null, 2]);
});

test("noche respondida después de abrir: sigue en la meta y el reloj corre desde la apertura", () => {
  const rows = [row("2026-03-03T22:00", { answered: "2026-03-04T10:10" }), row("2026-03-03T22:00", { answered: "2026-03-04T11:00" })];
  const t = report(rows, "2026-03-04T12:00").total;
  assert.equal(t.outsidePublicHours.answered, 0);
  assert.deepEqual([t.goal!.answeredWithin, t.goal!.answeredLate], [1, 1]);
  // 10 y 60 minutos hábiles desde las 10:00, no las 12 horas de reloj.
  assert.deepEqual([t.firstResponseBusiness!.n, t.firstResponseBusiness!.median], [2, 35]);
});

test("salió del bot dentro del horario público y se respondió después del cierre: sigue en la meta", () => {
  // Sale 17:52 (creada 17:50), cierra 18:00, responde 18:30: 8 minutos hábiles.
  const t = report([row("2026-03-03T17:50", { answered: "2026-03-03T18:30" })], "2026-03-03T20:00").total;
  assert.deepEqual([t.goal!.answeredWithin, t.outsidePublicHours.answered, t.firstResponseBusiness!.median], [1, 0, 8]);
});

test("fuera del horario público y todavía sin respuesta: pendiente en plazo hasta que abra", () => {
  const t = report([row("2026-03-07T16:00")], "2026-03-07T20:00").total;
  assert.deepEqual([t.goal!.pendingWithin, t.goal!.pendingOverdue, t.outsidePublicHours.answered], [1, 0, 0]);
});

test("semana con domingo: el cumplimiento se calcula sin las respondidas del domingo", () => {
  const rows = [
    row("2026-03-03T11:00", { answered: "2026-03-03T11:10" }),
    row("2026-03-03T11:00", { answered: "2026-03-03T13:00" }),
    row("2026-03-08T16:00", { answered: "2026-03-08T16:05" }),
    row("2026-03-08T17:00", { answered: "2026-03-08T19:00" }),
  ];
  const t = report(rows, "2026-03-08T21:00").total;
  assert.equal(t.goal!.compliance, 0.5, "1 de 2, no 3 de 4");
  assert.deepEqual([t.outsidePublicHours.answered, t.firstResponseBusiness!.n, t.answered], [2, 2, 4]);
});

console.log(`\nmetrics/attention: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
