/**
 * Permisos de Asistencia (llegadas tarde, retiros y horas adeudadas).
 *
 * Regla: RRHH (HR) solo ve. Dirección (OWNER), Supervisión (SUPERVISOR) y
 * Administrador (ADMIN) pueden todo. Encargados (BRANCH_MANAGER) cargan y ven.
 * Los permisos de la pestaña Ausencias no cambian (RRHH sigue justificando).
 *
 *   npx tsx src/lib/time-events/permissions.test.ts
 */
import { can } from "../permissions";
import type { UserRole } from "@prisma/client";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const ROLES: UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR", "HR", "BRANCH_MANAGER", "MAINTENANCE"];
type Row = Record<UserRole, boolean>;
const row = (...yes: UserRole[]): Row =>
  Object.fromEntries(ROLES.map((r) => [r, yes.includes(r)])) as Row;

// Matriz esperada: acción × rol.
const FULL: UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR"];
const MATRIX: Array<[string, (r: UserRole) => boolean, Row]> = [
  ["viewAttendance",     can.viewAttendance,     row(...FULL, "HR", "BRANCH_MANAGER")],
  ["createTimeEvent",    can.createTimeEvent,    row(...FULL, "BRANCH_MANAGER")],
  ["authorizeTimeEvent", can.authorizeTimeEvent, row(...FULL)],
  // resolver, resolver varias, cancelar y "Resolver horas de la ausencia"
  ["resolveTimeEvent",   can.resolveTimeEvent,   row(...FULL)],
  // compensación por registro, por persona y deshacer
  ["addCompensation",    can.addCompensation,    row(...FULL)],
  ["editTimeEvent (lo cargó él)",   (r) => can.editTimeEvent(r, true),  row(...FULL, "BRANCH_MANAGER")],
  ["editTimeEvent (lo cargó otro)", (r) => can.editTimeEvent(r, false), row(...FULL)],
  // Pestaña Ausencias: sin cambios.
  ["createAbsence",      can.createAbsence,      row(...FULL, "HR", "BRANCH_MANAGER")],
  ["editAbsence",        can.editAbsence,        row(...FULL, "HR", "BRANCH_MANAGER")],
  ["justifyAbsence",     can.justifyAbsence,     row(...FULL, "HR")],
];

console.log("=== Asistencia: rol × acción ===");
for (const [name, fn, expected] of MATRIX) {
  for (const r of ROLES) {
    assert(`${name} · ${r} → ${expected[r] ? "sí" : "no"}`, fn(r) === expected[r]);
  }
}

console.log("=== OWNER igual que SUPERVISOR y ADMIN en Asistencia ===");
for (const [name, fn] of MATRIX.slice(0, 7)) {
  assert(`${name}: OWNER = SUPERVISOR = ADMIN`, fn("OWNER") === fn("SUPERVISOR") && fn("OWNER") === fn("ADMIN"));
}

console.log("=== RRHH solo ve ===");
assert("HR ve Asistencia", can.viewAttendance("HR"));
for (const [name, fn] of MATRIX.slice(1, 7)) {
  assert(`HR no puede: ${name}`, fn("HR") === false);
}

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
