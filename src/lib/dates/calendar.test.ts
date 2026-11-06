/**
 * Tests PUROS de las fechas de solo día, en dos zonas horarias
 * (America/Argentina/Buenos_Aires y UTC): la solicitud del 11 al 13 tiene que
 * caer del 11 al 13 en las dos. Más un control del código: no vuelve a aparecer
 * new Date() sobre fechas de solo día en la parte operativa.
 *
 *   npx tsx src/lib/dates/calendar.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import fs from "node:fs";
import path from "node:path";
import { getMonthGrid, parseCalendarDate, startOfDay, toLocalISODate } from "./calendar";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const ZONES: Array<[string, number]> = [["America/Argentina/Buenos_Aires", 180], ["UTC", 0]];

for (const [zone, offset] of ZONES) {
  process.env.TZ = zone;
  console.log(`\nTZ=${zone}`);
  assert("la zona está aplicada", new Date(2026, 10, 11).getTimezoneOffset() === offset);

  // Las tres formas en que llega una fecha de solo día.
  for (const [label, start, end] of [
    ["YYYY-MM-DD", "2026-11-11", "2026-11-13"],
    ["ISO de la API", "2026-11-11T00:00:00.000Z", "2026-11-13T00:00:00.000Z"],
    ["Date de Prisma", new Date("2026-11-11T00:00:00Z"), new Date("2026-11-13T00:00:00Z")],
  ] as Array<[string, string | Date, string | Date]>) {
    const s = parseCalendarDate(start), e = parseCalendarDate(end);
    assert(`${label}: del 11 al 13`, toLocalISODate(s) === "2026-11-11" && toLocalISODate(e) === "2026-11-13");
    // Lo que hace el calendario: de la grilla del mes, qué días cubre la solicitud.
    const days = getMonthGrid(2026, 10).flat()
      .filter((d) => d.getTime() >= s.getTime() && d.getTime() <= e.getTime())
      .map(toLocalISODate);
    assert(`${label}: en la grilla del calendario cae en 11, 12 y 13`, days.join() === "2026-11-11,2026-11-12,2026-11-13");
  }

  assert("se muestra 11/11 sin correrse", parseCalendarDate("2026-11-11").toLocaleDateString("es-AR", { day: "numeric", month: "numeric" }) === "11/11");
  assert("1° de enero sigue siendo de ese año", parseCalendarDate("2027-01-01T00:00:00.000Z").getFullYear() === 2027);
  assert("fin de cobertura guardado a las 23:59:59.999 UTC: mismo día", toLocalISODate(parseCalendarDate("2026-11-13T23:59:59.999Z")) === "2026-11-13");
  assert("valor inválido: Date inválida, sin romper", Number.isNaN(parseCalendarDate("x").getTime()) && Number.isNaN(parseCalendarDate(new Date(NaN)).getTime()));
  assert("hoy local: componentes locales, no UTC", toLocalISODate(new Date(2026, 10, 11, 23, 30)) === "2026-11-11");
}

process.env.TZ = "America/Argentina/Buenos_Aires";
console.log("\nEl error que se corrige");
assert("con new Date() en Argentina daba el 10", startOfDay(new Date("2026-11-11")).getDate() === 10);

console.log("\nControl del código: nada de new Date() sobre campos de solo día");
{
  const ROOTS = ["src/app/(dashboard)", "src/components/action-plans"];
  const FIELD = /new Date\(\s*[\w.?!]*\.(startDate|endDate|hireDate|deadline|date)\s*\)/;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  ROOTS.forEach(walk);
  const offenders = files.flatMap((f) => fs.readFileSync(f, "utf8").split(/\r?\n/)
    .flatMap((line, i) => (FIELD.test(line) ? [`${f}:${i + 1}`] : [])));
  assert(`${files.length} archivos revisados, sin el patrón${offenders.length ? `: ${offenders.join(" ")}` : ""}`, offenders.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
