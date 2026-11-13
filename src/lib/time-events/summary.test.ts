/**
 * Tests PUROS de Asistencia: formato de horas y minutos, total por persona,
 * reparto de una compensación y horas de una ausencia. Datos SINTÉTICOS.
 *
 *   npx tsx src/lib/time-events/summary.test.ts
 */
import { fmtHoursAsHM, fmtMinutes, joinHM, splitMinutes } from "./duration";
import {
  absenceCanOweHours, absenceDays, absenceMinutes, allocateCompensation, oldestFirst, summarize, summarizeByEmployee,
} from "./summary";
import type { Schedule, ScheduleSlot } from "@/lib/personal/schedule";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("\nFormato de horas y minutos");
{
  assert("330 → 5 h 30 min", fmtMinutes(330) === "5 h 30 min");
  assert("menos de una hora: 45 min", fmtMinutes(45) === "45 min");
  assert("sin minutos sueltos: 2 h", fmtMinutes(120) === "2 h");
  assert("una hora justa: 1 h", fmtMinutes(60) === "1 h");
  assert("59 → 59 min y 61 → 1 h 1 min", fmtMinutes(59) === "59 min" && fmtMinutes(61) === "1 h 1 min");
  assert("cero: 0 min", fmtMinutes(0) === "0 min");
  assert("null o undefined: 0 min", fmtMinutes(null) === "0 min" && fmtMinutes(undefined) === "0 min");
  assert("negativo: -1 h 30 min", fmtMinutes(-90) === "-1 h 30 min" && fmtMinutes(-20) === "-20 min");
  assert("más de un día sigue en horas: 26 h 15 min", fmtMinutes(1575) === "26 h 15 min");
  assert("banco de horas: 7,5 → 7 h 30 min", fmtHoursAsHM(7.5) === "7 h 30 min");
  assert("banco de horas: 0,25 → 15 min y -3 → -3 h", fmtHoursAsHM(0.25) === "15 min" && fmtHoursAsHM(-3) === "-3 h");
  assert("banco de horas: 1,33 (centésimas) → 1 h 20 min", fmtHoursAsHM(1.33) === "1 h 20 min");
}

console.log("\nCarga en horas y minutos");
{
  assert("5 h y 30 min → 330", joinHM("5", "30") === 330);
  assert("solo minutos", joinHM("", "45") === 45);
  assert("solo horas", joinHM("2", "") === 120);
  assert("los dos vacíos → 0", joinHM("", "") === 0);
  assert("90 min sin horas → 90 (1 h 30 min)", joinHM("", "90") === 90);
  assert("no numérico → null", joinHM("a", "10") === null && joinHM("1", "1.5") === null && joinHM("-1", "0") === null);
  assert("precarga: 330 → 5 y 30", eq(splitMinutes(330), { hours: 5, minutes: 30 }));
  assert("precarga: 45 → 0 y 45", eq(splitMinutes(45), { hours: 0, minutes: 45 }));
  assert("ida y vuelta", [0, 1, 59, 60, 61, 330, 1575].every((n) => { const s = splitMinutes(n); return joinHM(String(s.hours), String(s.minutes)) === n; }));
}

const ev = (status: string, owed: number, comp = 0, remaining = owed - comp) =>
  ({ status, minutesOwed: owed, minutesCompensated: comp, minutesRemaining: remaining });

