/**
 * Tests PUROS de role-defaults.ts (Fase 1C). Fixtures in-memory, sin DB, sin
 * Prisma real, sin Neon. Molde: user-permissions.test.ts.
 *
 *   npx tsx src/lib/permissions/role-defaults.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import type { UserRole } from "@prisma/client";
import {
  ROLE_DEFAULT_PERMISSIONS,
  getDefaultPermissionsForRole,
  hasDefaultPermission,
  type DefaultPermissionGrant,
} from "./role-defaults";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const ALL_ROLES: UserRole[] = [
  "SUPERVISOR", "BRANCH_MANAGER", "HR", "MAINTENANCE", "OWNER", "ADMIN",
];

// Compara un set de grants contra el esperado, sin importar orden.
function sameGrants(got: DefaultPermissionGrant[], expected: DefaultPermissionGrant[]): boolean {
  if (got.length !== expected.length) return false;
  const norm = (g: DefaultPermissionGrant) => `${g.key}|${g.scope}`;
  const a = got.map(norm).sort();
  const b = expected.map(norm).sort();
  return a.every((v, i) => v === b[i]);
}

console.log("\n=== BRANCH_MANAGER ===");
assert("BRANCH_MANAGER defaults exactos (3 × OWN_BRANCH)", sameGrants(
  getDefaultPermissionsForRole("BRANCH_MANAGER"),
  [
    { key: "caja.view", scope: "OWN_BRANCH" },
    { key: "caja.create_close", scope: "OWN_BRANCH" },
    { key: "caja.attach_doc", scope: "OWN_BRANCH" },
  ],
));
assert("BRANCH_MANAGER NO tiene caja.edit_close", hasDefaultPermission("BRANCH_MANAGER", "caja.edit_close") === false);
assert("BRANCH_MANAGER NO tiene caja.export", hasDefaultPermission("BRANCH_MANAGER", "caja.export") === false);
assert("BRANCH_MANAGER solo usa OWN_BRANCH",
  getDefaultPermissionsForRole("BRANCH_MANAGER").every((g) => g.scope === "OWN_BRANCH"));

console.log("\n=== SUPERVISOR ===");
assert("SUPERVISOR defaults exactos (3 × ALL_BRANCHES)", sameGrants(
  getDefaultPermissionsForRole("SUPERVISOR"),
  [
    { key: "caja.view", scope: "ALL_BRANCHES" },
    { key: "caja.create_close", scope: "ALL_BRANCHES" },
    { key: "caja.attach_doc", scope: "ALL_BRANCHES" },
  ],
));
assert("SUPERVISOR NO tiene caja.edit_close", hasDefaultPermission("SUPERVISOR", "caja.edit_close") === false);
assert("SUPERVISOR NO tiene caja.export", hasDefaultPermission("SUPERVISOR", "caja.export") === false);
assert("SUPERVISOR solo usa ALL_BRANCHES",
  getDefaultPermissionsForRole("SUPERVISOR").every((g) => g.scope === "ALL_BRANCHES"));

console.log("\n=== ADMIN ===");
assert("ADMIN defaults exactos (solo caja.view ALL_BRANCHES)", sameGrants(
  getDefaultPermissionsForRole("ADMIN"),
  [{ key: "caja.view", scope: "ALL_BRANCHES" }],
));
assert("ADMIN NO tiene caja.create_close", hasDefaultPermission("ADMIN", "caja.create_close") === false);
assert("ADMIN NO tiene caja.attach_doc", hasDefaultPermission("ADMIN", "caja.attach_doc") === false);
assert("ADMIN NO tiene caja.edit_close", hasDefaultPermission("ADMIN", "caja.edit_close") === false);
assert("ADMIN NO tiene caja.export", hasDefaultPermission("ADMIN", "caja.export") === false);
assert("ADMIN solo usa ALL_BRANCHES",
  getDefaultPermissionsForRole("ADMIN").every((g) => g.scope === "ALL_BRANCHES"));

console.log("\n=== OWNER / HR / MAINTENANCE → [] ===");
assert("OWNER => []", getDefaultPermissionsForRole("OWNER").length === 0);
assert("HR => []", getDefaultPermissionsForRole("HR").length === 0);
assert("MAINTENANCE => []", getDefaultPermissionsForRole("MAINTENANCE").length === 0);

console.log("\n=== Cobertura de todos los roles ===");
for (const role of ALL_ROLES) {
  assert(`ROLE_DEFAULT_PERMISSIONS cubre ${role}`,
    Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_PERMISSIONS, role));
}

console.log("\n=== Copia defensiva ===");
assert("mutar el array devuelto NO muta el mapa interno", (() => {
  const before = getDefaultPermissionsForRole("BRANCH_MANAGER").length;
  const got = getDefaultPermissionsForRole("BRANCH_MANAGER");
  got.push({ key: "hack.injected", scope: "OWN_BRANCH" });
  got[0].key = "mutated";
  const after = getDefaultPermissionsForRole("BRANCH_MANAGER");
  return after.length === before && after[0].key === "caja.view";
})());

console.log("\n=== Sin críticos como default + solo caja.* ===");
const allGrants: DefaultPermissionGrant[] = ALL_ROLES.flatMap((r) => getDefaultPermissionsForRole(r));
assert("caja.edit_close no aparece en ningún default",
  allGrants.every((g) => g.key !== "caja.edit_close"));
assert("caja.export no aparece en ningún default",
  allGrants.every((g) => g.key !== "caja.export"));
assert("solo keys caja.* en esta fase",
  allGrants.every((g) => g.key.startsWith("caja.")));
assert("todos los scopes son válidos (OWN_BRANCH | ALL_BRANCHES)",
  allGrants.every((g) => g.scope === "OWN_BRANCH" || g.scope === "ALL_BRANCHES"));

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
