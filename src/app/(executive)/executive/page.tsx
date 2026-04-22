import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ExecutiveDashboard } from "@/components/executive/ExecutiveDashboard";
import { ComparativeSection } from "@/components/executive/ComparativeSection";

export const revalidate = 300;

export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: { branch?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const branchId = searchParams.branch ?? "ALL";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const balanceWhere = {
    snapshotDate: today,
    ...(branchId !== "ALL" && { branchId }),
    branch: { showInExecutive: true },
  };
  let balances = await prisma.bankBalanceSnapshot.findMany({
    where: balanceWhere,
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ branch: { name: "asc" } }, { bankName: "asc" }],
  });
  let isStaleBalances = false;
  if (balances.length === 0) {
    balances = await prisma.bankBalanceSnapshot.findMany({
      where: branchId !== "ALL"
        ? { branchId }
        : { branch: { showInExecutive: true } },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { snapshotDate: "desc" },
      take: 200,
    });
    isStaleBalances = true;
  }

  const sales = await prisma.salesSnapshot.findMany({
    where: {
      snapshotDate: today,
      ...(branchId !== "ALL" && { branchId }),
      branch: { showInExecutive: true },
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
  const yesterdaySales = await prisma.salesSnapshot.findMany({
    where: {
      snapshotDate: yesterday,
      ...(branchId !== "ALL" && { branchId }),
      branch: { showInExecutive: true },
    },
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

  const alertas: string[] = [];
  if (isStaleBalances && balances.length > 0) {
    alertas.push(`Saldos: mostrando ${new Date(balances[0].snapshotDate).toLocaleDateString("es-AR")} (no se cargó el archivo de hoy)`);
  }
  if (isStaleBalances && balances.length === 0) alertas.push("No hay saldos bancarios disponibles");
  if (sales.length === 0) alertas.push("Datos de ventas no disponibles para hoy");

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

  const data = {
    date: today,
    isToday: true,
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
