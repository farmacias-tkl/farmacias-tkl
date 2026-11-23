/**
 * "Avances". PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/progress.test.ts
 *
 * Horario de prueba: operadores lunes a viernes 08–20; público lunes a viernes 09–19.
 */
import assert from "node:assert/strict";
import { buildShiftProgress, cutEntryRowsAt, progressSide, shiftStartOf, type ShiftRow, countWindowClosures } from "./progress";
import { isoWeekdayOf, type DayRanges } from "./business-time";
import type { EntryRow } from "./attention";
import type { ConfigVersion } from "./config";
import type { WeekSchedule } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const ops: DayRanges = (day) => (Number(isoWeekdayOf(day)) <= 5 ? [{ from: 8 * 60, to: 20 * 60 }] : []);
const week = (from: string, to: string): WeekSchedule => {
  const d = [{ from, to }];
  return { "1": d, "2": d, "3": d, "4": d, "5": d, "6": [], "7": [] };
};
const versions: ConfigVersion[] = [{
  id: "v1", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"),
  data: { schemaVersion: 1, publicHours: week("09:00", "19:00"), operatorHours: week("08:00", "20:00"), firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [] },
}];
// 2026-03-10 es martes; 2026-03-14, sábado.
const START = at("2026-03-10T08:00");
const shift = (waitStart: string, over: Partial<ShiftRow> = {}): ShiftRow => ({ waitStart: at(waitStart), statusAtStart: "SIN_ASIGNAR", attendedSince: false, ...over });
let n = 0;
const entry = (created: string, answered: string | null): EntryRow => ({
  conversationId: `e${++n}`, createdAt: at(created), firstCustomerAt: at(created), botExitAt: at(created), botOrderCompleteAt: null,
  firstHumanAt: answered ? at(answered) : null, firstHumanAccount: answered ? "9001" : null, orderFlow: false,
  firstCustomerMessageIsMeducar: false, customerChars: 100, customerSentMedia: false, customerSentLink: false, previousResolvedRecently: false,
});

test("inicio del turno: primera franja de operadores de hoy; antes de que empiece o sin turno, no hay dato", () => {
  assert.equal(shiftStartOf(at("2026-03-10T12:00"), ops)?.getTime(), START.getTime());
  assert.equal(shiftStartOf(at("2026-03-10T08:00"), ops)?.getTime(), START.getTime());
  assert.equal(shiftStartOf(at("2026-03-10T07:59"), ops), null);
  assert.equal(shiftStartOf(at("2026-03-14T12:00"), ops), null);
});

test("pendientes al empezar: abiertas a esa hora y con hasta 72 horas de espera", () => {
  const r = buildShiftProgress([
    shift("2026-03-09T21:00"),
    shift("2026-03-09T18:00", { statusAtStart: null }),          // sin historial previo: estaba abierta
    shift("2026-03-09T19:00", { statusAtStart: "RESUELTA" }),    // cerrada a esa hora: no cuenta
    shift("2026-03-01T10:00"),                                   // más de 72 horas: es un caso antiguo
  ], START);
  assert.deepEqual(r, { startedAt: START.toISOString(), pendingAtStart: 2, attendedSince: 0 });
});

test("atrasados atendidos: solo entre los pendientes al empezar", () => {
  const r = buildShiftProgress([
    shift("2026-03-09T21:00", { attendedSince: true }),
    shift("2026-03-09T22:00"),
    shift("2026-03-01T10:00", { attendedSince: true }),          // antigua: fuera del grupo
    shift("2026-03-09T19:00", { statusAtStart: "RESUELTA", attendedSince: true }),
  ], START);
  assert.deepEqual([r.pendingAtStart, r.attendedSince], [2, 1]);
});

test("sin pendientes al empezar: cero de cero, con el turno ya empezado", () => {
  assert.deepEqual(buildShiftProgress([], START), { startedAt: START.toISOString(), pendingAtStart: 0, attendedSince: 0 });
});

