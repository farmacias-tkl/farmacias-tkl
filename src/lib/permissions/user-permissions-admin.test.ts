/**
 * Tests del servicio admin de UserPermission (Fase 2C-A). SIN DB, SIN Neon, SIN
 * Prisma real: cliente prisma-like inyectado con $transaction atómico simulado.
 *
 *   npx tsx src/lib/permissions/user-permissions-admin.test.ts
 *
 * Exigencia transversal: en cada rechazo se afirma status Y cero-escrituras
 * (create/update/delete/auditLog no llamados) y, salvo casos diseñados para fallar
 * dentro de la transaction, $transaction no se abrió.
 */
import type { UserRole, PermissionScope } from "@prisma/client";
import {
  listUserPermissionsForTarget,
  grantUserPermissionToTarget,
  revokeUserPermissionFromTarget,
} from "./user-permissions-admin";
import type { MinimalUser } from "./user-permissions";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const NORMAL = "caja.view";   // default scope ALL_BRANCHES en los tests → no dispara Regla 1
const CRIT = "caja.export";

// ── fixtures ────────────────────────────────────────────────────────────────
const ownerA: MinimalUser = { id: "owner", role: "OWNER", active: true };
const adminA: MinimalUser = { id: "admin", role: "ADMIN", active: true };
const adminInactive: MinimalUser = { id: "admin", role: "ADMIN", active: false };
const supervisorA: MinimalUser = { id: "sup", role: "SUPERVISOR", active: true };

type Target = { id: string; role: UserRole; active: boolean; branchId: string | null };
const bm: Target = { id: "bm", role: "BRANCH_MANAGER", active: true, branchId: "tekiel" };
const bmNoBranch: Target = { id: "bm2", role: "BRANCH_MANAGER", active: true, branchId: null };
const bmInactive: Target = { id: "bm3", role: "BRANCH_MANAGER", active: false, branchId: "tekiel" };
const ownerTarget: Target = { id: "owner-t", role: "OWNER", active: true, branchId: null };
const otherAdminTarget: Target = { id: "admin2", role: "ADMIN", active: true, branchId: null };
const adminSelfTarget: Target = { id: "admin", role: "ADMIN", active: true, branchId: "tekiel" }; // mismo id que adminA

const permNormal = { id: "p-view", key: NORMAL, module: "caja", description: "Ver", active: true };
const permCrit = { id: "p-export", key: CRIT, module: "caja", description: "Exportar", active: true };
const permInactive = { id: "p-x", key: "caja.attach_doc", module: "caja", description: "Adj", active: false };

// ── stub client con $transaction atómico ─────────────────────────────────────
function makeClient(seed: {
  target?: Target | null;
  permission?: any | null;
  existing?: { id: string; scope: PermissionScope; permission: { key: string } } | null;
  listRows?: any[];
  failAudit?: boolean;
}) {
  const calls = { txOpened: 0, upCreate: 0, upUpdate: 0, upDelete: 0, auditCreate: 0 };
  const committed = { ups: [] as any[], audits: [] as any[], deletes: [] as any[] };
  const client: any = {
    user: { async findUnique() { return seed.target ?? null; } },
    permission: { async findUnique() { return seed.permission ?? null; } },
    userPermission: {
      async findUnique() { return seed.existing ?? null; },
      async findMany() { return seed.listRows ?? []; },
    },
    async $transaction(fn: any) {
      calls.txOpened++;
      const pending = { ups: [] as any[], audits: [] as any[], deletes: [] as any[] };
      const tx = {
        userPermission: {
          async create(args: any) { calls.upCreate++; const row = { id: "up-new" }; pending.ups.push({ op: "create", args, row }); return row; },
          async update(args: any) { calls.upUpdate++; const row = { id: seed.existing?.id ?? "up-upd" }; pending.ups.push({ op: "update", args, row }); return row; },
          async delete(args: any) { calls.upDelete++; pending.deletes.push(args); return {}; },
        },
        auditLog: {
          async create(args: any) { calls.auditCreate++; if (seed.failAudit) throw new Error("audit fail"); pending.audits.push(args.data); return {}; },
        },
      };
      const res = await fn(tx);              // si fn rechaza, pending se descarta (atomicidad)
      committed.ups.push(...pending.ups);
      committed.audits.push(...pending.audits);
      committed.deletes.push(...pending.deletes);
      return res;
    },
  };
  return { client, calls, committed };
}

