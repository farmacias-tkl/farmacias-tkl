/**
 * Tiempo hábil del Call Center. PURO. Horarios y fechas de prueba inventados.
 *
 *   npx tsx src/lib/call-center/metrics/business-time.test.ts
 *
 * Los instantes se escriben con desplazamiento -03:00 para leerlos en hora de Buenos Aires.
 * Calendario usado: lunes 02/03/2026 a domingo 08/03/2026.
 */
import assert from "node:assert/strict";
import {
  addBusinessMinutes, arDayISO, arDayStartUTC, arHour, arMinuteOfDay, businessMinutesBetween,
  classifyAgainstGoal, dayRangesFromConfig, isoWeekdayOf, isWithinHours, nextDayISO,
  type DayRanges, type MinuteRange,
} from "./business-time";
import type { ConfigVersion } from "./config";
import type { CallCenterMetricsConfigData, WeekSchedule } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`); // "2026-03-02T10:00"

// Horario de prueba: lunes a viernes 10–18, sábado 09–12, domingo cerrado.
const WEEK: MinuteRange[] = [{ from: 600, to: 1080 }];
const SAT: MinuteRange[] = [{ from: 540, to: 720 }];
const ranges: DayRanges = (day) => {
  const wd = isoWeekdayOf(day);
  return wd === "7" ? [] : wd === "6" ? SAT : WEEK;
};
const bm = (a: string, b: string, r: DayRanges = ranges) => businessMinutesBetween(at(a), at(b), r);

test("día y hora de Buenos Aires: la madrugada UTC sigue siendo el día anterior", () => {
  const instant = new Date("2026-03-03T02:30:00.000Z"); // lunes 23:30 en Buenos Aires
  assert.equal(arDayISO(instant), "2026-03-02");
  assert.equal(arHour(instant), 23);
  assert.equal(arMinuteOfDay(instant), 23 * 60 + 30);
  assert.equal(arDayStartUTC("2026-03-02").toISOString(), "2026-03-02T03:00:00.000Z");
});

test("día de la semana ISO y día siguiente (incluye cambio de mes y de año)", () => {
  assert.equal(isoWeekdayOf("2026-03-02"), "1");
  assert.equal(isoWeekdayOf("2026-03-07"), "6");
  assert.equal(isoWeekdayOf("2026-03-08"), "7");
  assert.equal(nextDayISO("2026-03-31"), "2026-04-01");
  assert.equal(nextDayISO("2026-12-31"), "2027-01-01");
});

test("dentro del horario: minutos de reloj", () => {
  assert.equal(bm("2026-03-02T10:00", "2026-03-02T10:15"), 15);
  assert.equal(bm("2026-03-02T11:20", "2026-03-02T13:05"), 105);
});

test("entra antes de abrir: empieza a contar al abrir", () => {
  assert.equal(bm("2026-03-02T07:00", "2026-03-02T10:10"), 10);
});

test("respondida antes de abrir: 0", () => {
  assert.equal(bm("2026-03-02T07:00", "2026-03-02T09:59"), 0);
  assert.equal(bm("2026-03-02T19:00", "2026-03-02T23:00"), 0);
});

test("entra después de cerrar: cuenta desde la apertura del día siguiente", () => {
  assert.equal(bm("2026-03-02T19:30", "2026-03-03T10:20"), 20);
});

test("cruza el cierre: suma el resto del día y lo del siguiente", () => {
  assert.equal(bm("2026-03-02T17:50", "2026-03-03T10:05"), 15);
});

test("viernes a la tarde → sábado y lunes; el domingo no suma", () => {
  assert.equal(bm("2026-03-06T17:30", "2026-03-07T09:10"), 40); // 30 del viernes + 10 del sábado
  assert.equal(bm("2026-03-07T11:50", "2026-03-09T10:05"), 15); // 10 del sábado + 5 del lunes
  assert.equal(bm("2026-03-08T08:00", "2026-03-08T22:00"), 0);  // domingo entero
});

test("varios días completos", () => {
  assert.equal(bm("2026-03-02T10:00", "2026-03-04T18:00"), 3 * 480);
});

test("fin anterior o igual al inicio: 0", () => {
  assert.equal(bm("2026-03-02T12:00", "2026-03-02T12:00"), 0);
  assert.equal(bm("2026-03-02T12:00", "2026-03-02T11:00"), 0);
});

test("día con dos franjas: no cuenta el corte del mediodía", () => {
  const split: DayRanges = () => [{ from: 480, to: 780 }, { from: 960, to: 1230 }]; // 08–13 y 16–20:30
  assert.equal(bm("2026-03-07T12:30", "2026-03-07T16:20", split), 50);
});

test("segundos: no redondea", () => {
  const a = new Date("2026-03-02T10:00:00.000-03:00");
  const b = new Date("2026-03-02T10:14:30.000-03:00");
  assert.equal(businessMinutesBetween(a, b, ranges), 14.5);
});

test("isWithinHours: el inicio entra, el fin no", () => {
  assert.equal(isWithinHours(at("2026-03-02T10:00"), ranges), true);
  assert.equal(isWithinHours(at("2026-03-02T17:59"), ranges), true);
  assert.equal(isWithinHours(at("2026-03-02T18:00"), ranges), false);
  assert.equal(isWithinHours(at("2026-03-08T11:00"), ranges), false);
});

test("addBusinessMinutes: vencimiento dentro del día, al día siguiente y tras el domingo", () => {
  assert.equal(addBusinessMinutes(at("2026-03-02T10:00"), 15, ranges)?.toISOString(), at("2026-03-02T10:15").toISOString());
  assert.equal(addBusinessMinutes(at("2026-03-02T17:50"), 15, ranges)?.toISOString(), at("2026-03-03T10:05").toISOString());
  assert.equal(addBusinessMinutes(at("2026-03-07T11:50"), 15, ranges)?.toISOString(), at("2026-03-09T10:05").toISOString());
  assert.equal(addBusinessMinutes(at("2026-03-02T21:00"), 15, ranges)?.toISOString(), at("2026-03-03T10:15").toISOString());
  assert.equal(addBusinessMinutes(at("2026-03-02T10:00"), 15, () => []), null); // sin horario
});

// ── Meta ─────────────────────────────────────────────────────────────────────────────
test("meta: respondida justo en el límite cumple; un minuto después, no", () => {
  const start = at("2026-03-02T10:00");
  const now = at("2026-03-05T12:00");
  assert.equal(classifyAgainstGoal(start, at("2026-03-02T10:15"), now, 15, ranges).group, "ANSWERED_WITHIN_GOAL");
  assert.equal(classifyAgainstGoal(start, at("2026-03-02T10:16"), now, 15, ranges).group, "ANSWERED_LATE");
});

test("meta: entró de noche y se respondió a los 10 minutos de abrir → cumple", () => {
  const r = classifyAgainstGoal(at("2026-03-02T22:00"), at("2026-03-03T10:10"), at("2026-03-03T12:00"), 15, ranges);
  assert.equal(r.group, "ANSWERED_WITHIN_GOAL");
  assert.equal(r.businessMinutes, 10);
});

test("meta: respondida antes de abrir → cumple con 0 minutos hábiles", () => {
  const r = classifyAgainstGoal(at("2026-03-02T22:00"), at("2026-03-03T08:30"), at("2026-03-03T12:00"), 15, ranges);
  assert.equal(r.group, "ANSWERED_WITHIN_GOAL");
  assert.equal(r.businessMinutes, 0);
});

test("meta: pendiente que entró fuera de horario todavía no venció", () => {
  const r = classifyAgainstGoal(at("2026-03-02T22:00"), null, at("2026-03-03T09:00"), 15, ranges);
  assert.equal(r.group, "PENDING_WITHIN_GOAL");
  assert.equal(r.businessMinutes, 0);
});

test("meta: pendiente dentro del plazo y pendiente vencido", () => {
  const start = at("2026-03-02T10:00");
  assert.equal(classifyAgainstGoal(start, null, at("2026-03-02T10:15"), 15, ranges).group, "PENDING_WITHIN_GOAL");
  assert.equal(classifyAgainstGoal(start, null, at("2026-03-02T10:16"), 15, ranges).group, "PENDING_OVERDUE");
});

// ── Horario desde la configuración: vigencia y feriados ───────────────────────────────
const sched = (from: string, to: string): WeekSchedule => {
  const d = [{ from, to }];
  return { "1": d, "2": d, "3": d, "4": d, "5": d, "6": [], "7": [] };
};
const cfg = (pub: WeekSchedule): CallCenterMetricsConfigData => ({
  schemaVersion: 1, publicHours: pub, operatorHours: sched("08:00", "20:00"),
  firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [],
});
const versions: ConfigVersion[] = [
  { id: "v1", validFrom: "2026-03-02", createdAt: new Date("2026-03-01T00:00:00Z"), data: cfg(sched("10:00", "18:00")) },
  { id: "v2", validFrom: "2026-03-04", createdAt: new Date("2026-03-03T00:00:00Z"), data: cfg(sched("09:00", "19:00")) },
];
const noHolidays = () => false;

test("configuración: cada día usa el horario vigente ese día", () => {
  const r = dayRangesFromConfig(versions, (d) => d.publicHours, noHolidays);
  assert.deepEqual(r("2026-03-03"), [{ from: 600, to: 1080 }]);
  assert.deepEqual(r("2026-03-04"), [{ from: 540, to: 1140 }]);
  // Entra el martes a las 17:50 (horario viejo) y se responde el miércoles 09:05 (horario nuevo).
  assert.equal(bm("2026-03-03T17:50", "2026-03-04T09:05", r), 15);
});

test("configuración: antes de la primera versión no hay horario", () => {
  const r = dayRangesFromConfig(versions, (d) => d.publicHours, noHolidays);
  assert.deepEqual(r("2026-03-01"), []);
  assert.equal(bm("2026-02-25T10:00", "2026-02-25T18:00", r), 0);
});

test("configuración: un feriado no suma minutos y corre el vencimiento", () => {
  const r = dayRangesFromConfig(versions, (d) => d.publicHours, (day) => day === "2026-03-05");
  assert.deepEqual(r("2026-03-05"), []);
  assert.equal(bm("2026-03-04T18:50", "2026-03-06T09:05", r), 15); // 10 del miércoles + 5 del viernes
  assert.equal(addBusinessMinutes(at("2026-03-04T18:50"), 15, r)?.toISOString(), at("2026-03-06T09:05").toISOString());
});

test("configuración: se puede elegir el horario de operadores", () => {
  const r = dayRangesFromConfig(versions, (d) => d.operatorHours, noHolidays);
  assert.deepEqual(r("2026-03-04"), [{ from: 480, to: 1200 }]);
  assert.equal(isWithinHours(at("2026-03-04T19:30"), r), true);
});

console.log(`\nmetrics/business-time: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
