/**
 * Tests del helper applyNewUserDefaults (Fase 2F-DEFAULT_NEW_USER). Dependencias
 * inyectadas: client.user.findUnique (carga de actor) y applyFn (motor). Sin DB, sin
 * Neon, sin escritura real. El helper debe ser TOTAL: nunca lanza.
 *
 *   npx tsx src/lib/permissions/apply-new-user-defaults.test.ts
 */
import { applyNewUserDefaults } from "./apply-new-user-defaults";
import type { UserRole } from "@prisma/client";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const BACKFILL_BATCH = "2f-default-backfill-20260701-0124"; // nunca debe aparecer

// client mock: user.findUnique devuelve `actor` (o lanza si throwOnLoad).
function mockClient(actor: { id: string; role: UserRole; active: boolean } | null, throwOnLoad = false) {
  return {
    user: {
      async findUnique() {
        if (throwOnLoad) throw new Error("db down");
        return actor;
      },
    },
  } as any;
}

// applyFn mock: registra llamadas y responde (o lanza).
function mockApply(respond: (args: any) => any, opts: { throws?: boolean } = {}) {
  const calls: any[] = [];
  const fn = async (args: any) => {
    calls.push(args);
    if (opts.throws) throw new Error("motor exploded");
    return respond(args);
  };
  return { fn, calls };
}
const motorOk = (totalDefaults: number, granted = totalDefaults) => ({
  ok: true, targetUserId: "t", role: "BRANCH_MANAGER", source: "DEFAULT_NEW_USER", batchId: null,
  totalDefaults, attempted: totalDefaults, granted, noop: 0, scopeChanged: 0, failed: 0, results: [],
});

const OWNER = { id: "owner", role: "OWNER" as UserRole, active: true };
const ADMIN = { id: "admin", role: "ADMIN" as UserRole, active: true };