function noWrites(calls: { upCreate: number; upUpdate: number; upDelete: number; auditCreate: number }): boolean {
  return calls.upCreate === 0 && calls.upUpdate === 0 && calls.upDelete === 0 && calls.auditCreate === 0;
}

async function main() {
  // ======================= GRANT =======================
  console.log("\n=== GRANT: éxitos ===");
  {
    const { client, calls, committed } = makeClient({ target: bm, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("OWNER grant normal → 200 GRANTED", res.status === 200 && (res.body as any).change === "GRANTED");
    assert("OWNER grant normal → 1 create + 1 audit (committed)", committed.ups.length === 1 && committed.audits.length === 1);
    assert("OWNER grant normal → AuditLog action GRANTED dentro de tx", committed.audits[0].action === "USER_PERMISSION_GRANTED" && calls.txOpened === 1);
    assert("OWNER grant normal → grantedByUserId = actor", committed.ups[0].args.data.grantedByUserId === "owner");
  }
  {
    const { client } = makeClient({ target: bm, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: adminA, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("ADMIN grant normal a BRANCH_MANAGER → 200", res.status === 200 && (res.body as any).change === "GRANTED");
  }
  {
    const { client } = makeClient({ target: adminSelfTarget, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: adminA, targetUserId: adminA.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("ADMIN self-grant normal → 200", res.status === 200);
  }

  console.log("\n=== GRANT: rechazos (status + cero-escrituras) ===");
  {
    const { client, calls } = makeClient({ target: ownerTarget, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: adminA, targetUserId: ownerTarget.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("ADMIN grant a OWNER → 403 + 0 escrituras + sin tx", res.status === 403 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: otherAdminTarget, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: adminA, targetUserId: otherAdminTarget.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("ADMIN grant a otro ADMIN → 403 + 0 escrituras", res.status === 403 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: adminSelfTarget, permission: permCrit, existing: null });
    const res = await grantUserPermissionToTarget({ actor: adminA, targetUserId: adminA.id, permissionKey: CRIT, scope: "ALL_BRANCHES", client });
    assert("ADMIN self-grant crítico caja.export → 403 + 0 escrituras", res.status === 403 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    // Regla 1: OWN_BRANCH + branchId null. Actor OWNER (canGrant pasaría) → 400 prueba que Regla 1 corre ANTES.
    const { client, calls } = makeClient({ target: bmNoBranch, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bmNoBranch.id, permissionKey: NORMAL, scope: "OWN_BRANCH", client });
    assert("Regla 1: OWN_BRANCH + branchId null → 400 + 0 escrituras + sin tx", res.status === 400 && noWrites(calls) && calls.txOpened === 0);
    assert("Regla 1: mensaje de sucursal", /sucursal/i.test((res.body as any).error));
  }
  {
    const { client, calls } = makeClient({ target: bm, permission: permInactive, existing: null });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bm.id, permissionKey: permInactive.key, scope: "ALL_BRANCHES", client });
    assert("Permission inactive → 400 + 0 escrituras + sin tx", res.status === 400 && (res.body as any).error === "Permiso inactivo" && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bmInactive, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bmInactive.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("Target inactive → 400 'Usuario inactivo' + 0 escrituras + sin tx", res.status === 400 && (res.body as any).error === "Usuario inactivo" && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bm, permission: null, existing: null });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bm.id, permissionKey: "no.existe", scope: "ALL_BRANCHES", client });
    assert("Permission inexistente → 404 + 0 escrituras + sin tx", res.status === 404 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: null, permission: permNormal });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: "nope", permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("Target inexistente → 404 + 0 escrituras + sin tx", res.status === 404 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bm, permission: permNormal });
    const res = await grantUserPermissionToTarget({ actor: adminInactive, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    // DECISIÓN: actor inactivo → 403 (consistente con requireUserPermission: autenticado pero inactivo = 403).
    assert("Actor inactive → 403 + 0 escrituras + sin tx", res.status === 403 && noWrites(calls) && calls.txOpened === 0);
  }

  console.log("\n=== GRANT: idempotencia (NOOP / SCOPE_CHANGED) ===");
  {
    const { client, calls, committed } = makeClient({ target: bm, permission: permNormal, existing: { id: "up1", scope: "ALL_BRANCHES", permission: { key: NORMAL } } });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("Duplicado mismo scope → 200 NOOP", res.status === 200 && (res.body as any).change === "NOOP");
    assert("NOOP → 0 writes, 0 audit, 0 tx", noWrites(calls) && calls.txOpened === 0 && committed.ups.length === 0);
  }
  {
    const { client, calls, committed } = makeClient({ target: bm, permission: permNormal, existing: { id: "up1", scope: "OWN_BRANCH", permission: { key: NORMAL } } });
    const res = await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("Duplicado distinto scope → 200 SCOPE_CHANGED", res.status === 200 && (res.body as any).change === "SCOPE_CHANGED");
    assert("SCOPE_CHANGED → 1 update + 1 audit dentro de tx", calls.upUpdate === 1 && committed.audits.length === 1 && calls.txOpened === 1);
    assert("SCOPE_CHANGED → audit con oldScope/newScope", committed.audits[0].action === "USER_PERMISSION_SCOPE_CHANGED" && committed.audits[0].detail.oldScope === "OWN_BRANCH" && committed.audits[0].detail.newScope === "ALL_BRANCHES");
  }

  // ======================= REVOKE =======================
  console.log("\n=== REVOKE ===");
  {
    const { client, calls, committed } = makeClient({ target: bm, existing: { id: "up1", scope: "ALL_BRANCHES", permission: { key: NORMAL } } });
    const res = await revokeUserPermissionFromTarget({ actor: ownerA, targetUserId: bm.id, permissionId: "p-view", client });
    assert("Revoke OK → 200 ok", res.status === 200 && (res.body as any).ok === true);
    assert("Revoke OK → 1 delete + 1 audit REVOKED dentro de tx", calls.upDelete === 1 && committed.audits.length === 1 && committed.audits[0].action === "USER_PERMISSION_REVOKED" && calls.txOpened === 1);
  }
  {
    // ADMIN auto-revoca crítico → 403
    const { client, calls } = makeClient({ target: adminSelfTarget, existing: { id: "up1", scope: "ALL_BRANCHES", permission: { key: CRIT } } });
    const res = await revokeUserPermissionFromTarget({ actor: adminA, targetUserId: adminA.id, permissionId: "p-export", client });
    assert("Revoke self-admin crítico → 403 + 0 escrituras", res.status === 403 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bm, existing: null });
    const res = await revokeUserPermissionFromTarget({ actor: ownerA, targetUserId: bm.id, permissionId: "nope", client });
    assert("Revoke inexistente → 404 + 0 escrituras", res.status === 404 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bmInactive, existing: { id: "up1", scope: "ALL_BRANCHES", permission: { key: NORMAL } } });
    const res = await revokeUserPermissionFromTarget({ actor: ownerA, targetUserId: bmInactive.id, permissionId: "p-view", client });
    assert("Revoke target inactive → 400 + 0 escrituras", res.status === 400 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    // ADMIN revoke de OWNER → guard falla → 403, sin escrituras
    const { client, calls } = makeClient({ target: ownerTarget, existing: { id: "up1", scope: "ALL_BRANCHES", permission: { key: NORMAL } } });
    const res = await revokeUserPermissionFromTarget({ actor: adminA, targetUserId: ownerTarget.id, permissionId: "p-view", client });
    assert("Revoke ADMIN→OWNER → 403 + 0 escrituras (no writes si guard falla)", res.status === 403 && noWrites(calls) && calls.txOpened === 0);
  }

  // ======================= LIST =======================
  console.log("\n=== LIST ===");
  {
    const rows = [{
      permissionId: "p-view", scope: "OWN_BRANCH" as PermissionScope, grantedByUserId: "owner",
      createdAt: new Date(0), updatedAt: new Date(0),
      permission: { key: NORMAL, module: "caja", description: "Ver", active: true },
    }, {
      permissionId: "p-export", scope: "ALL_BRANCHES" as PermissionScope, grantedByUserId: "owner",
      createdAt: new Date(0), updatedAt: new Date(0),
      permission: { key: CRIT, module: "caja", description: "Exportar", active: false },
    }];
    const { client } = makeClient({ target: bm, listRows: rows });
    const res = await listUserPermissionsForTarget({ actor: ownerA, targetUserId: bm.id, client });
    const data = (res.body as any)?.data;
    assert("List OK → 200 con 2 filas", res.status === 200 && data.length === 2);
    assert("List mapea key/scope/permissionActive", data[0].key === NORMAL && data[0].scope === "OWN_BRANCH" && data[1].permissionActive === false);
  }
  {
    const { client, calls } = makeClient({ target: bm, listRows: [] });
    const res = await listUserPermissionsForTarget({ actor: supervisorA, targetUserId: bm.id, client });
    assert("List actor sin permiso (SUPERVISOR) → 403 + sin tx", res.status === 403 && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: null });
    const res = await listUserPermissionsForTarget({ actor: ownerA, targetUserId: "nope", client });
    assert("List target inexistente → 404 + sin tx", res.status === 404 && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bm });
    const res = await listUserPermissionsForTarget({ actor: adminInactive, targetUserId: bm.id, client });
    assert("List actor inactive → 403 + sin tx", res.status === 403 && calls.txOpened === 0);
  }

  // ======================= ATOMICIDAD =======================
  console.log("\n=== ATOMICIDAD: AuditLog falla dentro de $transaction ===");
  {
    const { client, calls, committed } = makeClient({ target: bm, permission: permNormal, existing: null, failAudit: true });
    let threw = false;
    try {
      await grantUserPermissionToTarget({ actor: ownerA, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    } catch { threw = true; }
    assert("audit falla dentro de tx → la llamada propaga el error", threw === true);
    assert("audit falla → create se intentó (1) pero NO quedó committed (0)", calls.upCreate === 1 && committed.ups.length === 0);
    assert("audit falla → audit NO quedó committed (0)", committed.audits.length === 0);
  }

  // ======================= ACTOR NULL → 401 =======================
  console.log("\n=== ACTOR null → 401 (rama checkActor) ===");
  {
    const { client, calls } = makeClient({ target: bm, permission: permNormal, existing: null });
    const res = await grantUserPermissionToTarget({ actor: null, targetUserId: bm.id, permissionKey: NORMAL, scope: "ALL_BRANCHES", client });
    assert("grant actor null → 401 + 0 escrituras + sin tx", res.status === 401 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bm, existing: { id: "up1", scope: "ALL_BRANCHES", permission: { key: NORMAL } } });
    const res = await revokeUserPermissionFromTarget({ actor: null, targetUserId: bm.id, permissionId: "p-view", client });
    assert("revoke actor null → 401 + 0 escrituras + sin tx", res.status === 401 && noWrites(calls) && calls.txOpened === 0);
  }
  {
    const { client, calls } = makeClient({ target: bm, listRows: [] });
    const res = await listUserPermissionsForTarget({ actor: null, targetUserId: bm.id, client });
    assert("list actor null → 401 + sin tx", res.status === 401 && calls.txOpened === 0);
  }

  console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
