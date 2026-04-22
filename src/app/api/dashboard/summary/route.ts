import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const EXECUTIVE_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!EXECUTIVE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") ?? "ALL";
  const targetDate = new Date();
  targetDate.setHours(0, 0, 0, 0);

  const balanceWhere = {
    snapshotDate: targetDate,
    ...(branchId !== "ALL" && { branchId }),
    branch: { showInExecutive: true },
  };
  let balances = await prisma.bankBalanceSnapshot.findMany({
    where: balanceWhere,
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ branch: { name: "asc" } }, { bankName: "asc" }],
  });
  let isStale = false;
  if (balances.length === 0) {
    balances = await prisma.bankBalanceSnapshot.findMany({
      where: branchId !== "ALL"
        ? { branchId }
        : { branch: { showInExecutive: true } },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { snapshotDate: "desc" },
      take: 200,
    });
    isStale = true;
  }

  const sales = await prisma.salesSnapshot.findMany({
    where: {
      snapshotDate: targetDate,
      ...(branchId !== "ALL" && { branchId }),
      branch: { showInExecutive: true },
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
  const yesterday = new Date(targetDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdaySales = await prisma.salesSnapshot.findMany({
    where: {
      snapshotDate: yesterday,
      ...(branchId !== "ALL" && { branchId }),
      branch: { showInExecutive: true },
    },
    select: { branchId: true, totalSales: true },
  });
  const yesterdayMap = Object.fromEntries(yesterdaySales.map((s) => [s.branchId, Number(s.totalSales)]));

  const totalBankBalance = balances.reduce((s, b) => s + Number(b.balance), 0);
  const totalSales       = sales.reduce((s, v) => s + Number(v.totalSales), 0);
  const totalUnits       = sales.reduce((s, v) => s + v.units, 0);
  const totalReceipts    = sales.reduce((s, v) => s + v.receipts, 0);
  const avgTicket        = totalReceipts > 0 ? totalSales / totalReceipts : 0;
  const totalYesterday   = yesterdaySales.reduce((s, v) => s + Number(v.totalSales), 0);

  return NextResponse.json({
    kpis: {
      totalBankBalance, totalSales, totalUnits, totalReceipts, avgTicket,
      salesVariation: totalYesterday > 0 ? ((totalSales - totalYesterday) / totalYesterday) * 100 : null,
    },
    balances: balances.map((b) => ({
      branchId: b.branchId, branchName: b.branch.name,
      bankName: b.bankName, accountLabel: b.accountLabel,
      balance: Number(b.balance),
      checks: b.checks ? Number(b.checks) : null,
      prevBalance: b.prevBalance ? Number(b.prevBalance) : null,
    })),
    sales: sales.map((s) => ({
      branchId: s.branchId, branchName: s.branch.name,
      totalSales: Number(s.totalSales), units: s.units, receipts: s.receipts,
      avgTicket: Number(s.avgTicket),
      vsYesterday: yesterdayMap[s.branchId]
        ? ((Number(s.totalSales) - yesterdayMap[s.branchId]) / yesterdayMap[s.branchId]) * 100
        : null,
    })),
    isStaleBalances: isStale,
    lastBalanceDate: balances[0]?.snapshotDate ?? null,
  });
}
