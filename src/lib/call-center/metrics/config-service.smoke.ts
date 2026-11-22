/**
 * SMOKE de guardar y leer la configuración contra una base Postgres LOCAL EFÍMERA (nunca
 * Neon). Datos inventados: cuentas 9001/9002, sucursales y vendedores de prueba.
 *
 *   npx tsx src/lib/call-center/metrics/config-service.smoke.ts
 */
import assert from "node:assert/strict";
import { withEphemeralDb } from "./smoke-db";
import type { CallCenterMetricsConfigData, WeekSchedule } from "./config-schema";

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const week = (from: string, to: string): WeekSchedule => {
  const d = [{ from, to }];
  return { "1": d, "2": d, "3": d, "4": d, "5": d, "6": [], "7": [] };
};

async function main() {
  await withEphemeralDb("tkl_cc_metrics_config_smoke", async (prisma) => {
    const { saveConfigVersion, loadConfigOptions, CONFIG_AUDIT_ACTION } = await import("./config-service");
    const { loadConfigVersions, configForDay } = await import("./config");

    const owner = await prisma.user.create({
      data: { email: "direccion-inventada@example.com", name: "Dirección Inventada", passwordHash: "x", role: "OWNER" },
    });
    const branchA = await prisma.branch.create({ data: { name: "Sucursal Inventada A" } });
    const branchB = await prisma.branch.create({ data: { name: "Sucursal Inventada B" } });

    const data = (over: Partial<CallCenterMetricsConfigData> = {}): CallCenterMetricsConfigData => ({
      schemaVersion: 1, publicHours: week("10:00", "18:00"), operatorHours: week("09:00", "19:00"),
      firstResponseGoalMinutes: 15,
      accounts: [{ externalId: "9001", alias: "Cuenta inventada", active: true, borrowed: false, historical: false }],
      callCenterVendors: [{ branchId: branchA.id, code: "V01" }],
      ...over,
    });

    await check("guardar: crea la versión y su registro de auditoría, sin copiar los valores", async () => {
      const r = await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-03-01", data: data() });
      assert.equal(r.ok, true);
      const rows = await prisma.callCenterMetricsConfig.findMany();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].createdByUserId, owner.id);
      assert.equal(rows[0].validFrom.toISOString().slice(0, 10), "2026-03-01");
      const audit = await prisma.auditLog.findMany({ where: { action: CONFIG_AUDIT_ACTION } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].entityId, rows[0].id);
      assert.deepEqual(audit[0].detail, { validFrom: "2026-03-01", firstResponseGoalMinutes: 15, accounts: 1, callCenterVendors: 1 });
      assert.ok(!JSON.stringify(audit[0].detail).includes("9001"), "la auditoría no lleva los números de cuenta");
    });

    await check("guardar otra vez no edita: agrega una versión; la vigencia elige la que corresponde a cada día", async () => {
      const r = await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-06-01", data: data({ firstResponseGoalMinutes: 20 }) });
      assert.equal(r.ok, true);
      assert.equal(await prisma.callCenterMetricsConfig.count(), 2);
      const { versions, invalid } = await loadConfigVersions();
      assert.equal(versions.length, 2);
      assert.deepEqual(invalid, []);
      assert.equal(configForDay(versions, "2026-05-31")?.data.firstResponseGoalMinutes, 15);
      assert.equal(configForDay(versions, "2026-06-01")?.data.firstResponseGoalMinutes, 20);
      assert.equal(configForDay(versions, "2026-02-28"), null);
    });

    await check("datos inválidos o fecha inválida: no guarda nada y devuelve los errores", async () => {
      const before = await prisma.callCenterMetricsConfig.count();
      const auditBefore = await prisma.auditLog.count();
      const malo = await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-07-01", data: { ...data(), firstResponseGoalMinutes: 0 } });
      assert.equal(malo.ok, false);
      const fecha = await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-02-30", data: data() });
      assert.ok(!fecha.ok && fecha.errors.some((e) => e.startsWith("validFrom")));
      const basura = await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-07-01", data: "no es un objeto" });
      assert.equal(basura.ok, false);
      assert.equal(await prisma.callCenterMetricsConfig.count(), before);
      assert.equal(await prisma.auditLog.count(), auditBefore);
    });

    await check("vendedor con una sucursal que no existe: no guarda", async () => {
      const before = await prisma.callCenterMetricsConfig.count();
      const r = await saveConfigVersion(prisma, {
        actorUserId: owner.id, validFrom: "2026-07-01",
        data: data({ callCenterVendors: [{ branchId: "sucursal-que-no-existe", code: "V01" }] }),
      });
      assert.ok(!r.ok && r.errors.some((e) => e.startsWith("callCenterVendors")));
      assert.equal(await prisma.callCenterMetricsConfig.count(), before);
    });

    await check("una fila con JSON que no valida se descarta al leer y se informa por id", async () => {
      const bad = await prisma.callCenterMetricsConfig.create({ data: { validFrom: new Date("2026-09-01T00:00:00Z"), data: { roto: true } } });
      const { versions, invalid } = await loadConfigVersions();
      assert.equal(versions.length, 2);
      assert.deepEqual(invalid, [bad.id]);
      assert.equal(configForDay(versions, "2026-09-15")?.data.firstResponseGoalMinutes, 20); // sigue rigiendo la anterior válida
      await prisma.callCenterMetricsConfig.delete({ where: { id: bad.id } });
    });

    await check("guardar con cuentas de sistema: el campo se conserva al leer; las versiones anteriores sin él siguen leyéndose", async () => {
      const r = await saveConfigVersion(prisma, {
        actorUserId: owner.id, validFrom: "2026-08-01",
        data: data({ accounts: [
          { externalId: "9001", alias: null, active: true, borrowed: false, historical: false, system: false },
          { externalId: "9037", alias: "Asignación automática inventada", active: true, borrowed: false, historical: false, system: true },
        ] }),
      });
      assert.equal(r.ok, true);
      const { versions, invalid } = await loadConfigVersions();
      assert.deepEqual(invalid, []);
      assert.equal(versions.length, 3);
      const nueva = configForDay(versions, "2026-08-15")!;
      assert.deepEqual(nueva.data.accounts.map((a) => a.system), [false, true]);
      const vieja = configForDay(versions, "2026-03-15")!;
      assert.equal(vieja.data.accounts[0].system, undefined);
      if (r.ok) await prisma.callCenterMetricsConfig.delete({ where: { id: r.id } });
    });

    await check("auditoría por rol: guardan Administrador y Supervisión, y cada versión queda a nombre de quien la guardó", async () => {
      const admin = await prisma.user.create({ data: { email: "admin-inventado@example.com", name: "Administrador Inventado", passwordHash: "x", role: "ADMIN" } });
      const supervisor = await prisma.user.create({ data: { email: "supervision-inventada@example.com", name: "Supervisión Inventada", passwordHash: "x", role: "SUPERVISOR" } });
      const creadas: string[] = [];
      for (const [actor, validFrom] of [[admin, "2026-10-01"], [supervisor, "2026-10-15"], [owner, "2026-10-20"]] as const) {
        const r = await saveConfigVersion(prisma, { actorUserId: actor.id, validFrom, data: data() });
        assert.equal(r.ok, true);
        if (!r.ok) continue;
        creadas.push(r.id);
        const row = await prisma.callCenterMetricsConfig.findUnique({ where: { id: r.id } });
        assert.equal(row!.createdByUserId, actor.id, `${actor.role}: autor de la versión`);
        const audit = await prisma.auditLog.findMany({ where: { action: CONFIG_AUDIT_ACTION, entityId: r.id }, include: { user: { select: { role: true } } } });
        assert.equal(audit.length, 1, `${actor.role}: una fila de auditoría`);
        assert.equal(audit[0].userId, actor.id, `${actor.role}: la auditoría queda a su nombre`);
        assert.equal(audit[0].user.role, actor.role);
        assert.equal((audit[0].detail as { validFrom: string }).validFrom, validFrom);
      }
      // Se quitan para no alterar las comprobaciones siguientes; la auditoría se conserva.
      await prisma.callCenterMetricsConfig.deleteMany({ where: { id: { in: creadas } } });
    });

    await check("opciones del formulario: cuentas que escribieron o figuran asignadas, y vendedores por sucursal con ventas recientes", async () => {
      const customer = await prisma.customer.create({ data: { phone: "+5491100000001" } });
      const conv = await prisma.conversation.create({ data: { customerId: customer.id, status: "RESUELTA", source: "EMOZION" } });
      const now = Date.now();
      const msg = (author: "OPERATOR" | "CUSTOMER" | "BOT", sender: string | null, daysAgo: number, n: number) =>
        prisma.conversationMessage.create({ data: { conversationId: conv.id, author, externalSenderId: sender, body: "x", sentAt: new Date(now - daysAgo * 86_400_000), externalMessageId: `cfg-${n}` } });
      await msg("OPERATOR", "9001", 1, 1);
      await msg("OPERATOR", "9001", 50, 2);
      await msg("OPERATOR", "9002", 100, 3);
      await msg("CUSTOMER", "777", 1, 4); // no es una cuenta de operador
      await msg("BOT", "1", 1, 5);

      const day = (daysAgo: number) => new Date(new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10) + "T00:00:00.000Z");
      const snap = (branchId: string, daysAgo: number, vendedores: unknown) =>
        prisma.salesSnapshot.create({ data: { branchId, snapshotDate: day(daysAgo), totalSales: 0, units: 0, receipts: 0, avgTicket: 0, dataSource: "siaf", rawData: { vendedores } as never } });
      await snap(branchA.id, 2, [{ codigo: "V01", nombre: "Vendedor Inventado Uno" }, { codigo: "V02", nombre: "Vendedor Inventado Dos" }]);
      await snap(branchA.id, 5, [{ codigo: "V01", nombre: "Nombre Viejo" }]);
      await snap(branchB.id, 3, [{ codigo: "V01", nombre: "Otro Inventado" }]);
      await snap(branchB.id, 200, [{ codigo: "V09", nombre: "Demasiado Viejo" }]); // fuera de la ventana
      await snap(branchB.id, 4, null);                                              // sin detalle de vendedores

      // Asignadas: 9001 escribió y además figura asignada; 9037 y 9040 aparecen SOLO como asignadas
      // (una en la conversación, otra en un cambio de estado).
      await prisma.conversation.update({ where: { id: conv.id }, data: { externalAssigneeId: "9037" } });
      await prisma.conversationStateHistory.create({ data: { conversationId: conv.id, fromStatus: "PENDIENTE", toStatus: "ASIGNADA", externalAssigneeId: "9001" } });
      await prisma.conversationStateHistory.create({ data: { conversationId: conv.id, fromStatus: "ASIGNADA", toStatus: "RESUELTA", externalAssigneeId: "9040" } });
      await prisma.conversationStateHistory.create({ data: { conversationId: conv.id, fromStatus: "RESUELTA", toStatus: "SIN_ASIGNAR" } }); // sin asignado

      const { accounts, vendors } = await loadConfigOptions(prisma);
      assert.deepEqual(accounts.map((a) => a.externalId), ["9001", "9002", "9037", "9040"]);
      assert.equal(accounts[0].messagesLast30Days, 1);
      assert.equal(accounts[1].messagesLast30Days, 0);
      assert.deepEqual(accounts.map((a) => a.onlySeenAsAssignee), [false, false, true, true]);
      assert.ok(accounts[0].lastAssignedDay, "9001 escribió y además figura asignada");
      assert.equal(accounts[1].lastAssignedDay, null);
      assert.deepEqual([accounts[2].firstMessageDay, accounts[2].lastMessageDay, accounts[2].messagesLast30Days], [null, null, 0]);
      assert.ok(accounts[2].lastAssignedDay && accounts[3].lastAssignedDay);
      assert.equal(accounts.some((a) => a.externalId === "777" || a.externalId === "1"), false, "cliente y bot no son cuentas");
      assert.equal(vendors.length, 3);
      const a1 = vendors.find((v) => v.branchId === branchA.id && v.code === "V01")!;
      assert.equal(a1.name, "Vendedor Inventado Uno"); // el nombre más reciente
      assert.equal(a1.branchName, "Sucursal Inventada A");
      assert.ok(vendors.some((v) => v.branchId === branchB.id && v.code === "V01"), "el mismo código en otra sucursal es otro vendedor");
      assert.equal(vendors.some((v) => v.code === "V09"), false);
    });
  });

  console.log(`\nmetrics/config-service.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