console.log("\nTotal por persona");
{
  const t = summarize([
    ev("PENDING_REVIEW", 60),
    ev("PENDING_AUTHORIZATION", 30),
    ev("APPROVED_FOR_COMPENSATION", 120),
    ev("PARTIALLY_COMPENSATED", 90, 30),
    ev("COMPENSATED", 45, 45, 0),
    ev("SENT_TO_PAYROLL_DEDUCTION", 300),
    ev("WAIVED", 50, 0, 0),
    ev("CANCELLED", 500, 0, 0),
  ]);
  assert("en revisión cuenta lo pendiente de revisión y de autorización", t.inReview === 90);
  assert("a compensar: lo aprobado que falta compensar", t.toCompensate === 180);
  assert("pendiente = en revisión + a compensar", t.pending === 270);
  assert("compensado", t.compensated === 75);
  assert("enviado a descuento", t.payroll === 300);
  assert("adeudado = compensado + en revisión + a compensar + descuento", t.owed === 645 && t.owed === t.compensated + t.inReview + t.toCompensate + t.payroll);
  assert("lo condonado va aparte y no entra en adeudado", t.waived === 50);
  assert("lo cancelado no cuenta en nada (7 registros)", t.events === 7);
  assert("solo en revisión: hay pendiente aunque no haya nada a compensar", summarize([ev("PENDING_REVIEW", 330)]).pending === 330);
  assert("sin registros: todo en cero", eq(summarize([]), { owed: 0, compensated: 0, pending: 0, inReview: 0, toCompensate: 0, payroll: 0, waived: 0, events: 0 }));

  const rows = summarizeByEmployee([
    { employeeId: "a", ...ev("PENDING_REVIEW", 60) },
    { employeeId: "b", ...ev("PENDING_REVIEW", 200) },
    { employeeId: "b", ...ev("APPROVED_FOR_COMPENSATION", 100) },
    { employeeId: "c", ...ev("COMPENSATED", 400, 400, 0) },
    { employeeId: "d", ...ev("CANCELLED", 999, 0, 0) },
  ]);
  assert("por persona: de mayor a menor pendiente", eq(rows.map((r) => r.employeeId), ["b", "a", "c"]));
  assert("por persona: suma las deudas de cada una", rows[0].totals.pending === 300 && rows[1].totals.pending === 60);
  assert("quien solo tiene cancelados no aparece", !rows.some((r) => r.employeeId === "d"));
}

console.log("\nReparto de una compensación");
{
  const debts = [
    { id: "nueva", date: D("2027-01-20"), createdAt: D("2027-01-20"), minutesRemaining: 60 },
    { id: "vieja", date: D("2027-01-05"), createdAt: D("2027-01-06"), minutesRemaining: 30 },
    { id: "media", date: D("2027-01-12"), createdAt: D("2027-01-12"), minutesRemaining: 45 },
  ];
  assert("orden: de la más vieja a la más nueva", eq(oldestFirst(debts).map((d) => d.id), ["vieja", "media", "nueva"]));
  const a1 = allocateCompensation(debts, 20);
  assert("entra en la más vieja: una sola parte", a1.ok && eq(a1.parts, [{ id: "vieja", minutes: 20 }]));
  const a2 = allocateCompensation(debts, 50);
  assert("supera la más vieja: se parte y sigue con la siguiente", a2.ok && eq(a2.parts, [{ id: "vieja", minutes: 30 }, { id: "media", minutes: 20 }]));
  const a3 = allocateCompensation(debts, 135);
  assert("justo el total: salda las tres", a3.ok && eq(a3.parts, [{ id: "vieja", minutes: 30 }, { id: "media", minutes: 45 }, { id: "nueva", minutes: 60 }]));
  const a4 = allocateCompensation(debts, 136);
  assert("tope: un minuto más no se acepta e informa el máximo", !a4.ok && a4.max === 135);
  const a5 = allocateCompensation([], 10);
  assert("sin deudas a compensar: no se acepta, máximo 0", !a5.ok && a5.max === 0);
  assert("cero o negativo no se acepta", !allocateCompensation(debts, 0).ok && !allocateCompensation(debts, -5).ok);
  assert("minutos con decimales no se aceptan", !allocateCompensation(debts, 10.5).ok);
  const sameDay = [
    { id: "b", date: D("2027-01-05"), createdAt: new Date("2027-01-05T15:00:00Z"), minutesRemaining: 10 },
    { id: "a", date: D("2027-01-05"), createdAt: new Date("2027-01-05T09:00:00Z"), minutesRemaining: 10 },
  ];
  const a6 = allocateCompensation(sameDay, 15);
  assert("mismo día: primero la que se cargó antes", a6.ok && eq(a6.parts, [{ id: "a", minutes: 10 }, { id: "b", minutes: 5 }]));
  const withZero = [...debts, { id: "saldada", date: D("2026-12-01"), createdAt: D("2026-12-01"), minutesRemaining: 0 }];
  const a7 = allocateCompensation(withZero, 10);
  assert("una deuda ya saldada no recibe nada", a7.ok && eq(a7.parts, [{ id: "vieja", minutes: 10 }]));
}

