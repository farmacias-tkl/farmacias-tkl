/**
 * Semáforo de espera. PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/wait-level.test.ts
 *
 * Horario de prueba: público lunes a viernes 09–19; operadores lunes a viernes 08–20.
 */
import assert from "node:assert/strict";
import { classifyWait, scheduleState, waitClockStart, waitLevel, type WaitContext } from "./wait-level";
import { isoWeekdayOf, type DayRanges } from "./business-time";
import { criticalWaitMinutesOf } from "./config-schema";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const weekdays = (from: number, to: number): DayRanges => (day) => (Number(isoWeekdayOf(day)) <= 5 ? [{ from: from * 60, to: to * 60 }] : []);
const ctx: WaitContext = { pub: weekdays(9, 19), ops: weekdays(8, 20), goalMinutes: 15, criticalMinutes: 60 };
// 2026-03-10 es martes.
const never = (waitStart: string, botExit: string | null = waitStart) => ({ hasHumanResponse: false, botExitAt: botExit ? at(botExit) : null, waitStart: at(waitStart) });
const next = (waitStart: string) => ({ hasHumanResponse: true, botExitAt: at("2026-03-09T10:00"), waitStart: at(waitStart) });

test("umbrales: hasta la meta en plazo, hasta la crítica demorado, más allá crítico", () => {
  const now = at("2026-03-10T12:00");
  assert.deepEqual(classifyWait(never("2026-03-10T11:45"), now, ctx), { level: "EN_PLAZO", businessMinutes: 15 });
  assert.deepEqual(classifyWait(never("2026-03-10T11:44"), now, ctx), { level: "DEMORADO", businessMinutes: 16 });
  assert.deepEqual(classifyWait(never("2026-03-10T11:00"), now, ctx), { level: "DEMORADO", businessMinutes: 60 });
  assert.deepEqual(classifyWait(never("2026-03-10T10:59"), now, ctx), { level: "CRITICO", businessMinutes: 61 });
});

test("fuera del horario público con cero minutos hábiles: nunca en plazo", () => {
  // Entró a las 21:00 del martes; son las 22:00.
  assert.deepEqual(classifyWait(never("2026-03-10T21:00"), at("2026-03-10T22:00"), ctx), { level: "FUERA_HORARIO", businessMinutes: 0 });
  // Fin de semana.
  assert.equal(classifyWait(never("2026-03-14T10:00"), at("2026-03-14T18:00"), ctx).level, "FUERA_HORARIO");
});

test("fuera del horario: el reloj se pausa, pero la demora acumulada no se borra", () => {
  const now = at("2026-03-10T21:00");
  assert.deepEqual(classifyWait(never("2026-03-10T18:50"), now, ctx), { level: "FUERA_HORARIO", businessMinutes: 10 });
  assert.deepEqual(classifyWait(never("2026-03-10T18:30"), now, ctx), { level: "DEMORADO", businessMinutes: 30 });
  assert.deepEqual(classifyWait(never("2026-03-10T15:00"), now, ctx), { level: "CRITICO", businessMinutes: 240 });
});

test("al abrir el día siguiente el reloj sigue donde quedó", () => {
  // 10 minutos el martes antes de cerrar + 10 el miércoles desde las 09:00.
  assert.deepEqual(classifyWait(never("2026-03-10T18:50"), at("2026-03-11T09:10"), ctx), { level: "DEMORADO", businessMinutes: 20 });
});

test("sin primera respuesta el reloj corre desde la salida del bot; sin registro, desde el mensaje", () => {
  assert.equal(waitClockStart(never("2026-03-10T10:00", "2026-03-10T10:30")).getTime(), at("2026-03-10T10:30").getTime());
  assert.equal(waitClockStart(never("2026-03-10T10:00", null)).getTime(), at("2026-03-10T10:00").getTime());
  assert.equal(classifyWait(never("2026-03-10T10:00", "2026-03-10T11:50"), at("2026-03-10T12:00"), ctx).level, "EN_PLAZO");
});

test("esperando nueva respuesta: desde el inicio del bloque sin responder, no desde la salida del bot", () => {
  assert.deepEqual(classifyWait(next("2026-03-10T11:50"), at("2026-03-10T12:00"), ctx), { level: "EN_PLAZO", businessMinutes: 10 });
});

test("estado del horario: público, turno de operadores fuera del público, y cerrado", () => {
  assert.deepEqual(scheduleState(at("2026-03-10T12:00"), ctx), { inPublicHours: true, operatorShiftActive: false });
  assert.deepEqual(scheduleState(at("2026-03-10T19:30"), ctx), { inPublicHours: false, operatorShiftActive: true });
  assert.deepEqual(scheduleState(at("2026-03-10T22:00"), ctx), { inPublicHours: false, operatorShiftActive: false });
});

test("demora crítica de la configuración: valor por defecto 60 y nunca por debajo de la meta", () => {
  assert.equal(criticalWaitMinutesOf({ firstResponseGoalMinutes: 15 }), 60);
  assert.equal(criticalWaitMinutesOf({ firstResponseGoalMinutes: 15, criticalWaitMinutes: 45 }), 45);
  assert.equal(criticalWaitMinutesOf({ firstResponseGoalMinutes: 90 }), 91);
  assert.equal(waitLevel(16, true, { goalMinutes: 15, criticalMinutes: 45 }), "DEMORADO");
});

console.log(`\nmetrics/wait-level: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
