/**
 * Tests PUROS de los nombres de estado de Vacaciones (tabla compartida).
 *
 *   npx tsx src/lib/vacations/status-labels.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { VACATION_STATUS_LABEL, vacationStatusLabel, visibleVacationStatuses } from "./status-labels";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const labels = (rrhh: boolean) => visibleVacationStatuses(rrhh).map((s) => VACATION_STATUS_LABEL[s]).join(" · ");
assert("sin paso de RRHH: Solicitada · Aprobada · Rechazada · Cancelada", labels(false) === "Solicitada · Aprobada · Rechazada · Cancelada");
assert("con paso de RRHH aparece después de Solicitada", labels(true) === "Solicitada · Pendiente de RRHH · Aprobada · Rechazada · Cancelada");
assert("PENDING_SUPERVISOR se muestra como Solicitada", vacationStatusLabel("PENDING_SUPERVISOR") === "Solicitada");
assert("ningún nombre abreviado (Pend.)", Object.values(VACATION_STATUS_LABEL).every((l) => !/pend\./i.test(l)));
assert("estado desconocido: se muestra tal cual", vacationStatusLabel("OTRO") === "OTRO");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
