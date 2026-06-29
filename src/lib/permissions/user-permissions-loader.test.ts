/**
 * Tests del loader (Fase 1E). SIN DB, SIN Neon, SIN Prisma real: stub de cliente
 * inyectado + fixtures in-memory. Molde: user-permissions.test.ts + r2.test.ts.
 *
 *   npx tsx src/lib/permissions/user-permissions-loader.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import type { UserRole } from "@prisma/client";
import {
  loadUserWithUserPermissions,
  mapUserPermissionRecordToUserWithUserPermissions,
  type UserPermissionLoadRecord,
  type UserPermissionsLoaderClient,
} from "./user-permissions-loader";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

function makeRecord(over: Partial<UserPermissionLoadRecord> = {}): UserPermissionLoadRecord {
  return {
    id: "u1",
    role: "BRANCH_MANAGER" as UserRole,
    active: true,
    branchId: "tekiel",
    employeeId: null,
    permissions: [
      { scope: "OWN_BRANCH", permission: { key: "caja.view", active: true } },
    ],
    ...over,
  };
}

/** Stub prisma-like que cuenta llamadas y captura argumentos. */
function makeClient(opts: {
  userRecord: UserPermissionLoadRecord | null;
  employeeResult?: { currentBranchId: string | null } | null;
}): UserPermissionsLoaderClient & {
  userCalls: number; employeeCalls: number; lastUserArgs: any; lastEmployeeArgs: any;
} {
  const stub: any = {
    userCalls: 0, employeeCalls: 0, lastUserArgs: null, lastEmployeeArgs: null,
    user: {
      async findUnique(args: unknown) { stub.userCalls++; stub.lastUserArgs = args; return opts.userRecord; },
    },
    employee: {
      async findUnique(args: unknown) { stub.employeeCalls++; stub.lastEmployeeArgs = args; return opts.employeeResult ?? null; },
    },
  };
  return stub;
}

