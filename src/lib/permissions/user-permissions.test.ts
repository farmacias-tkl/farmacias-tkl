/**
 * Tests PUROS de user-permissions.ts (Fase 1B). Fixtures in-memory, sin DB, sin
 * Prisma real, sin Neon. Molde: scripts/test-position-permissions.ts.
 *
 *   npx tsx src/lib/permissions/user-permissions.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import {
  canUser,
  canUserInBranch,
  canPerformOperationalAction,
  requireUserPermission,
  getOwnBranchId,
  isCriticalPermission,
  canAdministerUsers,
  canManageUserPermissions,
  canGrantUserPermission,
  canRevokeUserPermission,
  canCreateUserWithRole,
  canModifyUser,
  type UserWithUserPermissions,
  type MinimalUser,
} from "./user-permissions";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

// ============================================================================
// Fixtures operativos
// ============================================================================
const NORMAL = "caja.create_close";
const CRIT = "caja.edit_close";

function uperm(scope: "OWN_BRANCH" | "ALL_BRANCHES", key: string, active = true) {
  return { scope: scope as any, permission: { key, active } };
}

const ownerOp: UserWithUserPermissions = {
  id: "u-owner", role: "OWNER", active: true, branchId: null, permissions: [],
};
const ownerInactive: UserWithUserPermissions = {
  id: "u-owner-x", role: "OWNER", active: false, branchId: null, permissions: [],
};
const adminOp: UserWithUserPermissions = {
  id: "u-admin", role: "ADMIN", active: true, branchId: null, permissions: [],
};
const adminConPermiso: UserWithUserPermissions = {
  id: "u-admin2", role: "ADMIN", active: true, branchId: "tekiel",
  permissions: [uperm("ALL_BRANCHES", NORMAL)],
};
const supervisorSinPerm: UserWithUserPermissions = {
  id: "u-sup", role: "SUPERVISOR", active: true, branchId: null, permissions: [],
};
const supervisorAll: UserWithUserPermissions = {
  id: "u-sup2", role: "SUPERVISOR", active: true, branchId: null,
  permissions: [uperm("ALL_BRANCHES", NORMAL)],
};
// BRANCH_MANAGER OWN_BRANCH via User.branchId canónico.
const bmOwn: UserWithUserPermissions = {
  id: "u-bm", role: "BRANCH_MANAGER", active: true, branchId: "tekiel",
  permissions: [uperm("OWN_BRANCH", NORMAL)],
};
// OWN_BRANCH via fallback transitorio (User.branchId null, Employee.currentBranchId set).
const bmFallback: UserWithUserPermissions = {
  id: "u-bm-fb", role: "BRANCH_MANAGER", active: true, branchId: null,
  employeeCurrentBranchId: "galesa",
  permissions: [uperm("OWN_BRANCH", NORMAL)],
};
// OWN_BRANCH sin sucursal propia alguna.
const bmSinBranch: UserWithUserPermissions = {
  id: "u-bm-nb", role: "BRANCH_MANAGER", active: true, branchId: null,
  permissions: [uperm("OWN_BRANCH", NORMAL)],
};
// permiso inactivo en el catálogo.
const bmPermInactivo: UserWithUserPermissions = {
  id: "u-bm-inact", role: "BRANCH_MANAGER", active: true, branchId: "tekiel",
  permissions: [uperm("OWN_BRANCH", NORMAL, false)],
};
// usuario inactivo con permiso activo.
const bmInactiveUser: UserWithUserPermissions = {
  id: "u-bm-userx", role: "BRANCH_MANAGER", active: false, branchId: "tekiel",
  permissions: [uperm("ALL_BRANCHES", NORMAL)],
};

console.log("\n=== Operativos: null / inactive ===");
assert("canUser(null) => false", canUser(null, NORMAL) === false);
assert("canUser(undefined) => false", canUser(undefined, NORMAL) === false);
assert("requireUserPermission(null) => 401", requireUserPermission(null, NORMAL)?.status === 401);
assert("OWNER inactive: canUser => false", canUser(ownerInactive, NORMAL) === false);
assert("user inactive con permiso activo: canUser => false", canUser(bmInactiveUser, NORMAL) === false);
assert("user inactive: requireUserPermission => 403", requireUserPermission(bmInactiveUser, NORMAL)?.status === 403);

console.log("\n=== Operativos: OWNER override ===");
assert("OWNER active: canUser cualquier permiso => true", canUser(ownerOp, "cualquiera.x") === true);
assert("OWNER active: canUserInBranch cualquier branch => true", canUserInBranch(ownerOp, "cualquiera.x", "qa") === true);
assert("OWNER active: canPerformOperationalAction => true", canPerformOperationalAction(ownerOp, CRIT, "qa") === true);

console.log("\n=== Operativos: ADMIN sin override ===");
assert("ADMIN sin permiso explícito: canUser => false", canUser(adminOp, NORMAL) === false);
assert("ADMIN sin permiso explícito: canUserInBranch => false", canUserInBranch(adminOp, NORMAL, "tekiel") === false);
assert("ADMIN con permiso explícito activo: canUser => true", canUser(adminConPermiso, NORMAL) === true);
assert("ADMIN con ALL_BRANCHES: canUserInBranch otra branch => true", canUserInBranch(adminConPermiso, NORMAL, "otra") === true);

console.log("\n=== Operativos: SUPERVISOR sin override ===");
assert("SUPERVISOR sin permiso: canUser => false", canUser(supervisorSinPerm, NORMAL) === false);
assert("SUPERVISOR sin permiso: canUserInBranch => false", canUserInBranch(supervisorSinPerm, NORMAL, "tekiel") === false);
assert("SUPERVISOR con ALL_BRANCHES: canUserInBranch => true", canUserInBranch(supervisorAll, NORMAL, "tekiel") === true);

console.log("\n=== Operativos: permiso inactivo ===");
assert("permiso inactivo: canUser => false", canUser(bmPermInactivo, NORMAL) === false);
assert("permiso inactivo: canUserInBranch => false", canUserInBranch(bmPermInactivo, NORMAL, "tekiel") === false);

console.log("\n=== Operativos: OWN_BRANCH (User.branchId canónico) ===");
assert("OWN_BRANCH match User.branchId => true", canUserInBranch(bmOwn, NORMAL, "tekiel") === true);
assert("OWN_BRANCH mismatch => false", canUserInBranch(bmOwn, NORMAL, "galesa") === false);

console.log("\n=== Operativos: OWN_BRANCH fallback transitorio ===");
assert("getOwnBranchId usa branchId primero", getOwnBranchId(adminConPermiso) === "tekiel");
assert("getOwnBranchId fallback a employeeCurrentBranchId", getOwnBranchId(bmFallback) === "galesa");
assert("getOwnBranchId sin ninguno => null", getOwnBranchId(bmSinBranch) === null);
assert("OWN_BRANCH via fallback match => true", canUserInBranch(bmFallback, NORMAL, "galesa") === true);
assert("OWN_BRANCH via fallback mismatch => false", canUserInBranch(bmFallback, NORMAL, "tekiel") === false);
assert("OWN_BRANCH sin sucursal propia => false", canUserInBranch(bmSinBranch, NORMAL, "tekiel") === false);

console.log("\n=== Operativos: canUser sin branch ignora scope ===");
assert("canUser true si permiso activo existe (OWN_BRANCH)", canUser(bmOwn, NORMAL) === true);

console.log("\n=== Operativos: canPerformOperationalAction delega ===");
assert("delega a canUser sin branch (true)", canPerformOperationalAction(supervisorAll, NORMAL) === true);
assert("delega a canUserInBranch con branch (mismatch false)", canPerformOperationalAction(bmOwn, NORMAL, "galesa") === false);
assert("delega a canUserInBranch con branch (match true)", canPerformOperationalAction(bmOwn, NORMAL, "tekiel") === true);
assert("active-first en canPerformOperationalAction", canPerformOperationalAction(bmInactiveUser, NORMAL, "tekiel") === false);
assert("requireUserPermission autorizado => null", requireUserPermission(bmOwn, NORMAL, "tekiel") === null);
assert("requireUserPermission deny => 403", requireUserPermission(bmOwn, NORMAL, "galesa")?.status === 403);

// ============================================================================
// Fixtures administrativos
// ============================================================================
const aOwner: MinimalUser = { id: "a-owner", role: "OWNER", active: true };
const aOwnerInact: MinimalUser = { id: "a-owner-x", role: "OWNER", active: false };
const aAdmin: MinimalUser = { id: "a-admin", role: "ADMIN", active: true };
const aAdminInact: MinimalUser = { id: "a-admin-x", role: "ADMIN", active: false };
const aAdmin2: MinimalUser = { id: "a-admin2", role: "ADMIN", active: true };
const aSup: MinimalUser = { id: "a-sup", role: "SUPERVISOR", active: true };
const tOwner: MinimalUser = { id: "t-owner", role: "OWNER", active: true };
const tAdmin: MinimalUser = { id: "t-admin", role: "ADMIN", active: true };
const tOp: MinimalUser = { id: "t-op", role: "BRANCH_MANAGER", active: true };
const tOpInact: MinimalUser = { id: "t-op-x", role: "BRANCH_MANAGER", active: false };

console.log("\n=== isCriticalPermission ===");
assert("caja.edit_close crítico", isCriticalPermission("caja.edit_close") === true);
assert("caja.export crítico", isCriticalPermission("caja.export") === true);
assert("caja.view normal", isCriticalPermission("caja.view") === false);
assert("key desconocida normal", isCriticalPermission("loquesea.x") === false);

console.log("\n=== canAdministerUsers ===");
assert("OWNER active => true", canAdministerUsers(aOwner) === true);
assert("ADMIN active => true", canAdministerUsers(aAdmin) === true);
assert("SUPERVISOR => false", canAdministerUsers(aSup) === false);
assert("OWNER inactive => false", canAdministerUsers(aOwnerInact) === false);
assert("ADMIN inactive => false", canAdministerUsers(aAdminInact) === false);
assert("null => false", canAdministerUsers(null) === false);

console.log("\n=== canManageUserPermissions ===");
assert("OWNER → target OWNER", canManageUserPermissions(aOwner, tOwner) === true);
assert("OWNER → target ADMIN", canManageUserPermissions(aOwner, tAdmin) === true);
assert("OWNER → target operativo", canManageUserPermissions(aOwner, tOp) === true);
assert("ADMIN → target operativo", canManageUserPermissions(aAdmin, tOp) === true);
assert("ADMIN → self (mismo ADMIN)", canManageUserPermissions(aAdmin, aAdmin) === true);
assert("ADMIN → target OWNER => false", canManageUserPermissions(aAdmin, tOwner) === false);
assert("ADMIN → otro ADMIN => false", canManageUserPermissions(aAdmin, aAdmin2) === false);
assert("actor inactive => false", canManageUserPermissions(aAdminInact, tOp) === false);
assert("target inactive => false", canManageUserPermissions(aAdmin, tOpInact) === false);
assert("SUPERVISOR => false", canManageUserPermissions(aSup, tOp) === false);

console.log("\n=== canGrantUserPermission ===");
assert("OWNER → crítico a operativo", canGrantUserPermission(aOwner, tOp, CRIT) === true);
assert("OWNER → crítico a ADMIN", canGrantUserPermission(aOwner, tAdmin, CRIT) === true);
assert("ADMIN → normal a operativo", canGrantUserPermission(aAdmin, tOp, NORMAL) === true);
assert("ADMIN → crítico a operativo", canGrantUserPermission(aAdmin, tOp, CRIT) === true);
assert("ADMIN → normal a sí mismo", canGrantUserPermission(aAdmin, aAdmin, NORMAL) === true);
assert("ADMIN → crítico a sí mismo => false", canGrantUserPermission(aAdmin, aAdmin, CRIT) === false);
assert("ADMIN → normal a otro ADMIN => false", canGrantUserPermission(aAdmin, aAdmin2, NORMAL) === false);
assert("ADMIN → crítico a otro ADMIN => false", canGrantUserPermission(aAdmin, aAdmin2, CRIT) === false);
assert("ADMIN → normal a OWNER => false", canGrantUserPermission(aAdmin, tOwner, NORMAL) === false);
assert("ADMIN → crítico a OWNER => false", canGrantUserPermission(aAdmin, tOwner, CRIT) === false);
assert("actor inactive => false", canGrantUserPermission(aAdminInact, tOp, NORMAL) === false);
assert("target inactive => false", canGrantUserPermission(aAdmin, tOpInact, NORMAL) === false);

console.log("\n=== canRevokeUserPermission (misma regla que grant) ===");
assert("OWNER → crítico a operativo", canRevokeUserPermission(aOwner, tOp, CRIT) === true);
assert("ADMIN → normal a operativo", canRevokeUserPermission(aAdmin, tOp, NORMAL) === true);
assert("ADMIN → crítico a operativo", canRevokeUserPermission(aAdmin, tOp, CRIT) === true);
assert("ADMIN → auto-revoca normal", canRevokeUserPermission(aAdmin, aAdmin, NORMAL) === true);
assert("ADMIN → auto-revoca crítico => false", canRevokeUserPermission(aAdmin, aAdmin, CRIT) === false);
assert("ADMIN → otro ADMIN => false", canRevokeUserPermission(aAdmin, aAdmin2, NORMAL) === false);
assert("ADMIN → OWNER => false", canRevokeUserPermission(aAdmin, tOwner, CRIT) === false);

console.log("\n=== canCreateUserWithRole ===");
assert("OWNER → OWNER", canCreateUserWithRole(aOwner, "OWNER") === true);
assert("OWNER → ADMIN", canCreateUserWithRole(aOwner, "ADMIN") === true);
assert("OWNER → operativo", canCreateUserWithRole(aOwner, "BRANCH_MANAGER") === true);
assert("ADMIN → operativo", canCreateUserWithRole(aAdmin, "SUPERVISOR") === true);
assert("ADMIN → OWNER => false", canCreateUserWithRole(aAdmin, "OWNER") === false);
assert("ADMIN → ADMIN => false", canCreateUserWithRole(aAdmin, "ADMIN") === false);
assert("actor inactive => false", canCreateUserWithRole(aAdminInact, "HR") === false);
assert("SUPERVISOR => false", canCreateUserWithRole(aSup, "HR") === false);

console.log("\n=== canModifyUser ===");
assert("OWNER → OWNER", canModifyUser(aOwner, tOwner) === true);
assert("OWNER → ADMIN", canModifyUser(aOwner, tAdmin) === true);
assert("OWNER → operativo", canModifyUser(aOwner, tOp) === true);
assert("ADMIN → operativo", canModifyUser(aAdmin, tOp) === true);
assert("ADMIN → OWNER => false", canModifyUser(aAdmin, tOwner) === false);
assert("ADMIN → ADMIN => false", canModifyUser(aAdmin, tAdmin) === false);
assert("actor inactive => false", canModifyUser(aAdminInact, tOp) === false);
assert("target inactive => false", canModifyUser(aAdmin, tOpInact) === false);

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
