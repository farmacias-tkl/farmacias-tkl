/**
 * Contrato de DISPLAY de ROLE_LABELS (UI-Puestos-Roles-B). Labels visibles de UserRole.
 * Solo display: no toca enum, permisos, role-defaults ni lógica.
 *
 *   npx tsx src/lib/permissions-role-labels.test.ts
 */
import { ROLE_LABELS } from "./permissions";
import type { UserRole } from "@prisma/client";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

console.log("=== ROLE_LABELS (display) ===");
assert('OWNER → "Dirección"', ROLE_LABELS.OWNER === "Dirección");
assert('BRANCH_MANAGER → "Encargado/a"', ROLE_LABELS.BRANCH_MANAGER === "Encargado/a");
assert('SUPERVISOR → "Supervisor/a"', ROLE_LABELS.SUPERVISOR === "Supervisor/a");
// labels no cambiados (regresión de los otros roles)
assert('ADMIN → "Administrador"', ROLE_LABELS.ADMIN === "Administrador");
assert('HR → "RRHH"', ROLE_LABELS.HR === "RRHH");
assert('MAINTENANCE → "Mantenimiento"', ROLE_LABELS.MAINTENANCE === "Mantenimiento");

// cobertura: los 6 UserRole presentes en el mapa
const ALL_ROLES: UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR", "HR", "BRANCH_MANAGER", "MAINTENANCE"];
for (const r of ALL_ROLES) {
  assert(`ROLE_LABELS cubre ${r}`, typeof ROLE_LABELS[r] === "string" && ROLE_LABELS[r].length > 0);
}

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
