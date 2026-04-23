/**
 * seed-demo-data.ts — Datos ficticios realistas para demo del Dashboard Ejecutivo.
 *
 * Genera 30 días de saldos bancarios y ventas por sucursal, más 5 sync logs.
 *
 * Idempotente: borra datos demo previos identificados por:
 *   - BankBalanceSnapshot.sourceSheet = "DEMO"
 *   - SalesSnapshot.dataSource = "demo"
 *   - SyncLog.message LIKE "[DEMO]%"
 *
 * Uso: npx tsx scripts/seed-demo-data.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Estructura fija de cuentas bancarias por sucursal — NO random, NO pickN.
// Esto garantiza que cada run del seed produzca exactamente la misma shape,
// evitando que se acumulen variantes entre ejecuciones repetidas.
const BRANCH_ACCOUNTS: Record<string, Array<{ bank: string; type: string; baseBalance: number }>> = {
  "Tekiel":         [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 4_500_000 },
    { bank: "BBVA",      type: "Caja de Ahorro", baseBalance: 2_800_000 },
    { bank: "Santander", type: "Cta. USD",       baseBalance: 1_400_000 },
  ],
  "San Miguel":     [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 3_800_000 },
    { bank: "Macro",     type: "Caja de Ahorro", baseBalance: 2_100_000 },
    { bank: "HSBC",      type: "Cta. Corriente", baseBalance: 1_500_000 },
  ],
  "Galesa":         [
    { bank: "Nación",    type: "Cta. Corriente", baseBalance: 3_200_000 },
    { bank: "BBVA",      type: "Caja de Ahorro", baseBalance: 1_800_000 },
    { bank: "Santander", type: "Cta. USD",       baseBalance: 900_000 },
  ],
  "Call Center":    [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 2_500_000 },
    { bank: "Nación",    type: "Caja de Ahorro", baseBalance: 1_200_000 },
  ],
  "La Perla":       [
    { bank: "BBVA",      type: "Cta. Corriente", baseBalance: 2_200_000 },
    { bank: "Santander", type: "Caja de Ahorro", baseBalance: 1_400_000 },
    { bank: "Macro",     type: "Cta. Corriente", baseBalance: 800_000 },
  ],
  "Larcade":        [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 2_000_000 },
    { bank: "Provincia", type: "Caja de Ahorro", baseBalance: 900_000 },
  ],
  "Quintana":       [
    { bank: "BBVA",      type: "Cta. Corriente", baseBalance: 1_800_000 },
    { bank: "HSBC",      type: "Caja de Ahorro", baseBalance: 750_000 },
  ],
  "Facultad":       [
    { bank: "Santander", type: "Cta. Corriente", baseBalance: 1_500_000 },
    { bank: "Nación",    type: "Caja de Ahorro", baseBalance: 800_000 },
    { bank: "Galicia",   type: "Cta. USD",       baseBalance: 500_000 },
  ],
  "Naveira":        [
    { bank: "BBVA",      type: "Cta. Corriente", baseBalance: 1_300_000 },
    { bank: "Macro",     type: "Caja de Ahorro", baseBalance: 700_000 },
    { bank: "Provincia", type: "Cta. Corriente", baseBalance: 600_000 },
  ],
  "America":        [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 1_200_000 },
    { bank: "HSBC",      type: "Caja de Ahorro", baseBalance: 700_000 },
    { bank: "Nación",    type: "Cta. Corriente", baseBalance: 550_000 },
  ],
  "Etcheverry":     [
    { bank: "Santander", type: "Cta. Corriente", baseBalance: 1_100_000 },
    { bank: "Provincia", type: "Caja de Ahorro", baseBalance: 600_000 },
  ],
  "San Agustin":    [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 1_000_000 },
    { bank: "BBVA",      type: "Caja de Ahorro", baseBalance: 550_000 },
  ],
  // Sucursales exclusivas del dashboard ejecutivo
  "Patricios":      [
    { bank: "Galicia",   type: "Cta. Corriente", baseBalance: 1_800_000 },
    { bank: "Nación",    type: "Caja de Ahorro", baseBalance: 900_000 },
  ],
  "Condominio ET":  [
    { bank: "BBVA",      type: "Cta. Corriente", baseBalance: 3_200_000 },
    { bank: "HSBC",      type: "Cta. USD",       baseBalance: 1_500_000 },
  ],
};

// Niveles de ventas diarias base por sucursal (en millones de ARS)
const BRANCH_TIERS: Record<string, number> = {
  "Tekiel":      4.0,
  "San Miguel":  3.8,
  "Galesa":      3.5,
  "Call Center": 3.0,
  "La Perla":    2.5,
  "Larcade":     2.3,
  "Quintana":    2.2,
  "Facultad":    1.8,
  "Naveira":     1.6,
  "America":     1.4,
  "Etcheverry":  1.3,
  "San Agustin": 1.2,
};

// Multiplicadores por día de la semana (0=domingo, 6=sábado)
const DOW_MULT: Record<number, number> = {
  0: 0.15,  // domingo
  1: 0.88,  // lunes
  2: 0.95,
  3: 1.00,
  4: 1.06,
  5: 1.20,  // viernes peak
  6: 1.10,  // sábado
};

const rand    = (min: number, max: number) => Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
function pickN<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

async function main() {
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log("🌱 Seed demo — Dashboard Ejecutivo");
  console.log(`   → Target DB host: ${host}\n`);

  // ─── Cleanup ─────────────────────────────────────────────
  console.log("🧹 Limpiando datos demo previos...");
  const delBalance = await prisma.bankBalanceSnapshot.deleteMany({ where: { sourceSheet: "DEMO" } });
  const delSales   = await prisma.salesSnapshot.deleteMany({       where: { dataSource:  "demo" } });
  const delLogs    = await prisma.syncLog.deleteMany({             where: { message: { startsWith: "[DEMO]" } } });
  console.log(`   ✓ BankBalanceSnapshot borrados: ${delBalance.count}`);
  console.log(`   ✓ SalesSnapshot borrados:       ${delSales.count}`);
  console.log(`   ✓ SyncLog borrados:             ${delLogs.count}\n`);

  // ─── Cargar branches ─────────────────────────────────────
  // allBranches: todas las activas (para balances — incluye Patricios, Condominio ET)
  // salesBranches: solo showInOperative=true (para ventas — excluye exec-only)
  const allBranches = await prisma.branch.findMany({
    where:  { active: true },
    select: { id: true, name: true, showInOperative: true },
    orderBy: { name: "asc" },
  });
  const salesBranches = allBranches.filter((b) => b.showInOperative !== false);
  console.log(`📍 ${allBranches.length} sucursales activas (${salesBranches.length} con ventas; ${allBranches.length - salesBranches.length} solo balance)\n`);

  // ─── Rangos de fechas ────────────────────────────────────
  // Balances: últimos 30 días (no se muestran históricos en UI)
  // Ventas:   24 meses hacia atrás (para comparativo YoY completo en 3m/6m/12m)
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const balanceDays: Date[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    balanceDays.push(d);
  }

  const salesStart = new Date(today);
  salesStart.setMonth(salesStart.getMonth() - 24);
  const salesDays: Date[] = [];
  for (let d = new Date(salesStart); d <= today; d.setDate(d.getDate() + 1)) {
    salesDays.push(new Date(d));
  }

  // ─── Saldos bancarios (estructura fija por sucursal) ─────
  console.log("💰 Generando saldos bancarios...");
  const balanceData: Prisma.BankBalanceSnapshotCreateManyInput[] = [];
  let branchesWithAccounts = 0;
  let branchesSkipped      = 0;

  for (const branch of allBranches) {
    const accounts = BRANCH_ACCOUNTS[branch.name];
    if (!accounts) {
      console.log(`   ⚠  Sin config de cuentas para "${branch.name}" — skip`);
      branchesSkipped++;
      continue;
    }

    for (const acct of accounts) {
      const accountLabel = `${acct.bank} - ${acct.type}`;
      let prevBalance = acct.baseBalance;

      for (const day of balanceDays) {
        const variation  = rand(-0.15, 0.15); // +/- 5-15% día a día (único random que queda)
        const newBalance = Math.max(100_000, prevBalance * (1 + variation));
        const hasChecks  = Math.random() > 0.5;
        balanceData.push({
          branchId:     branch.id,
          bankName:     acct.bank,
          accountLabel,
          balance:      Math.round(newBalance),
          checks:       hasChecks ? Math.round(rand(50_000, 500_000)) : null,
          prevBalance:  Math.round(prevBalance),
          snapshotDate: day,
          sourceSheet:  "DEMO",
        });
        prevBalance = newBalance;
      }
    }
    branchesWithAccounts++;
  }
  await prisma.bankBalanceSnapshot.createMany({ data: balanceData });
  console.log(`   ✓ ${balanceData.length} saldos bancarios insertados (${branchesWithAccounts} sucursales con cuentas, ${branchesSkipped} sin config)\n`);

  // ─── Ventas — solo para branches con showInOperative=true ─
  console.log("🛒 Generando ventas...");
  const salesData: Prisma.SalesSnapshotCreateManyInput[] = [];
  for (const branch of salesBranches) {
    const tier      = BRANCH_TIERS[branch.name] ?? 1.5;
    const baseSales = tier * 1_000_000;

    for (const day of salesDays) {
      const dow     = day.getDay();
      const dowMult = DOW_MULT[dow] ?? 1.0;

      // Domingo: 50% de probabilidad de sin datos
      if (dow === 0 && Math.random() > 0.5) continue;

      // Volumen escalonado por año — crecimiento ~18-21% YoY realista
      //   2024 →  70% (2 años atrás)
      //   2025 →  85% (1 año atrás)
      //   2026 → 100% (actual)
      const year       = day.getFullYear();
      const yearMult   = year < 2025 ? 0.70 : year < 2026 ? 0.85 : 1.0;
      const noise      = rand(0.85, 1.15);
      const totalSales = Math.round(baseSales * dowMult * noise * yearMult);
      const units      = Math.max(1, Math.round(rand(80, 400) * dowMult));
      const receipts   = Math.max(1, Math.round(rand(60, 300) * dowMult));
      const avgTicket  = Math.round(totalSales / receipts);

      salesData.push({
        branchId:     branch.id,
        snapshotDate: day,
        totalSales,
        units,
        receipts,
        avgTicket,
        rawData:      { source: "demo", generated: true } as Prisma.InputJsonValue,
        dataSource:   "demo",
      });
    }
  }
  await prisma.salesSnapshot.createMany({ data: salesData });
  console.log(`   ✓ ${salesData.length} registros de ventas insertados\n`);

  // ─── Sync logs (últimos 5 días) ──────────────────────────
  console.log("📋 Generando sync logs...");
  const syncData: Prisma.SyncLogCreateManyInput[] = [];
  const rowsPerDay = Math.floor(balanceData.length / balanceDays.length);
  for (let i = 4; i >= 0; i--) {
    const day       = new Date(today); day.setDate(day.getDate() - i);
    const createdAt = new Date(day);
    createdAt.setHours(9, randInt(0, 30), randInt(0, 59), 0);

    syncData.push({
      source:        "GOOGLE_DRIVE",
      status:        "SUCCESS",
      message:       `[DEMO] Sincronización exitosa — ${allBranches.length} sucursales, ${rowsPerDay} saldos procesados`,
      rowsProcessed: rowsPerDay,
      durationMs:    randInt(2500, 5500),
      syncDate:      day,
      triggeredBy:   "CRON",
      createdAt,
    });
  }
  await prisma.syncLog.createMany({ data: syncData });
  console.log(`   ✓ ${syncData.length} sync logs insertados\n`);

  // ─── Resumen final ───────────────────────────────────────
  console.log("═".repeat(55));
  console.log("✅ Demo data insertada:");
  console.log(`   BankBalanceSnapshot: ${balanceData.length.toString().padStart(5)}`);
  console.log(`   SalesSnapshot:       ${salesData.length.toString().padStart(5)}`);
  console.log(`   SyncLog:             ${syncData.length.toString().padStart(5)}`);
  console.log(`   Sucursales:          ${allBranches.length.toString().padStart(5)}`);
  console.log(`   Rango balances:      ${balanceDays[0].toLocaleDateString("es-AR")}  →  ${balanceDays[balanceDays.length - 1].toLocaleDateString("es-AR")}`);
  console.log(`   Rango ventas:        ${salesDays[0].toLocaleDateString("es-AR")}  →  ${salesDays[salesDays.length - 1].toLocaleDateString("es-AR")}`);
  console.log("═".repeat(55));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Error:", e);
  prisma.$disconnect();
  process.exit(1);
});
