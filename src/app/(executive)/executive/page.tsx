import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ExecutiveDashboard } from "@/components/executive/ExecutiveDashboard";
import { ComparativeSection } from "@/components/executive/ComparativeSection";
import { getArtToday, parseArtDate, isFutureArtDate } from "@/lib/dates/executive";

export const revalidate = 300;

export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: { branch?: string; date?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const branchId = searchParams.branch ?? "ALL";

  // Resolución de la fecha de consulta:
  //   - Si ?date= es válida y no futura → modo consulta histórica.
  //   - Si ?date= es inválida o futura → ignoramos (volvemos al default "hoy").
  //   - Si no hay ?date= → modo default, fallback al último disponible.
  const today = getArtToday();
  const parsedRequested = parseArtDate(searchParams.date);
  const requestedDate = parsedRequested && !isFutureArtDate(parsedRequested)
    ? parsedRequested
    : null;
  const anchor = requestedDate ?? today;
  const yesterdayArt = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  // Convención del negocio: las VENTAS del dashboard reflejan el cierre del
  // DÍA ANTERIOR al anchor.
  //   - Modo default (anchor=today): la query inicial contra today queda
  //     vacía y cae al fallback "latestSales" que típicamente devuelve ayer.
  //   - Modo histórico (anchor=?date=): el fallback está deshabilitado por
  //     diseño. Hay que ir contra anchor-1 explícitamente para no traer las
  //     ventas del propio día del anchor (= snapshot recién cargado por la
  //     mañana, no es lo que el negocio quiere ver).
  // Los SALDOS sí van contra anchor directo — son el snapshot de esa mañana.
  const salesQueryDate = requestedDate !== null
    ? new Date(anchor.getTime() - 24 * 60 * 60 * 1000)
    : anchor;

  // --- SALDOS ---
  const balanceWhere = {
    snapshotDate: anchor,
    ...(branchId !== "ALL" && { branchId }),
    branch: { showInExecutive: true },
  };
  let balances = await prisma.bankBalanceSnapshot.findMany({
    where: balanceWhere,
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ branch: { name: "asc" } }, { bankName: "asc" }],
  });
  let isStaleBalances = false;

  // Fallback al último disponible SOLO en modo default (sin ?date= explícita).
  // Si el usuario pidió una fecha concreta, mostramos vacío en vez de
  // confundirlo con datos de otro día.
  if (balances.length === 0 && requestedDate === null) {
    const latestBalance = await prisma.bankBalanceSnapshot.findFirst({
      where: branchId !== "ALL"
        ? { branchId }
        : { branch: { showInExecutive: true } },
      orderBy: { snapshotDate: "desc" },
      select:  { snapshotDate: true },
    });
    if (latestBalance) {
      balances = await prisma.bankBalanceSnapshot.findMany({
        where: {
          snapshotDate: latestBalance.snapshotDate,
          ...(branchId !== "ALL"
            ? { branchId }
            : { branch: { showInExecutive: true } }),
        },
        include: { branch: { select: { id: true, name: true } } },
        orderBy: [{ branch: { name: "asc" } }, { bankName: "asc" }],
      });
    }
    isStaleBalances = true;
  }

  // --- VENTAS ---
  const salesBranchFilter = {
    ...(branchId !== "ALL" && { branchId }),
    branch: { showInExecutive: true, showInOperative: true },
  };
  let sales = await prisma.salesSnapshot.findMany({
    where: { snapshotDate: salesQueryDate, ...salesBranchFilter },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
  let isStaleSales = false;
  let salesDate = salesQueryDate;
  if (sales.length === 0 && requestedDate === null) {
    const latestSales = await prisma.salesSnapshot.findFirst({
      where: salesBranchFilter,
      orderBy: { snapshotDate: "desc" },
      select:  { snapshotDate: true },
    });
    if (latestSales) {
      salesDate = latestSales.snapshotDate;
      sales = await prisma.salesSnapshot.findMany({
        where: { snapshotDate: latestSales.snapshotDate, ...salesBranchFilter },
        include: { branch: { select: { id: true, name: true } } },
        orderBy: { branch: { name: "asc" } },
      });
    }
    isStaleSales = true;
  }
  // Stale "legítimo" SOLO en modo default. Si la última fecha es de ayer
  // (cierre normal del día anterior), no es stale. Solo si es anterior.
  if (isStaleSales && sales.length > 0 && salesDate.getTime() >= yesterdayArt.getTime()) {
    isStaleSales = false;
  }
  const yesterday = new Date(salesDate); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdaySales = await prisma.salesSnapshot.findMany({
    where: { snapshotDate: yesterday, ...salesBranchFilter },
    select: { branchId: true, totalSales: true },
  });
  const yesterdayMap = Object.fromEntries(yesterdaySales.map((s) => [s.branchId, Number(s.totalSales)]));
  const branches = await prisma.branch.findMany({
    where: { active: true, showInExecutive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const lastSync = await prisma.syncLog.findFirst({
    where: { source: "GOOGLE_DRIVE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, status: true },
  });

  const totalBankBalance = balances.reduce((s, b) => s + Number(b.balance), 0);
  const totalSales       = sales.reduce((s, v) => s + Number(v.totalSales), 0);
  const totalUnits       = sales.reduce((s, v) => s + v.units, 0);
  const totalReceipts    = sales.reduce((s, v) => s + v.receipts, 0);
  const avgTicket        = totalReceipts > 0 ? totalSales / totalReceipts : 0;
  const totalYesterday   = yesterdaySales.reduce((s, v) => s + Number(v.totalSales), 0);

  // Alertas amber (stale) — SOLO en modo default. En consulta histórica los
  // estados de "no data" / "data parcial" se comunican vía DateContextBanner
  // y no se mezclan con stale.
  const alertas: string[] = [];
  if (requestedDate === null) {
    if (isStaleBalances && balances.length > 0) {
      alertas.push(`Saldos desactualizados. Último cierre disponible: ${new Date(balances[0].snapshotDate).toLocaleDateString("es-AR")}`);
    }
    if (isStaleBalances && balances.length === 0) {
      alertas.push("No hay saldos bancarios disponibles");
    }
    if (isStaleSales && sales.length > 0) {
      alertas.push(`Ventas desactualizadas. Último cierre disponible: ${new Date(salesDate).toLocaleDateString("es-AR")}`);
    }
    if (isStaleSales && sales.length === 0) {
      alertas.push("Sin datos de ventas disponibles.");
    }
  }

  const balancesByBranchMap = new Map<string, { branchId: string; branchName: string; total: number; accounts: any[] }>();
  for (const b of balances) {
    if (!balancesByBranchMap.has(b.branchId)) {
      balancesByBranchMap.set(b.branchId, { branchId: b.branchId, branchName: b.branch.name, total: 0, accounts: [] });
    }
    const e = balancesByBranchMap.get(b.branchId)!;
    e.total += Number(b.balance);
    e.accounts.push({
      bankName: b.bankName,
      accountLabel: b.accountLabel,
      balance: Number(b.balance),
      checks: b.checks ? Number(b.checks) : null,
      prevBalance: b.prevBalance ? Number(b.prevBalance) : null,
    });
  }

  const hasDataForRequestedDate = requestedDate !== null
    ? (balances.length > 0 || sales.length > 0)
    : true;

  const data = {
    date: anchor,
    isToday: anchor.getTime() === today.getTime(),
    requestedDate,
    hasDataForRequestedDate,
    branchFilter: branchId,
    kpis: {
      totalBankBalance, totalSales, totalUnits, totalReceipts, avgTicket,
      salesVariation: totalYesterday > 0 ? ((totalSales - totalYesterday) / totalYesterday) * 100 : null,
    },
    balancesByBranch: Array.from(balancesByBranchMap.values()).sort((a, b) => b.total - a.total),
    salesByBranch: sales.map((s) => ({
      branchId: s.branchId, branchName: s.branch.name,
      totalSales: Number(s.totalSales), units: s.units, receipts: s.receipts,
      avgTicket: Number(s.avgTicket),
      vsYesterday: yesterdayMap[s.branchId]
        ? ((Number(s.totalSales) - yesterdayMap[s.branchId]) / yesterdayMap[s.branchId]) * 100
        : null,
      dataSource: s.dataSource,
      rawData:    s.rawData as Record<string, unknown> | null,
    })),
    lastBalanceDate: balances[0]?.snapshotDate ?? null,
    isStaleBalances,
    lastSalesDate: sales[0]?.snapshotDate ?? null,
    isStaleSales,
    lastSync: lastSync ? { at: lastSync.createdAt, status: lastSync.status } : null,
    branches,
    alertas,
  };

  return (
    <ExecutiveDashboard data={data} user={session.user}>
      <ComparativeSection />
    </ExecutiveDashboard>
  );
}