async function main() {
  // ======================================================================
  // MAPPER PURO
  // ======================================================================
  console.log("\n=== Mapper: branchId presente ===");
  {
    const rec = makeRecord({
      branchId: "tekiel",
      permissions: [
        { scope: "OWN_BRANCH", permission: { key: "caja.view", active: true } },
        { scope: "ALL_BRANCHES", permission: { key: "caja.export", active: false } },
      ],
    });
    const out = mapUserPermissionRecordToUserWithUserPermissions(rec, "ignorado");
    assert("conserva branchId", out.branchId === "tekiel");
    assert("employeeCurrentBranchId === undefined (branchId presente)", out.employeeCurrentBranchId === undefined);
    assert("copia los 2 permisos", out.permissions.length === 2);
    assert("preserva permission.active=false", out.permissions[1].permission.active === false);
    assert("no propaga employeeId", !("employeeId" in (out as any)));
  }

  console.log("\n=== Mapper: branchId null + fallback presente ===");
  {
    const rec = makeRecord({ branchId: null });
    const out = mapUserPermissionRecordToUserWithUserPermissions(rec, "galesa");
    assert("employeeCurrentBranchId poblado del fallback", out.employeeCurrentBranchId === "galesa");
    assert("branchId queda null", out.branchId === null);
  }

  console.log("\n=== Mapper: branchId null + fallback null/undefined ===");
  {
    const recA = makeRecord({ branchId: null });
    assert("fallback null → null", mapUserPermissionRecordToUserWithUserPermissions(recA, null).employeeCurrentBranchId === null);
    const recB = makeRecord({ branchId: null });
    assert("fallback undefined → null", mapUserPermissionRecordToUserWithUserPermissions(recB).employeeCurrentBranchId === null);
  }

  console.log("\n=== Mapper: active false se propaga ===");
  {
    const rec = makeRecord({ active: false });
    assert("active false propagado", mapUserPermissionRecordToUserWithUserPermissions(rec).active === false);
  }

  console.log("\n=== Mapper: copia defensiva profunda ===");
  {
    const rec = makeRecord();
    const out = mapUserPermissionRecordToUserWithUserPermissions(rec);
    out.permissions.push({ scope: "OWN_BRANCH", permission: { key: "x.injected", active: true } });
    assert("mutar array resultado no muta record", rec.permissions.length === 1);
    const rec2 = makeRecord();
    const out2 = mapUserPermissionRecordToUserWithUserPermissions(rec2);
    out2.permissions[0].permission.key = "mutated";
    assert("mutar permission.key del resultado no muta record (deep copy)", rec2.permissions[0].permission.key === "caja.view");
  }

  // ======================================================================
  // LOADER con cliente mockeado
  // ======================================================================
  console.log("\n=== Loader: user inexistente ===");
  {
    const client = makeClient({ userRecord: null });
    const out = await loadUserWithUserPermissions("nope", client);
    assert("devuelve null", out === null);
    assert("user.findUnique llamado 1 vez", client.userCalls === 1);
    assert("employee.findUnique NO llamado", client.employeeCalls === 0);
  }

  console.log("\n=== Loader: branchId presente → no consulta Employee ===");
  {
    const client = makeClient({ userRecord: makeRecord({ branchId: "tekiel", employeeId: "e1" }) });
    const out = await loadUserWithUserPermissions("u1", client);
    assert("devuelve usuario", out?.id === "u1");
    assert("employee.findUnique NO llamado (branchId presente)", client.employeeCalls === 0);
    assert("employeeCurrentBranchId === undefined", out?.employeeCurrentBranchId === undefined);
  }

  console.log("\n=== Loader: branchId null + employeeId → fallback Employee ===");
  {
    const client = makeClient({
      userRecord: makeRecord({ branchId: null, employeeId: "e1" }),
      employeeResult: { currentBranchId: "galesa" },
    });
    const out = await loadUserWithUserPermissions("u1", client);
    assert("employee.findUnique llamado 1 vez", client.employeeCalls === 1);
    assert("employeeCurrentBranchId poblado", out?.employeeCurrentBranchId === "galesa");
    assert("employee.findUnique recibe where.id = employeeId", (client.lastEmployeeArgs as any)?.where?.id === "e1");
  }

  console.log("\n=== Loader: branchId null + employeeId null → sin fallback ===");
  {
    const client = makeClient({ userRecord: makeRecord({ branchId: null, employeeId: null }) });
    const out = await loadUserWithUserPermissions("u1", client);
    assert("employee.findUnique NO llamado", client.employeeCalls === 0);
    assert("employeeCurrentBranchId === null", out?.employeeCurrentBranchId === null);
  }

  console.log("\n=== Loader: branchId null + employeeId pero Employee inexistente ===");
  {
    const client = makeClient({ userRecord: makeRecord({ branchId: null, employeeId: "e1" }), employeeResult: null });
    const out = await loadUserWithUserPermissions("u1", client);
    assert("employee.findUnique llamado 1 vez", client.employeeCalls === 1);
    assert("employeeCurrentBranchId === null (Employee inexistente)", out?.employeeCurrentBranchId === null);
  }

  console.log("\n=== Loader: user inactive se propaga ===");
  {
    const client = makeClient({ userRecord: makeRecord({ active: false }) });
    const out = await loadUserWithUserPermissions("u1", client);
    assert("active false propagado", out?.active === false);
  }

  console.log("\n=== Loader: permission inactive NO se filtra ===");
  {
    const client = makeClient({ userRecord: makeRecord({
      permissions: [
        { scope: "OWN_BRANCH", permission: { key: "caja.view", active: true } },
        { scope: "OWN_BRANCH", permission: { key: "caja.edit_close", active: false } },
      ],
    }) });
    const out = await loadUserWithUserPermissions("u1", client);
    assert("incluye los 2 permisos", out?.permissions.length === 2);
    const inactive = out?.permissions.find((p) => p.permission.key === "caja.edit_close");
    assert("permiso inactive presente con active=false", inactive?.permission.active === false);
  }

  // ======================================================================
  // ASSERT OBLIGATORIO sobre el SELECT real de user.findUnique
  // ======================================================================
  console.log("\n=== Loader: select de user.findUnique (anti-regresión active) ===");
  {
    const client = makeClient({ userRecord: makeRecord() });
    await loadUserWithUserPermissions("u1", client);
    const sel = (client.lastUserArgs as any)?.select;
    assert("where.id correcto", (client.lastUserArgs as any)?.where?.id === "u1");
    assert("select.id === true", sel?.id === true);
    assert("select.role === true", sel?.role === true);
    assert("select.active === true", sel?.active === true);
    assert("select.branchId === true", sel?.branchId === true);
    assert("select.employeeId === true", sel?.employeeId === true);
    assert("select.permissions.select.scope === true", sel?.permissions?.select?.scope === true);
    assert("select.permissions.select.permission.select.key === true", sel?.permissions?.select?.permission?.select?.key === true);
    assert("select.permissions.select.permission.select.active === true", sel?.permissions?.select?.permission?.select?.active === true);
  }

  console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
