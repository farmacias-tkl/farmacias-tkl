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

const BANKS = ["Galicia", "BBVA", "Santander", "Macro", "Nación", "Provincia", "HSBC"];
const ACCOUNT_TYPES = ["Cta. Corriente", "Caja de Ahorro", "Cta. USD"];

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
  console.log("🌱 Seed demo — Dashboard Ejecutivo\n");

  // ─── Cleanup ─────────────────────────────────────────────
  console.log("🧹 Limpiando datos demo previos...");
  const delBalance = await prisma.bankBalanceSnapshot.deleteMany({ where: { sourceSheet: "DEMO" } });
  const delSales   = await prisma.salesSnapshot.deleteMany({       where: { dataSource:  "demo" } });
  const delLogs    = await prisma.syncLog.deleteMany({             where: { message: { startsWith: "[DEMO]" } } });
  console.log(`   ✓ BankBalanceSnapshot borrados: ${delBalance.count}`);
  console.log(`   ✓ SalesSnapshot borrados:       ${delSales.count}`);
  console.log(`   ✓ SyncLog borrados:             ${delLogs.count}\n`);

  // ─── Cargar branches ─────────────────────────────────────
  const branches = await prisma.branch.findMany({
    where:  { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`📍 ${branches.length} sucursales activas detectadas\n`);

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

  // ─── Saldos bancarios ────────────────────────────────────
  console.log("💰 Generando saldos bancarios...");
  const balanceData: Prisma.BankBalanceSnapshotCreateManyInput[] = [];
  for (const branch of branches) {
    const accountCount = randInt(2, 4);
    const branchBanks  = pickN(BANKS, accountCount);

    for (const bankName of branchBanks) {
      const accountLabel = `${bankName} - ${ACCOUNT_TYPES[randInt(0, ACCOUNT_TYPES.length - 1)]}`;
      let prevBalance = rand(500_000, 8_000_000);

      for (const day of balanceDays) {
        const variation   = rand(-0.15, 0.15); // +/- 5-15%
        const newBalance  = Math.max(100_000, prevBalance * (1 + variation));
        const hasChecks   = Math.random() > 0.5;
        balanceData.push({
          branchId:     branch.id,
          bankName,
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
  }
  await prisma.bankBalanceSnapshot.createMany({ data: balanceData });
  console.log(`   ✓ ${balanceData.length} saldos bancarios insertados\n`);

  // ─── Ventas ──────────────────────────────────────────────
  console.log("🛒 Generando ventas...");
  const salesData: Prisma.SalesSnapshotCreateManyInput[] = [];
  for (const branch of branches) {
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
      message:       `[DEMO] Sincronización exitosa — ${branches.length} sucursales, ${rowsPerDay} saldos procesados`,
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
  console.log(`   Sucursales:          ${branches.length.toString().padStart(5)}`);
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
