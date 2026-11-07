/**
 * Tests PUROS de la vista Agenda.
 *
 *   npx tsx src/lib/vacations/agenda.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { buildAgendaWeek, weekRange } from "./agenda";
import { toLocalISODate } from "../dates/calendar";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const iso = toLocalISODate;
const ev = (id: string, name: string, startDate: string, endDate: string) =>
  ({ id, employeeNameSnapshot: name, status: "APPROVED", startDate, endDate });

// Miércoles 11/11/2026
const wed = new Date(2026, 10, 11, 15, 30);

const r = weekRange(wed);
assert("la semana arranca el lunes", iso(r.from) === "2026-11-09");
assert("la semana termina el domingo", iso(r.to) === "2026-11-15");
assert("un lunes es su propia semana", iso(weekRange(new Date(2026, 10, 9)).from) === "2026-11-09");
assert("un domingo pertenece a la semana que termina", iso(weekRange(new Date(2026, 10, 15)).from) === "2026-11-09");
assert("cruza de mes", iso(weekRange(new Date(2026, 10, 1)).from) === "2026-10-26");

const week = buildAgendaWeek([
  ev("a", "Zulma Prueba", "2026-11-09", "2026-11-11"),
  ev("b", "Ana Prueba",   "2026-11-11T00:00:00.000Z", "2026-11-11T00:00:00.000Z"),
  ev("c", "Berta Prueba", "2026-11-01", "2026-11-30"),
  ev("d", "Antes",        "2026-11-01", "2026-11-08"),
  ev("e", "Después",      "2026-11-16", "2026-11-20"),
], wed);

assert("devuelve 7 días", week.length === 7);
assert("el primer día es el lunes", week[0].iso === "2026-11-09");
assert("el último día es el domingo", week[6].iso === "2026-11-15");
assert("miércoles: 3 personas, por nombre", week[2].events.map((e) => e.id).join() === "b,c,a");
assert("una fecha con hora ISO cae en su día, sin correrse", week[1].events.every((e) => e.id !== "b") && week[3].events.every((e) => e.id !== "b"));
assert("incluye el último día del período", week[2].events.some((e) => e.id === "a"));
assert("no sigue después de terminar", !week[3].events.some((e) => e.id === "a"));
assert("una solicitud más larga que la semana está todos los días", week.every((d) => d.events.some((e) => e.id === "c")));
assert("lo que termina antes no aparece", !week.some((d) => d.events.some((e) => e.id === "d")));
assert("lo que empieza después no aparece", !week.some((d) => d.events.some((e) => e.id === "e")));
assert("sin solicitudes, días vacíos", buildAgendaWeek([], wed).every((d) => d.events.length === 0));

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