const slot = (dayOfWeek: number, start: number, end: number, n = 1, extra: Partial<ScheduleSlot> = {}): ScheduleSlot =>
  ({ week: "ALL", dayOfWeek, slot: n, startMinute: start, endMinute: end, branchId: "bA", otherPlace: null, ...extra });

console.log("\nHoras de una ausencia según el horario");
{
  // Lunes a viernes de 8 a 14 (6 h).
  const corrido: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: null, slots: [1, 2, 3, 4, 5].map((d) => slot(d, 480, 840)) };
  // Turno partido: de 8 a 12 y de 16 a 20 (8 h), de lunes a viernes; sábado de 9 a 13.
  const partido: Schedule = { validFrom: D("2026-01-01"), abReferenceDate: null,
    slots: [...[1, 2, 3, 4, 5].flatMap((d) => [slot(d, 480, 720, 1), slot(d, 960, 1200, 2)]), slot(6, 540, 780)] };

  const lunes = absenceDays([corrido], D("2027-02-01"), D("2027-02-01"));
  assert("un día de turno corrido: 6 h", eq(lunes, [{ date: "2027-02-01", minutes: 360 }]) && absenceMinutes(lunes) === 360);
  const partidoLunes = absenceDays([partido], D("2027-02-01"), D("2027-02-01"));
  assert("turno partido: suma los dos tramos (4 h + 4 h = 8 h)", absenceMinutes(partidoLunes) === 480);
  const finde = absenceDays([partido], D("2027-02-05"), D("2027-02-08"));
  assert("viernes a lunes: 8 h + 4 h + 0 + 8 h", eq(finde.map((d) => d.minutes), [480, 240, 0, 480]) && absenceMinutes(finde) === 1200);
  const domingo = absenceDays([corrido], D("2027-02-07"), D("2027-02-07"));
  assert("día que no trabaja: 0 (tiene horario)", absenceMinutes(domingo) === 0);
  assert("sin horario cargado: null (hay que escribir las horas)", absenceMinutes(absenceDays([], D("2027-02-01"), D("2027-02-02"))) === null);

  // Cambio de horario: hasta el 31/1 de 8 a 14; desde el 1/2 de 8 a 12.
  const nuevo: Schedule = { validFrom: D("2027-02-01"), abReferenceDate: null, slots: [1, 2, 3, 4, 5].map((d) => slot(d, 480, 720)) };
  const cruza = absenceDays([corrido, nuevo], D("2027-01-29"), D("2027-02-01"));
  assert("usa el horario vigente en cada fecha", eq(cruza.map((d) => d.minutes), [360, 0, 0, 240]));
  const antes: Schedule = { validFrom: D("2027-03-01"), abReferenceDate: null, slots: [slot(1, 480, 840)] };
  const previo = absenceDays([antes], D("2027-02-01"), D("2027-02-01"));
  assert("fecha anterior al primer horario: sin horario ese día", previo[0].minutes === null);

  // Semanas A/B: la A trabaja lunes, la B no.
  const ab: Schedule = { validFrom: D("2027-01-04"), abReferenceDate: D("2027-01-04"), slots: [slot(1, 480, 840, 1, { week: "A" })] };
  const semA = absenceMinutes(absenceDays([ab], D("2027-01-04"), D("2027-01-04")));
  const semB = absenceMinutes(absenceDays([ab], D("2027-01-11"), D("2027-01-11")));
  assert("semanas alternadas: cuenta la semana que corresponde", semA === 360 && semB === 0);
}

console.log("\nQué ausencias admiten resolver horas");
{
  assert("injustificada, de cualquier tipo", absenceCanOweHours({ status: "UNJUSTIFIED", absenceType: "SICKNESS" }));
  assert("no se presentó, sin justificar todavía", absenceCanOweHours({ status: "REPORTED", absenceType: "NO_SHOW" }));
  assert("razón personal, en revisión", absenceCanOweHours({ status: "UNDER_REVIEW", absenceType: "PERSONAL_REASON" }));
  assert("justificada: no", !absenceCanOweHours({ status: "JUSTIFIED", absenceType: "NO_SHOW" }));
  assert("enfermedad reportada (sin marcar injustificada): no", !absenceCanOweHours({ status: "REPORTED", absenceType: "SICKNESS" }));
  assert("licencia médica o vacaciones: no", !absenceCanOweHours({ status: "REPORTED", absenceType: "MEDICAL_LEAVE" }));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
