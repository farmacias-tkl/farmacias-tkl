/**
 * SMOKE de la consulta de ventas por vendedor contra una base Postgres LOCAL EFÍMERA (nunca
 * Neon), y del informe de punta a punta con dos versiones de configuración. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/sales.smoke.ts
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
const EMPTY: WeekSchedule = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };

async function main() {
  await withEphemeralDb("tkl_cc_metrics_sales_smoke", async (prisma) => {
    const { loadVendorSalesRows, buildSalesReport } = await import("./sales");
    const { saveConfigVersion } = await import("./config-service");
    const { loadConfigVersions } = await import("./config");

    const owner = await prisma.user.create({ data: { email: "direccion-inventada@example.com", name: "Dirección Inventada", passwordHash: "x", role: "OWNER" } });
    const a = await prisma.branch.create({ data: { name: "Sucursal Inventada A" } });
    const b = await prisma.branch.create({ data: { name: "Sucursal Inventada B" } });
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const snap = (branchId: string, iso: string, vendedores: unknown) =>
      prisma.salesSnapshot.create({ data: { branchId, snapshotDate: day(iso), totalSales: 0, units: 0, receipts: 0, avgTicket: 0, dataSource: "siaf", rawData: { vendedores } as never } });
    const v = (codigo: string, ventas: number, tickets: number, descuentos = 0, unidades = tickets) => ({ codigo, nombre: `Vendedor Inventado ${codigo}`, ventas, tickets, descuentos, unidades });

    // V02 de la sucursal A vende todos los días, pero entra al Call Center recién el 10/03.
    await snap(a.id, "2026-03-08", [v("V01", 1000, 4), v("V02", 100, 1), v("V09", 9999, 50)]);
    await snap(a.id, "2026-03-09", [v("V01", 1000, 4), v("V02", 200, 2)]);
    await snap(a.id, "2026-03-10", [v("V01", 1000, 4, 50), v("V02", 400, 3)]);
    await snap(a.id, "2026-03-11", [v("V02", 800, 5), v("V01", -300, 1)]); // nota de crédito
    await snap(b.id, "2026-03-09", [v("V01", 70, 1)]);
    await snap(b.id, "2026-03-10", [v("V01", 70, 1)]);
    await snap(b.id, "2026-03-11", null);                 // día sin detalle de vendedores
    await snap(b.id, "2026-03-12", [{ nombre: "Sin código", ventas: 5, tickets: 1 }]); // sin código: se ignora
    await snap(a.id, "2026-03-20", [v("V01", 1, 1)]);     // fuera del período

    const cfg = (vendors: CallCenterMetricsConfigData["callCenterVendors"]): CallCenterMetricsConfigData => ({
      schemaVersion: 1, publicHours: EMPTY, operatorHours: EMPTY, firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: vendors,
    });
    await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-03-01", data: cfg([{ branchId: a.id, code: "V01" }, { branchId: b.id, code: "V01" }]) });
    await saveConfigVersion(prisma, { actorUserId: owner.id, validFrom: "2026-03-10", data: cfg([{ branchId: a.id, code: "V01" }, { branchId: a.id, code: "V02" }]) });
    const { versions } = await loadConfigVersions();

    const rows = await loadVendorSalesRows("2026-03-08", "2026-03-12");

    await check("la consulta trae todos los vendedores del período con sus importes; sin código o sin detalle no generan filas", () => {
      assert.equal(rows.length, 11);
      assert.equal(rows.some((r) => r.day === "2026-03-20"), false);
      const r = rows.find((x) => x.day === "2026-03-10" && x.branchId === a.id && x.code === "V01")!;
      assert.deepEqual([r.gross, r.receipts, r.discounts, r.units, r.branchName], [1000, 4, 50, 4, "Sucursal Inventada A"]);
      assert.equal(typeof r.gross, "number");
    });

    const rep = buildSalesReport(rows, { from: "2026-03-08", to: "2026-03-12", versions });

    await check("de punta a punta: V02 de A suma solo desde el 10/03", () => {
      const v02 = rep.byVendor.find((x) => x.branchId === a.id && x.code === "V02")!;
      assert.deepEqual([v02.gross, v02.receipts, v02.days, v02.firstDay], [1200, 8, 2, "2026-03-10"]);
    });
    await check("de punta a punta: V01 de B deja de sumar el 10/03; un vendedor que no es del Call Center nunca suma", () => {
      const v01b = rep.byVendor.find((x) => x.branchId === b.id && x.code === "V01")!;
      assert.deepEqual([v01b.gross, v01b.lastDay], [70, "2026-03-09"]);
      assert.equal(rep.byVendor.some((x) => x.code === "V09"), false);
    });
    await check("totales: con la nota de crédito restando y las dos versiones usadas", () => {
      // A·V01: 1000+1000+1000-300 = 2700 · A·V02: 400+800 = 1200 · B·V01: 70
      assert.equal(rep.total.gross, 3970);
      assert.equal(rep.total.receipts, 4 + 4 + 4 + 1 + 3 + 5 + 1);
      assert.equal(rep.total.discounts, 50);
      assert.deepEqual(rep.configVersionsUsed.map((x) => x.validFrom), ["2026-03-01", "2026-03-10"]);
      assert.deepEqual(rep.daysWithoutConfig, []);
      assert.equal(rep.lastLoadedDay, "2026-03-11");
    });
    await check("respuesta de la API: la nota de crédito del 11/03 queda señalada y hay caché por período", async () => {
      const { getSalesPayload } = await import("./sales-service");
      const now = new Date("2026-03-13T15:00:00.000Z");
      const p = await getSalesPayload("2026-03-08", "2026-03-12", now);
      assert.deepEqual([p.total.gross, p.negativeVendorDays, p.hasConfig], [3970, 1, true]);
      // El último día cargado se busca en toda la base (20/03), no solo en el período.
      assert.deepEqual([p.siafLastDay, p.siafDelayed, p.daysNotLoaded, p.relationDays], ["2026-03-20", false, [], 4]);
      // Sin conversaciones cargadas no hay pedidos: la relación queda sin dato, no en cero.
      assert.deepEqual([p.orders, p.receiptsPer100Orders], [0, null]);
      assert.equal(p.byDay.every((d) => d.receiptsPer100Orders === null), true);
      assert.equal(await getSalesPayload("2026-03-08", "2026-03-12", new Date(now.getTime() + 30_000)), p);
      assert.notEqual(await getSalesPayload("2026-03-08", "2026-03-12", new Date(now.getTime() + 61_000)), p);
    });
    await check("el registro de la vista se puede guardar como VIEW_CALL_CENTER_SALES", async () => {
      await prisma.accessLog.create({ data: { userId: owner.id, action: "VIEW_CALL_CENTER_SALES", ipAddress: "203.0.113.7", userAgent: "prueba" } });
      assert.equal(await prisma.accessLog.count({ where: { userId: owner.id, action: "VIEW_CALL_CENTER_SALES" } }), 1);
    });
  });

  console.log(`\nmetrics/sales.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
