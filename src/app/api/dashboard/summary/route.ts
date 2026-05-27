import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getArtToday, parseArtDate, isFutureArtDate } from "@/lib/dates/executive";

const EXECUTIVE_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!EXECUTIVE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") ?? "ALL";
  const dateParam = searchParams.get("date");

  // Resolución de la fecha. Si dateParam viene pero es inválida/futura → 400
  // (la API es estricta; el SSR es permisivo y la ignora).
  const today = getArtToday();
  let requestedDate: Date | null = null;
  if (dateParam !== null) {
    const parsed = parseArtDate(dateParam);
    if (!parsed) {
      return NextResponse.json({ error: "Parámetro date inválido (esperado YYYY-MM-DD)" }, { status: 400 });
    }
    if (isFutureArtDate(parsed)) {
      return NextResponse.json({ error: "La fecha no puede ser futura" }, { status: 400 });
    }
    requestedDate = parsed;
  }
  const anchor = requestedDate ?? today;

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
  let isStale = false;
  // Fallback al último disponible SOLO en modo default. Con date explícita
  // devolvemos vacío para no confundir al consumer.
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
    isStale = true;
  }

  // --- VENTAS ---
  const salesBranchFilter = {
    ...(branchId !== "ALL" && { branchId }),
    branch: { showInExecutive: true, showInOperative: true },
  };
  let sales = await prisma.salesSnapshot.findMany({
    where: { snapshotDate: anchor, ...salesBranchFilter },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
  let isStaleSales = false;
  let salesDate = anchor;
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
  const yesterday = new Date(salesDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdaySales = await prisma.salesSnapshot.findMany({
    where: { snapshotDate: yesterday, ...salesBranchFilter },
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
    requestedDate: requestedDate ? requestedDate.toISOString() : null,
    anchorDate:    anchor.toISOString(),
    hasDataForRequestedDate: requestedDate !== null
      ? (balances.length > 0 || sales.length > 0)
      : true,
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
      dataSource: s.dataSource,
      rawData:    s.rawData,
    })),
    isStaleBalances: isStale,
    lastBalanceDate: balances[0]?.snapshotDate ?? null,
    isStaleSales,
    lastSalesDate: sales[0]?.snapshotDate ?? null,
  });
}
