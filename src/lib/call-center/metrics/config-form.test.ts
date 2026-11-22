/**
 * Ayudas del formulario de configuración. PURO, horarios inventados.
 *
 *   npx tsx src/lib/call-center/metrics/config-form.test.ts
 */
import assert from "node:assert/strict";
import {
  emptyScheduleText, formatDayRanges, isValidDayISO, parseDayRanges, proposeAccount, scheduleToText, textToSchedule,
} from "./config-form";
import { parseConfigData } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const ranges = (t: string) => {
  const r = parseDayRanges(t);
  return r.ok ? r.ranges : null;
};

test("una franja, dos franjas y día vacío", () => {
  assert.deepEqual(ranges("10:00-18:00"), [{ from: "10:00", to: "18:00" }]);
  assert.deepEqual(ranges("09:00-12:00, 15:00-19:30"), [{ from: "09:00", to: "12:00" }, { from: "15:00", to: "19:30" }]);
  assert.deepEqual(ranges(""), []);
  assert.deepEqual(ranges("   "), []);
});

test("tolera hora de un dígito, espacios, 'a', raya larga y punto y coma", () => {
  assert.deepEqual(ranges("9:00 - 13:00"), [{ from: "09:00", to: "13:00" }]);
  assert.deepEqual(ranges("9:00 a 13:00; 16:00–20:30"), [{ from: "09:00", to: "13:00" }, { from: "16:00", to: "20:30" }]);
});

test("texto que no es una franja → error que nombra el pedazo", () => {
  for (const malo of ["mañana", "10-18", "10:00", "10:00-18:00 y 19:00-20:00", "10.00-18.00"]) {
    const r = parseDayRanges(malo);
    assert.equal(r.ok, false, malo);
  }
  const r = parseDayRanges("10:00-18:00, tarde");
  assert.ok(!r.ok && r.error.includes("tarde"));
});

test("ida y vuelta: texto → horario → texto", () => {
  const text = { ...emptyScheduleText(), "1": "10:00-18:00", "6": "09:00-12:00, 15:00-19:30" };
  const parsed = textToSchedule(text);
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.deepEqual(parsed.schedule["7"], []);
    assert.deepEqual(scheduleToText(parsed.schedule), text);
  }
  assert.equal(formatDayRanges([]), "");
});

test("un día mal escrito: se informa ese día y no se arma el horario", () => {
  const r = textToSchedule({ ...emptyScheduleText(), "2": "10:00-18:00", "3": "todo el día" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors), ["3"]);
});

test("lo que la forma del texto deja pasar lo frena el esquema: hora inexistente, franja invertida, superposición", () => {
  const cfg = (day1: string) => {
    const s = textToSchedule({ ...emptyScheduleText(), "1": day1 });
    assert.ok(s.ok);
    return parseConfigData({
      schemaVersion: 1, publicHours: s.ok ? s.schedule : null, operatorHours: s.ok ? s.schedule : null,
      firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [],
    });
  };
  assert.equal(cfg("10:00-18:00").ok, true);
  assert.equal(cfg("25:00-26:00").ok, false);
  assert.equal(cfg("18:00-10:00").ok, false);
  assert.equal(cfg("10:00-14:00, 13:00-18:00").ok, false);
});

test("propuesta de una cuenta nueva: activa si escribió hace poco, histórica si no", () => {
  const reciente = proposeAccount({ externalId: "9001", messagesLast30Days: 12, onlySeenAsAssignee: false });
  assert.deepEqual(reciente, { externalId: "9001", alias: null, active: true, borrowed: false, historical: false, system: false });
  const vieja = proposeAccount({ externalId: "9002", messagesLast30Days: 0, onlySeenAsAssignee: false });
  assert.deepEqual([vieja.active, vieja.historical, vieja.system], [false, true, false]);
});

test("propuesta de una cuenta vista solo como asignada: ni activa ni histórica, y sin marcar como sistema", () => {
  const asignada = proposeAccount({ externalId: "9003", messagesLast30Days: 0, onlySeenAsAssignee: true });
  assert.deepEqual([asignada.active, asignada.historical, asignada.system], [false, false, false]);
});

test("toda propuesta es una cuenta válida para el esquema", () => {
  const propuestas = [
    proposeAccount({ externalId: "9001", messagesLast30Days: 3, onlySeenAsAssignee: false }),
    proposeAccount({ externalId: "9002", messagesLast30Days: 0, onlySeenAsAssignee: false }),
    proposeAccount({ externalId: "9003", messagesLast30Days: 0, onlySeenAsAssignee: true }),
  ];
  const vacio = textToSchedule(emptyScheduleText());
  assert.ok(vacio.ok);
  const r = parseConfigData({
    schemaVersion: 1, publicHours: vacio.ok ? vacio.schedule : null, operatorHours: vacio.ok ? vacio.schedule : null,
    firstResponseGoalMinutes: 15, accounts: propuestas, callCenterVendors: [],
  });
  assert.equal(r.ok, true);
});

test("fecha de vigencia: formato y fecha real", () => {
  assert.equal(isValidDayISO("2026-03-01"), true);
  assert.equal(isValidDayISO("2024-02-29"), true);
  for (const mala of ["2026-02-30", "2026-13-01", "01/03/2026", "2026-3-1", "", null, undefined, 20260301]) {
    assert.equal(isValidDayISO(mala), false, String(mala));
  }
});

console.log(`\nmetrics/config-form: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
