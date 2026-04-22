import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const EXECUTIVE_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"];
const VALID_PERIODS   = ["7d", "14d", "21d", "30d", "3m", "6m", "12m"];

type PeriodRanges = {
  currentStart: Date;
  currentEnd:   Date;
  pastStart:    Date;
  pastEnd:      Date;
  isMonthly:    boolean;
};

function getPeriodRanges(period: string): PeriodRanges | null {
  const now = new Date(); now.setHours(0, 0, 0, 0);

  if (/^\d+d$/.test(period)) {
    const days = parseInt(period);
    const currentEnd   = new Date(now);
    const currentStart = new Date(now); currentStart.setDate(currentStart.getDate() - days + 1);
    const pastEnd      = new Date(currentEnd);   pastEnd.setFullYear(pastEnd.getFullYear() - 1);
    const pastStart    = new Date(currentStart); pastStart.setFullYear(pastStart.getFullYear() - 1);
    return { currentStart, currentEnd, pastStart, pastEnd, isMonthly: false };
  }

  if (/^\d+m$/.test(period)) {
    const months = parseInt(period);
    // Últimos N meses calendario completos (excluye el mes actual en curso)
    const currentEnd = new Date(now.getFullYear(), now.getMonth(), 0); // último día del mes anterior
    currentEnd.setHours(0, 0, 0, 0);
    const currentStart = new Date(currentEnd.getFullYear(), currentEnd.getMonth() - months + 1, 1);
    const pastEnd      = new Date(currentEnd);   pastEnd.setFullYear(pastEnd.getFullYear() - 1);
    const pastStart    = new Date(currentStart); pastStart.setFullYear(pastStart.getFullYear() - 1);
    return { currentStart, currentEnd, pastStart, pastEnd, isMonthly: true };
  }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!EXECUTIVE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const period   = searchParams.get("period")   ?? "30d";
  const branchId = searchParams.get("branchId") ?? "ALL";

  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: `Período inválido. Válidos: ${VALID_PERIODS.join(", ")}` }, { status: 400 });
  }

  const ranges = getPeriodRanges(period)!;
  const branchFilter = branchId !== "ALL" ? { branchId } : {};

  const [currentRows, pastRows, branches] = await Promise.all([
    prisma.salesSnapshot.findMany({
      where: {
        ...branchFilter,
        snapshotDate: { gte: ranges.currentStart, lte: ranges.currentEnd },
      },
      select: { branchId: true, totalSales: true, snapshotDate: true,
                branch: { select: { id: true, name: true } } },
    }),
    prisma.salesSnapshot.findMany({
      where: {
        ...branchFilter,
        snapshotDate: { gte: ranges.pastStart, lte: ranges.pastEnd },
      },
      select: { branchId: true, totalSales: true, snapshotDate: true,
                branch: { select: { id: true, name: true } } },
    }),
    prisma.branch.findMany({
      where: { active: true, ...(branchId !== "ALL" && { id: branchId }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Agregados totales
  const currentTotal = currentRows.reduce((s, r) => s + Number(r.totalSales), 0);
  const pastTotal    = pastRows.reduce(   (s, r) => s + Number(r.totalSales), 0);
  const variation    = pastTotal > 0 ? ((currentTotal - pastTotal) / pastTotal) * 100 : null;

  // Por sucursal
  const branchMap = new Map<string, { branchId: string; branchName: string; current: number; yearAgo: number }>();
  for (const b of branches) branchMap.set(b.id, { branchId: b.id, branchName: b.name, current: 0, yearAgo: 0 });
  for (const r of currentRows) {
    const e = branchMap.get(r.branchId);
    if (e) e.current += Number(r.totalSales);
  }
  for (const r of pastRows) {
    const e = branchMap.get(r.branchId);
    if (e) e.yearAgo += Number(r.totalSales);
  }
  const byBranch = Array.from(branchMap.values())
    .map(e => ({ ...e, variation: e.yearAgo > 0 ? ((e.current - e.yearAgo) / e.yearAgo) * 100 : null }))
    .sort((a, b) => (b.variation ?? -Infinity) - (a.variation ?? -Infinity));

  // Por mes (solo para períodos mensuales)
  let byMonth: Array<{ month: string; current: number; yearAgo: number }> | null = null;
  if (ranges.isMonthly) {
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const currentByMonth = new Map<string, number>();
    const pastByMonth    = new Map<string, number>();
    for (const r of currentRows) {
      const k = monthKey(new Date(r.snapshotDate));
      currentByMonth.set(k, (currentByMonth.get(k) ?? 0) + Number(r.totalSales));
    }
    for (const r of pastRows) {
      // Alinear: el mes del past se mapea al mes equivalente del current (+ 1 año)
      const d = new Date(r.snapshotDate);
      const aligned = new Date(d.getFullYear() + 1, d.getMonth(), 1);
      const k = monthKey(aligned);
      pastByMonth.set(k, (pastByMonth.get(k) ?? 0) + Number(r.totalSales));
    }

    // Iterar todos los meses del rango current para construir el output ordenado
    byMonth = [];
    const cursor = new Date(ranges.currentStart);
    while (cursor <= ranges.currentEnd) {
      const k = monthKey(cursor);
      byMonth.push({
        month:   k,
        current: currentByMonth.get(k) ?? 0,
        yearAgo: pastByMonth.get(k)    ?? 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return NextResponse.json({
    period,
    branchId,
    range: {
      currentStart: ranges.currentStart.toISOString(),
      currentEnd:   ranges.currentEnd.toISOString(),
      pastStart:    ranges.pastStart.toISOString(),
      pastEnd:      ranges.pastEnd.toISOString(),
    },
    aggregate: { current: currentTotal, yearAgo: pastTotal, variation },
    byBranch,
    byMonth,
  });
}