test("corte a una hora: fuera lo creado después y sin las respuestas que todavía no habían llegado", () => {
  const rows = [entry("2026-03-03T10:00", "2026-03-03T10:05"), entry("2026-03-03T11:00", "2026-03-03T15:00"), entry("2026-03-03T13:00", "2026-03-03T13:05")];
  const cut = cutEntryRowsAt(rows, at("2026-03-03T12:00"));
  assert.equal(cut.length, 2);
  assert.deepEqual(cut.map((r) => r.firstHumanAt?.toISOString() ?? null), [at("2026-03-03T10:05").toISOString(), null]);
  assert.equal(cut[1].firstHumanAccount, null);
  assert.equal(rows[1].firstHumanAt !== null, true, "no modifica las filas originales");
});

test("mismo día de la semana anterior, cortado a la misma hora: no se beneficia de lo que pasó después", () => {
  const rows = [
    entry("2026-03-03T10:00", "2026-03-03T10:05"),   // dentro de la meta
    entry("2026-03-03T10:30", "2026-03-03T11:30"),   // tarde: 60 minutos hábiles
    entry("2026-03-03T11:00", "2026-03-03T15:00"),   // a las 12:00 seguía pendiente y vencida
    entry("2026-03-03T16:00", "2026-03-03T16:01"),   // entró después del corte
  ];
  const cortado = progressSide(rows, "2026-03-03", at("2026-03-03T12:00"), versions);
  assert.deepEqual([cortado.day, cortado.entries, cortado.medianBusinessMinutes], ["2026-03-03", 3, 32.5]);
  assert.deepEqual([cortado.hasPublicHours, cortado.answered, cortado.pending, cortado.medianClockMinutes], [true, 2, 1, 32.5]);
  assert.equal(Math.round(cortado.compliance! * 100), 33);
  // El día completo da otro número: por eso se corta.
  const completo = progressSide(rows, "2026-03-03", at("2026-03-04T12:00"), versions);
  assert.deepEqual([completo.entries, Math.round(completo.compliance! * 100)], [4, 50]);
});

test("día sin horario público: la meta no aplica; quedan respondidas, pendientes y la espera real", () => {
  // 2026-03-08 es domingo.
  const rows = [entry("2026-03-08T16:00", "2026-03-08T16:40"), entry("2026-03-08T17:00", "2026-03-08T17:20"), entry("2026-03-08T18:00", null)];
  const s = progressSide(rows, "2026-03-08", at("2026-03-08T19:00"), versions);
  assert.deepEqual([s.hasPublicHours, s.compliance, s.medianBusinessMinutes], [false, null, null]);
  assert.deepEqual([s.entries, s.answered, s.pending, s.medianClockMinutes], [3, 2, 1, 30]);
});

test("sin entradas o sin configuración vigente: sin dato, no cero", () => {
  const vacio = progressSide([], "2026-03-03", at("2026-03-03T12:00"), versions);
  assert.deepEqual([vacio.entries, vacio.compliance, vacio.medianBusinessMinutes], [0, null, null]);
  const sinConfig = progressSide([entry("2026-03-03T10:00", "2026-03-03T10:05")], "2026-03-03", at("2026-03-03T12:00"), []);
  assert.deepEqual([sinConfig.entries, sinConfig.compliance, sinConfig.medianBusinessMinutes, sinConfig.hasPublicHours], [1, null, null, null]);
});

test("ventanas de WhatsApp cerradas sin respuesta: por el momento del cierre, dentro del tramo del día", () => {
  const from = at("2026-03-10T00:00"), to = at("2026-03-10T15:00");
  const rows = [
    { lastCustomerAt: at("2026-03-09T10:00"), firstHumanAt: null },                      // cerró hoy 10:00, sin respuesta
    { lastCustomerAt: at("2026-03-09T11:00"), firstHumanAt: at("2026-03-10T12:00") },    // cerró hoy 11:00; la respuesta llegó después
    { lastCustomerAt: at("2026-03-09T11:00"), firstHumanAt: at("2026-03-10T09:00") },    // respondida antes del cierre
    { lastCustomerAt: at("2026-03-09T16:00"), firstHumanAt: null },                      // cierra hoy 16:00: todavía no
    { lastCustomerAt: at("2026-03-08T20:00"), firstHumanAt: null },                      // cerró ayer
  ];
  assert.equal(countWindowClosures(rows, from, to), 2);
  assert.equal(countWindowClosures(rows, from, at("2026-03-10T16:30")), 3);
  assert.equal(countWindowClosures([], from, to), 0);
});

console.log(`\nmetrics/progress: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
