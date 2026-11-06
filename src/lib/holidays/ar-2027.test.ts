/**
 * Tests PUROS de los feriados 2027.
 *
 *   npx tsx src/lib/holidays/ar-2027.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { AR_HOLIDAYS_2027 } from "./ar-2027";
import { getHoliday, isHoliday } from "./index";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const weekday = (s: string) => D(s).getUTCDay(); // 0 = domingo … 6 = sábado
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pascua (gregoriana), algoritmo de Meeus/Jones/Butcher. */
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const offset = (d: Date, n: number) => iso(new Date(d.getTime() + n * 86_400_000));

const dates = AR_HOLIDAYS_2027.map((h) => h.date);
assert("16 feriados, sin repetidos y en orden", dates.length === 16 && new Set(dates).size === 16 && [...dates].sort().join() === dates.join());
assert("todos son de 2027 y tienen fuente", AR_HOLIDAYS_2027.every((h) => h.date.startsWith("2027-") && !!h.source));

const e = easter(2027);
assert("Pascua 2027 = 28/03", iso(e) === "2027-03-28");
assert("Viernes Santo y Carnaval salen de Pascua", dates.includes(offset(e, -2)) && dates.includes(offset(e, -48)) && dates.includes(offset(e, -47)));
assert("Carnaval: lunes 8 y martes 9 de febrero", weekday("2027-02-08") === 1 && weekday("2027-02-09") === 2 && isHoliday(D("2027-02-08")) && isHoliday(D("2027-02-09")));

const moved = AR_HOLIDAYS_2027.filter((h) => h.originalDate);
assert("los trasladables movidos quedan en lunes", moved.length === 3 && moved.every((h) => weekday(h.date) === 1));
assert("martes/miércoles → lunes anterior; jueves/viernes → lunes siguiente", moved.every((h) => {
  const w = weekday(h.originalDate!);
  const diff = (D(h.date).getTime() - D(h.originalDate!).getTime()) / 86_400_000;
  return (w === 2 || w === 3) ? diff === -(w - 1) : (w === 4 || w === 5) ? diff === 8 - w : false;
}));
assert("la fecha original de un trasladable movido no es feriado", !isHoliday(D("2027-06-17")) && !isHoliday(D("2027-08-17")) && !isHoliday(D("2027-10-12")));

const pending = AR_HOLIDAYS_2027.filter((h) => h.unconfirmed);
assert("sin confirmar: solo el 20/11 (cae sábado)", pending.length === 1 && pending[0].date === "2027-11-20" && weekday("2027-11-20") === 6);
assert("Jueves Santo no es feriado (día no laborable)", !isHoliday(D("2027-03-25")));
assert("getHoliday devuelve el nombre", getHoliday(D("2027-07-09"))?.name === "Día de la Independencia");
assert("2026 sigue cargado", isHoliday(D("2026-12-25")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
