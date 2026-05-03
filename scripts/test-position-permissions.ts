/**
 * Validacion de can() / canInBranch() / requirePermission() con fixtures
 * in-memory. No requiere DB ni framework de tests. Se ejecuta:
 *
 *   npx tsx scripts/test-position-permissions.ts
 *
 * Cubre los 7 escenarios pedidos en Fase 3 + edge cases (null user,
 * permiso inactivo, requirePermission con/sin branchId).
 *
 * Si todos los asserts pasan -> exit 0. Si alguno falla -> exit 1.
 */
import {
  can,
  canInBranch,
  requirePermission,
  type UserWithPermissions,
} from "../src/lib/permissions/position-permissions";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`);
  }
}

// ============================================================================
// Fixtures
// ============================================================================

const owner: UserWithPermissions = {
  id: "u-owner", role: "OWNER", employee: null,
};

const admin: UserWithPermissions = {
  id: "u-admin", role: "ADMIN", employee: null,
};

const supervisor: UserWithPermissions = {
  id: "u-superv", role: "SUPERVISOR", employee: null,
};

// BRANCH_MANAGER sin Employee (caso edge): roles operativos sin Employee
// asignado caen en el deny por default.
const branchMgrSinEmpl: UserWithPermissions = {
  id: "u-bm-noemp", role: "BRANCH_MANAGER", employee: null,
};

// BRANCH_MANAGER con puesto Cadete en Tekiel (OWN_BRANCH).
const cadeteTekiel: UserWithPermissions = {
  id: "u-cadete", role: "BRANCH_MANAGER",
  employee: {
    id: "e-cadete", currentBranchId: "tekiel-id",
    position: {
      permissions: [
        { scope: "OWN_BRANCH", permission: { key: "vencidos.upload_remito", active: true } },
        { scope: "OWN_BRANCH", permission: { key: "vencidos.view",          active: true } },
      ],
    },
  },
};

// HR cross-branch con permiso ALL_BRANCHES (HR no esta en bypass).
const hrRegional: UserWithPermissions = {
  id: "u-hr", role: "HR",
  employee: {
    id: "e-hr", currentBranchId: null,
    position: {
      permissions: [
        { scope: "ALL_BRANCHES", permission: { key: "vacaciones.approve", active: true } },
      ],
    },
  },
};

// BRANCH_MANAGER con un permiso pero el catalogo lo tiene en active=false.
const conPermInactivo: UserWithPermissions = {
  id: "u-inactive", role: "BRANCH_MANAGER",
  employee: {
    id: "e-inactive", currentBranchId: "galesa-id",
    position: {
      permissions: [
        { scope: "OWN_BRANCH", permission: { key: "caja.create_close", active: false } },
      ],
    },
  },
};

// ============================================================================
// Escenarios
// ============================================================================

console.log("\n=== Bypass operativo ===");
assert("OWNER bypass: can() => true",
  can(owner, "vencidos.upload_remito") === true);
assert("OWNER bypass: canInBranch() => true",
  canInBranch(owner, "caja.create_close", "tekiel-id") === true);
assert("ADMIN bypass: can() => true",
  can(admin, "vencidos.upload_remito") === true);
assert("ADMIN bypass: canInBranch() => true",
  canInBranch(admin, "caja.create_close", "tekiel-id") === true);
assert("SUPERVISOR bypass: can() => true (compat legacy)",
  can(supervisor, "cualquier.permiso") === true);
assert("SUPERVISOR bypass: canInBranch() => true (compat legacy)",
  canInBranch(supervisor, "caja.create_close", "tekiel-id") === true);

console.log("\n=== Sin Employee (rol no-bypass) ===");
assert("BRANCH_MANAGER sin Employee: can() => false",
  can(branchMgrSinEmpl, "vencidos.view") === false);
assert("BRANCH_MANAGER sin Employee: canInBranch() => false",
  canInBranch(branchMgrSinEmpl, "vencidos.view", "tekiel-id") === false);

console.log("\n=== OWN_BRANCH scope ===");
assert("Cadete Tekiel: can() => true (sin importar branch)",
  can(cadeteTekiel, "vencidos.upload_remito") === true);
assert("Cadete Tekiel en su branch (tekiel): canInBranch() => true",
  canInBranch(cadeteTekiel, "vencidos.upload_remito", "tekiel-id") === true);
assert("Cadete Tekiel en otra branch (galesa): canInBranch() => false",
  canInBranch(cadeteTekiel, "vencidos.upload_remito", "galesa-id") === false);
assert("Cadete Tekiel sin permiso en su branch: canInBranch() => false",
  canInBranch(cadeteTekiel, "caja.create_close", "tekiel-id") === false);

console.log("\n=== ALL_BRANCHES scope ===");
assert("HR Regional con ALL_BRANCHES en cualquier branch: canInBranch() => true",
  canInBranch(hrRegional, "vacaciones.approve", "galesa-id") === true);
assert("HR Regional con ALL_BRANCHES en otra branch: canInBranch() => true",
  canInBranch(hrRegional, "vacaciones.approve", "tekiel-id") === true);
assert("HR Regional sin el permiso: canInBranch() => false",
  canInBranch(hrRegional, "caja.create_close", "tekiel-id") === false);

console.log("\n=== Permission inactive ===");
assert("Permiso con active=false: can() => false",
  can(conPermInactivo, "caja.create_close") === false);
assert("Permiso con active=false: canInBranch() => false",
  canInBranch(conPermInactivo, "caja.create_close", "galesa-id") === false);

console.log("\n=== Null/undefined user ===");
assert("can(null) => false",            can(null, "x") === false);
assert("can(undefined) => false",       can(undefined, "x") === false);
assert("canInBranch(null) => false",    canInBranch(null, "x", "y") === false);

console.log("\n=== requirePermission ===");
assert("requirePermission(OWNER, ...) => null (OK)",
  requirePermission(owner, "vencidos.view") === null);
assert("requirePermission(BRANCH_MANAGER sin permiso) => 403",
  requirePermission(cadeteTekiel, "caja.create_close")?.status === 403);
assert("requirePermission(null user) => 401",
  requirePermission(null, "x")?.status === 401);
assert("requirePermission con branchId OK => null",
  requirePermission(cadeteTekiel, "vencidos.upload_remito", "tekiel-id") === null);
assert("requirePermission con branchId WRONG => 403",
  requirePermission(cadeteTekiel, "vencidos.upload_remito", "galesa-id")?.status === 403);

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
