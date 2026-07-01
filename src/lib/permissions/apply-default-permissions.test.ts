/**
 * Tests del motor applyDefaultPermissionsForUser (Fase 2F-C1-D). grantFn MOCKEADO:
 * sin Prisma, sin DB, sin Neon. Verifica que el motor itera getDefaultPermissionsForRole,
 * propaga source/batchId/ip/userAgent, valida source y agrega outcomes.
 *
 *   npx tsx src/lib/permissions/apply-default-permissions.test.ts
 */
import { applyDefaultPermissionsForUser } from "./apply-default-permissions";
import { getDefaultPermissionsForRole } from "./role-defaults";
import type { UserRole } from "@prisma/client";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const actor = { id: "owner", role: "OWNER" as UserRole, active: true };
const client = {} as any; // grantFn está mockeado → el client no se usa

// Fabrica un grantFn mock: registra llamadas y responde según `respond(args, index)`.
function mockGrant(respond: (args: any, i: number) => { status: number; body: any }) {
  const calls: any[] = [];
  const fn = async (args: any) => {
    const res = respond(args, calls.length);
    calls.push(args);
    return res as any;
  };
  return { fn, calls };
}
const ok200 = (change: string) => ({ status: 200, body: { change, data: {} } });

async function main() {
  // T1 — rol sin defaults (OWNER) → no llama al servicio.
  {
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u1", role: "OWNER", client, source: "DEFAULT_NEW_USER", grantFn: fn });
    assert("T1 OWNER sin defaults → ok=true", r.ok === true);
    assert("T1 totalDefaults=0, attempted=0, results=[]", r.totalDefaults === 0 && r.attempted === 0 && r.results.length === 0);
    assert("T1 grantFn NO llamado", calls.length === 0);
  }

  // T2 — BRANCH_MANAGER DEFAULT_BACKFILL + batchId.
  {
    const expected = getDefaultPermissionsForRole("BRANCH_MANAGER");
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u2", role: "BRANCH_MANAGER", client, source: "DEFAULT_BACKFILL", batchId: "  batch-bm-1  ", grantFn: fn });
    assert("T2 totalDefaults == getDefaults(BRANCH_MANAGER)", r.totalDefaults === expected.length && expected.length === 3);
    assert("T2 grantFn llamado 1× por default", calls.length === expected.length);
    assert("T2 attempted == totalDefaults", r.attempted === expected.length);
    assert("T2 cada call propaga source/batchId(trim)/target/actor/client", calls.every((c) =>
      c.source === "DEFAULT_BACKFILL" && c.batchId === "batch-bm-1" && c.targetUserId === "u2" && c.actor === actor && c.client === client));
    assert("T2 permissionKey/scope vienen de role-defaults (no hardcode)", calls.map((c) => `${c.permissionKey}:${c.scope}`).join(",") ===
      expected.map((d) => `${d.key}:${d.scope}`).join(","));
    assert("T2 granted == totalDefaults, failed=0, ok=true", r.granted === expected.length && r.failed === 0 && r.ok === true);
  }

  // T3 — SUPERVISOR aplica sus defaults.
  {
    const expected = getDefaultPermissionsForRole("SUPERVISOR");
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u3", role: "SUPERVISOR", client, source: "DEFAULT_BACKFILL", batchId: "batch-sup-1", grantFn: fn });
    assert("T3 totalDefaults == getDefaults(SUPERVISOR)", r.totalDefaults === expected.length && expected.length === 3);
    assert("T3 grantFn 1× por default con source/batchId", calls.length === expected.length && calls.every((c) => c.source === "DEFAULT_BACKFILL" && c.batchId === "batch-sup-1"));
    assert("T3 scope ALL_BRANCHES propagado", calls.every((c) => c.scope === "ALL_BRANCHES"));
  }

  // T4 — DEFAULT_BACKFILL sin batchId → no llama al servicio.
  {
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u4", role: "BRANCH_MANAGER", client, source: "DEFAULT_BACKFILL", grantFn: fn });
    assert("T4 backfill sin batchId → ok=false + error", r.ok === false && /batchId/i.test(r.error ?? ""));
    assert("T4 attempted=0, grantFn NO llamado, results=[]", r.attempted === 0 && calls.length === 0 && r.results.length === 0);
  }
  {
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u4b", role: "BRANCH_MANAGER", client, source: "DEFAULT_BACKFILL", batchId: "   ", grantFn: fn });
    assert("T4b backfill batchId whitespace → ok=false + attempted=0", r.ok === false && r.attempted === 0 && calls.length === 0);
  }

  // T5 — DEFAULT_NEW_USER no requiere batchId.
  {
    const expected = getDefaultPermissionsForRole("BRANCH_MANAGER");
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u5", role: "BRANCH_MANAGER", client, source: "DEFAULT_NEW_USER", grantFn: fn });
    assert("T5 new_user sin batchId → ok=true", r.ok === true);
    assert("T5 batchId=null en resultado y en cada call", r.batchId === null && calls.every((c) => c.batchId === null));
    assert("T5 grantFn 1× por default", calls.length === expected.length);
  }

  // T6 — MANUAL no es source válido para el motor (guard runtime, no solo TS).
  {
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u6", role: "BRANCH_MANAGER", client, source: "MANUAL" as any, grantFn: fn });
    assert("T6 MANUAL → ok=false + error", r.ok === false && /source invalido/i.test(r.error ?? ""));
    assert("T6 attempted=0, grantFn NO llamado", r.attempted === 0 && calls.length === 0);
  }
  {
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u6b", role: "BRANCH_MANAGER", client, source: "LO_QUE_SEA" as any, grantFn: fn });
    assert("T6b source basura → ok=false, attempted=0, sin llamadas", r.ok === false && r.attempted === 0 && calls.length === 0);
  }

  // T7 — outcomes GRANTED / NOOP / SCOPE_CHANGED agregados.
  {
    const outcomes = ["GRANTED", "NOOP", "SCOPE_CHANGED"];
    const { fn } = mockGrant((_a, i) => ok200(outcomes[i] ?? "GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u7", role: "BRANCH_MANAGER", client, source: "DEFAULT_BACKFILL", batchId: "b7", grantFn: fn });
    assert("T7 granted=1, noop=1, scopeChanged=1", r.granted === 1 && r.noop === 1 && r.scopeChanged === 1);
    assert("T7 failed=0, ok=true, attempted=totalDefaults", r.failed === 0 && r.ok === true && r.attempted === r.totalDefaults);
    assert("T7 results conserva permissionKey/scope/status/change", r.results.length === 3 && r.results[0].change === "GRANTED" && typeof r.results[0].permissionKey === "string" && r.results[0].status === 200);
  }

  // T8 — falla individual (403) no aborta el resto.
  {
    const { fn, calls } = mockGrant((_a, i) => i === 1 ? { status: 403, body: { error: "Sin permisos para esta accion" } } : ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u8", role: "BRANCH_MANAGER", client, source: "DEFAULT_BACKFILL", batchId: "b8", grantFn: fn });
    assert("T8 ok=false, failed=1", r.ok === false && r.failed === 1);
    assert("T8 continúa: attempted=totalDefaults", r.attempted === r.totalDefaults && calls.length === r.totalDefaults);
    assert("T8 results incluye el fallo con status/error", r.results.some((x) => x.status === 403 && /Sin permisos/i.test(x.error ?? "")));
    assert("T8 granted = totalDefaults - 1", r.granted === r.totalDefaults - 1);
  }

  // T9 — propaga ip/userAgent.
  {
    const { fn, calls } = mockGrant(() => ok200("GRANTED"));
    await applyDefaultPermissionsForUser({ actor, targetUserId: "u9", role: "SUPERVISOR", client, source: "DEFAULT_NEW_USER", ip: "1.2.3.4", userAgent: "UA/1", grantFn: fn });
    assert("T9 cada call incluye ip/userAgent", calls.length > 0 && calls.every((c) => c.ip === "1.2.3.4" && c.userAgent === "UA/1"));
  }

  // T10 — OWN_BRANCH sin branchId: el servicio rechaza con 400; el motor reporta sin abortar.
  {
    // BRANCH_MANAGER defaults son OWN_BRANCH. Simulamos que el 1º cae por 400 (branchId faltante)
    // y los demás pasan. El motor NO sabe de branchId; solo recibe la respuesta.
    const { fn, calls } = mockGrant((_a, i) => i === 0
      ? { status: 400, body: { error: "Un permiso OWN_BRANCH requiere que el usuario tenga sucursal asignada" } }
      : ok200("GRANTED"));
    const r = await applyDefaultPermissionsForUser({ actor, targetUserId: "u10", role: "BRANCH_MANAGER", client, source: "DEFAULT_BACKFILL", batchId: "b10", grantFn: fn });
    assert("T10 ok=false, failed>=1", r.ok === false && r.failed >= 1);
    assert("T10 attempted=totalDefaults (no aborta)", r.attempted === r.totalDefaults && calls.length === r.totalDefaults);
    const own = r.results.find((x) => x.status === 400);
    assert("T10 results incluye el OWN_BRANCH fallido con scope/status/error", !!own && own.scope === "OWN_BRANCH" && /sucursal/i.test(own.error ?? ""));
    assert("T10 results incluye defaults posteriores exitosos", r.results.some((x) => x.status === 200 && x.change === "GRANTED"));
  }

  console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