async function main() {
  // T1 — OWNER + BRANCH_MANAGER con branchId
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "bm1", role: "BRANCH_MANAGER", branchId: "b1" },
      client: mockClient(OWNER), ip: "1.1.1.1", userAgent: "UA", applyFn: fn,
    });
    assert("T1 carga actor + llama applyFn 1×", calls.length === 1);
    assert("T1 source=DEFAULT_NEW_USER", calls[0].source === "DEFAULT_NEW_USER");
    assert("T1 batchId ausente/undefined", calls[0].batchId === undefined);
    assert("T1 targetUserId/role propagados", calls[0].targetUserId === "bm1" && calls[0].role === "BRANCH_MANAGER");
    assert("T1 actor cargado pasado al motor", calls[0].actor?.id === "owner" && calls[0].actor?.active === true);
    assert("T1 ip/userAgent propagados", calls[0].ip === "1.1.1.1" && calls[0].userAgent === "UA");
    assert("T1 result ok + totales normalizados", r.ok === true && r.source === "DEFAULT_NEW_USER" && r.totalDefaults === 3 && r.granted === 3 && !r.warning);
  }

  // T2 — OWNER + SUPERVISOR sin branchId
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "sup1", role: "SUPERVISOR", branchId: null },
      client: mockClient(OWNER), ip: "2.2.2.2", userAgent: "UA2", applyFn: fn,
    });
    assert("T2 llama applyFn, source DEFAULT_NEW_USER", calls.length === 1 && calls[0].source === "DEFAULT_NEW_USER");
    assert("T2 ip/userAgent propagados", calls[0].ip === "2.2.2.2" && calls[0].userAgent === "UA2");
    assert("T2 ok", r.ok === true && r.totalDefaults === 3);
  }

  // T3 — ADMIN + BRANCH_MANAGER
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "admin", targetUser: { id: "bm2", role: "BRANCH_MANAGER", branchId: "b2" },
      client: mockClient(ADMIN), applyFn: fn,
    });
    assert("T3 actor ADMIN cargado + applyFn llamado", calls.length === 1 && calls[0].actor?.role === "ADMIN");
    assert("T3 ok", r.ok === true);
  }

  // T4 — ADMIN + SUPERVISOR
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "admin", targetUser: { id: "sup2", role: "SUPERVISOR", branchId: null },
      client: mockClient(ADMIN), applyFn: fn,
    });
    assert("T4 actor ADMIN + applyFn", calls.length === 1 && calls[0].actor?.role === "ADMIN" && r.ok === true);
  }

  // T5 — rol sin defaults → totalDefaults 0, sin warning
  {
    const { fn, calls } = mockApply(() => motorOk(0));
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "hr1", role: "HR", branchId: null },
      client: mockClient(OWNER), applyFn: fn,
    });
    assert("T5 applyFn llamado, totalDefaults=0", calls.length === 1 && r.totalDefaults === 0);
    assert("T5 ok sin warning", r.ok === true && !r.warning);
  }

  // T6 — actor ausente
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "ghost", targetUser: { id: "bm3", role: "BRANCH_MANAGER", branchId: "b3" },
      client: mockClient(null), applyFn: fn,
    });
    assert("T6 actor ausente → ok=false + warning", r.ok === false && !!r.warning);
    assert("T6 applyFn NO llamado", calls.length === 0);
    assert("T6 no throw (llegó a resultado)", r.source === "DEFAULT_NEW_USER");
  }

  // T7 — actor inactivo
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "bm4", role: "BRANCH_MANAGER", branchId: "b4" },
      client: mockClient({ id: "owner", role: "OWNER", active: false }), applyFn: fn,
    });
    assert("T7 actor inactivo → ok=false + warning", r.ok === false && !!r.warning);
    assert("T7 applyFn NO llamado", calls.length === 0);
  }

  // T8 — loadActor lanza
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "bm5", role: "BRANCH_MANAGER", branchId: "b5" },
      client: mockClient(OWNER, true), applyFn: fn,
    });
    assert("T8 loadActor throw → ok=false + warning (no throw)", r.ok === false && !!r.warning);
    assert("T8 applyFn NO llamado", calls.length === 0);
  }

  // T9 — applyFn lanza
  {
    const { fn, calls } = mockApply(() => motorOk(3), { throws: true });
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "bm6", role: "BRANCH_MANAGER", branchId: "b6" },
      client: mockClient(OWNER), applyFn: fn,
    });
    assert("T9 motor throw → ok=false + warning (no throw)", r.ok === false && !!r.warning);
    assert("T9 applyFn sí fue invocado (1)", calls.length === 1);
  }

  // T10 — motor devuelve ok=false con failed>0
  {
    const { fn } = mockApply(() => ({ ...motorOk(3, 2), ok: false, failed: 1 }));
    const r = await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "bm7", role: "BRANCH_MANAGER", branchId: "b7" },
      client: mockClient(OWNER), applyFn: fn,
    });
    assert("T10 ok=false + warning con failed preservado", r.ok === false && !!r.warning && r.warning!.failed === 1 && r.failed === 1);
  }

  // T11 — batchId nunca del backfill (DEFAULT_NEW_USER no envía batchId)
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    await applyNewUserDefaults({
      actorId: "owner", targetUser: { id: "bm8", role: "BRANCH_MANAGER", branchId: "b8" },
      client: mockClient(OWNER), applyFn: fn,
    });
    assert("T11 batchId no enviado (undefined)", calls[0].batchId === undefined);
    assert("T11 batchId != backfill batch", calls[0].batchId !== BACKFILL_BATCH);
  }

  // T12 — source siempre DEFAULT_NEW_USER
  {
    const { fn, calls } = mockApply(() => motorOk(3));
    await applyNewUserDefaults({
      actorId: "admin", targetUser: { id: "sup3", role: "SUPERVISOR", branchId: null },
      client: mockClient(ADMIN), applyFn: fn,
    });
    assert("T12 source=DEFAULT_NEW_USER en la llamada", calls.every((c) => c.source === "DEFAULT_NEW_USER"));
  }

  console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
