/**
 * Tests PUROS de "hoy" en el servidor (fecha de Argentina), en dos zonas del
 * proceso: el resultado no depende de la hora local. Más un control del código:
 * las pantallas y APIs operativas no vuelven a armar hoy con setHours.
 *
 *   npx tsx src/lib/dates/today.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import fs from "node:fs";
import { todayAR, todayRangeAR } from "./today";
import { enrichAbsence } from "@/lib/absences";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const iso = (d: Date) => d.toISOString();

for (const zone of ["UTC", "America/Argentina/Buenos_Aires"]) {
  process.env.TZ = zone;
  console.log(`\nProceso en TZ=${zone}`);
  // 22:30 del 06/11 en Argentina = 01:30 UTC del 07/11.
  const night = new Date("2026-11-07T01:30:00Z");
  assert("a las 22:30 de Argentina sigue siendo hoy (06/11)", iso(todayAR(night)) === "2026-11-06T00:00:00.000Z");
  assert("a las 00:00 de Argentina ya es el día siguiente", iso(todayAR(new Date("2026-11-07T03:00:00Z"))) === "2026-11-07T00:00:00.000Z");
  assert("a las 23:59 de Argentina todavía no", iso(todayAR(new Date("2026-11-07T02:59:59Z"))) === "2026-11-06T00:00:00.000Z");
  assert("cambio de mes y de año", iso(todayAR(new Date("2027-01-01T02:00:00Z"))) === "2026-12-31T00:00:00.000Z");
  const r = todayRangeAR(night);
  assert("rango: de 00:00 a 23:59:59.999 UTC del día de Argentina", iso(r.today) === "2026-11-06T00:00:00.000Z" && iso(r.todayEnd) === "2026-11-06T23:59:59.999Z");

  const a = enrichAbsence({ startDate: "2026-11-05T00:00:00.000Z", endDate: new Date("2026-11-06T00:00:00Z") }, night);
  assert("ausencia del 5 al 6: dos días y activa a las 22:30 del 6", a.totalDays === 2 && a.isActiveToday);
  assert("ya no está activa al empezar el 7", !enrichAbsence({ startDate: "2026-11-05", endDate: "2026-11-06" }, new Date("2026-11-07T03:00:00Z")).isActiveToday);
  assert("todavía no está activa si empieza mañana", !enrichAbsence({ startDate: "2026-11-07", endDate: "2026-11-08" }, night).isActiveToday);
}

console.log("\nControl del código");
{
  const files = [
    "src/app/(dashboard)/dashboard/page.tsx", "src/app/(dashboard)/sucursales/page.tsx", "src/app/(dashboard)/sucursales/[id]/page.tsx",
    "src/app/(dashboard)/empleados/[id]/page.tsx", "src/app/api/absences/route.ts", "src/app/api/employees/route.ts",
    "src/app/api/assignments/route.ts", "src/lib/plantilla.ts", "src/lib/assignments.ts", "src/lib/absences.ts",
  ];
  const offenders = files.filter((f) => /setHours\(/.test(fs.readFileSync(f, "utf8")));
  assert(`${files.length} archivos sin setHours${offenders.length ? `: ${offenders.join(" ")}` : ""}`, offenders.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
