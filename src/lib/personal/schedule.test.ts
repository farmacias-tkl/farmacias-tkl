/**
 * Tests PUROS de horarios (schedule.ts + workedSlots de coverage.ts).
 * Datos sintéticos, sin DB.
 *
 *   npx tsx src/lib/personal/schedule.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
// Hora local argentina: los cálculos no tienen que depender de ella.
process.env.TZ = "America/Argentina/Buenos_Aires";

import {
  parseHHMM, scheduleAt, slotsOn, validateSchedule, weekLetter, weeklyHours, weeklyHoursWarning,
  type Schedule, type ScheduleSlot,
} from "./schedule";
import { workedSlots } from "./coverage";
import { isoWeekday, parseISODate } from "./dates";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const D = (s: string) => parseISODate(s)!;
const slot = (p: Partial<ScheduleSlot> & Pick<ScheduleSlot, "dayOfWeek" | "startMinute" | "endMinute">): ScheduleSlot =>
  ({ week: "ALL", slot: 1, branchId: "b-tek", otherPlace: null, ...p });

console.log("\nFechas en UTC");
assert("2026-11-02 es lunes aunque el proceso esté en hora argentina", isoWeekday(D("2026-11-02")) === 1);
assert("parseHHMM 08:30 = 510, 24:00 = 1440, 25:00 inválido", parseHHMM("08:30") === 510 && parseHHMM("24:00") === 1440 && parseHHMM("25:00") === null);

console.log("\nDos tramos en un día (horario cortado)");
{
  const slots = [
    slot({ dayOfWeek: 1, slot: 1, startMinute: 8 * 60, endMinute: 12 * 60 }),
    slot({ dayOfWeek: 1, slot: 2, startMinute: 16 * 60, endMinute: 20 * 60 }),
  ];
  assert("válido", validateSchedule({ abReferenceDate: null, slots }).length === 0);
  assert("8 horas semanales", weeklyHours(slots).A === 8);
  const overlapping = [...slots.slice(0, 1), slot({ dayOfWeek: 1, slot: 2, startMinute: 11 * 60, endMinute: 14 * 60 })];
  assert("tramos superpuestos → error", validateSchedule({ abReferenceDate: null, slots: overlapping }).some((e) => e.includes("superpuestos")));
  const three = [...slots, slot({ dayOfWeek: 1, slot: 2, week: "ALL", startMinute: 21 * 60, endMinute: 22 * 60 })];
  assert("tramo duplicado → error", validateSchedule({ abReferenceDate: null, slots: three }).some((e) => e.includes("duplicado")));
  assert("entrada después de salida → error",
    validateSchedule({ abReferenceDate: null, slots: [slot({ dayOfWeek: 2, startMinute: 600, endMinute: 540 })] }).length > 0);
}

console.log("\nUn tramo en otra sucursal y otro en otro lugar");
{
  const slots = [
    slot({ dayOfWeek: 3, slot: 1, startMinute: 8 * 60, endMinute: 12 * 60, branchId: "b-tek" }),
    slot({ dayOfWeek: 3, slot: 2, startMinute: 14 * 60, endMinute: 18 * 60, branchId: null, otherPlace: "Oficina central" }),
  ];
  assert("válido", validateSchedule({ abReferenceDate: null, slots }).length === 0);
  const sch: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: null, slots };
  const on = slotsOn(sch, D("2026-11-04")); // miércoles
  assert("el miércoles tiene los dos tramos con su lugar", on.length === 2 && on[0].branchId === "b-tek" && on[1].otherPlace === "Oficina central");
  assert("sucursal y otro lugar en el mismo tramo → error",
    validateSchedule({ abReferenceDate: null, slots: [slot({ dayOfWeek: 1, startMinute: 1, endMinute: 2, otherPlace: "X" })] }).length > 0);
}

console.log("\nSemanas A/B con fecha de referencia");
{
  const ref = D("2026-11-04"); // miércoles de la semana del lunes 2/11 → esa semana es A
  assert("semana del 2/11 es A", weekLetter(D("2026-11-02"), ref) === "A");
  assert("semana del 9/11 es B", weekLetter(D("2026-11-14"), ref) === "B");
  assert("semana del 16/11 es A", weekLetter(D("2026-11-21"), ref) === "A");
  assert("semana anterior (26/10) es B", weekLetter(D("2026-10-31"), ref) === "B");
  const slots = [
    slot({ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }),
    slot({ dayOfWeek: 6, week: "A", startMinute: 9 * 60, endMinute: 13 * 60 }),
  ];
  const sch: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: ref, slots };
  assert("sábado 7/11 (A) trabaja", slotsOn(sch, D("2026-11-07")).length === 1);
  assert("sábado 14/11 (B) no trabaja", slotsOn(sch, D("2026-11-14")).length === 0);
  const h = weeklyHours(slots);
  assert("horas: A 12, B 8, alternado", h.A === 12 && h.B === 8 && h.alternating);
  assert("A/B sin referencia → error", validateSchedule({ abReferenceDate: null, slots }).some((e) => e.includes("referencia")));
}

console.log("\nVigencia");
{
  const s1 = { validFrom: D("2026-01-01"), id: "1" };
  const s2 = { validFrom: D("2026-06-01"), id: "2" };
  assert("antes del cambio rige el primero", scheduleAt([s1, s2], D("2026-05-31"))?.id === "1");
  assert("desde el cambio rige el nuevo", scheduleAt([s1, s2], D("2026-06-01"))?.id === "2");
  assert("antes del primero no hay horario", scheduleAt([s1, s2], D("2025-12-31")) === null);
}

console.log("\nRotativo sin horario fijo");
{
  assert("sin horarios no hay tramos trabajados", workedSlots([], D("2026-11-02"), D("2026-11-08")).length === 0);
  assert("sin tramos: 0 horas y sin aviso", weeklyHours([]).A === 0 && weeklyHoursWarning([]) === null);
}

console.log("\nMás de 48 horas (se informa, no se bloquea)");
{
  const slots = [1, 2, 3, 4, 5, 6].map((d) => slot({ dayOfWeek: d, startMinute: 8 * 60, endMinute: 17 * 60 }));
  assert("54 h: aviso", (weeklyHoursWarning(slots) ?? "").includes("54"));
  assert("54 h: el horario sigue siendo válido", validateSchedule({ abReferenceDate: null, slots }).length === 0);
  assert("48 h exactas: sin aviso", weeklyHoursWarning(slots.slice(0, 5).concat(slot({ dayOfWeek: 6, startMinute: 8 * 60, endMinute: 11 * 60 }))) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
