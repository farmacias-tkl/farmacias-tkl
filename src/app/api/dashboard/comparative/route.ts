import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const EXECUTIVE_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"];
const VALID_PERIODS   = ["7d", "14d", "21d", "30d", "3m", "6m", "12m", "custom"];

type PeriodRanges = {
  currentStart: Date;
  currentEnd:   Date;
  pastStart:    Date;
  pastEnd:      Date;
  isMonthly:    boolean;
};

function getPeriodRanges(period: string, anchorDate: Date): PeriodRanges | null {
  if (/^\d+d$/.test(period)) {
    const days = parseInt(period);
    const currentEnd   = new Date(anchorDate);
    const currentStart = new Date(anchorDate); currentStart.setDate(currentStart.getDate() - days + 1);
    const pastEnd      = new Date(currentEnd);   pastEnd.setFullYear(pastEnd.getFullYear() - 1);
    const pastStart    = new Date(currentStart); pastStart.setFullYear(pastStart.getFullYear() - 1);
    return { currentStart, currentEnd, pastStart, pastEnd, isMonthly: false };
  }

  if (/^\d+m$/.test(period)) {
    const months = parseInt(period);
    const currentEnd   = new Date(anchorDate);
    const currentStart = new Date(anchorDate);
    currentStart.setMonth(currentStart.getMonth() - months);
    currentStart.setDate(currentStart.getDate() + 1);
    const pastEnd      = new Date(currentEnd);   pastEnd.setFullYear(pastEnd.getFullYear() - 1);
    const pastStart    = new Date(currentStart); pastStart.setFullYear(pastStart.getFullYear() - 1);
    return { currentStart, currentEnd, pastStart, pastEnd, isMonthly: true };
  }

  return null;
}

// Parsea "YYYY-MM-DD" como fecha local a medianoche. Devuelve null si invalido.
function parseLocalDate(iso: string | null): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  date.setHours(0, 0, 0, 0);
  if (isNaN(date.getTime())) return null;
  // Validar que la fecha sea real (ej: rechazar 2026-02-30)
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return date;
}

// Construye PeriodRanges desde 4 fechas pasadas explicitamente (period=custom).
// Devuelve { ranges } si todo OK, o { error } con mensaje descriptivo si no.
function getCustomRanges(sp: URLSearchParams): { ranges: PeriodRanges } | { error: string } {
  const cs = parseLocalDate(sp.get("currentStart"));
  const ce = parseLocalDate(sp.get("currentEnd"));
  const ps = parseLocalDate(sp.get("pastStart"));
  const pe = parseLocalDate(sp.get("pastEnd"));
  if (!cs || !ce || !ps || !pe) {
    return { error: "Para period=custom se requieren las 4 fechas (currentStart, currentEnd, pastStart, pastEnd) en formato YYYY-MM-DD." };
  }
  if (cs.getTime() > ce.getTime()) {
    return { error: "currentStart debe ser <= currentEnd." };
  }
  if (ps.getTime() > pe.getTime()) {
    return { error: "pastStart debe ser <= pastEnd." };
  }
  return {
    ranges: {
      currentStart: cs, currentEnd: ce,
      pastStart:    ps, pastEnd:    pe,
      isMonthly:    false,
    },
  };
}

function buildMetric(current: number, yearAgo: number) {
  return {
    current,
    yearAgo,
    variation: yearAgo > 0 ? ((current - yearAgo) / yearAgo) * 100 : null,
  };
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

  const branchFilter = branchId !== "ALL" ? { branchId } : {};
  const execVisibility = { branch: { showInExecutive: true, showInOperative: true } };

  // Resolver rangos:
  // - period=custom -> 4 fechas explicitas en query params (anchor = currentEnd)
  // - presets       -> calcular desde anchor = MAX(snapshotDate) bajo filtro
  let ranges: PeriodRanges;
  let anchorDate: Date;

  if (period === "custom") {
    const result = getCustomRanges(searchParams);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    ranges = result.ranges;
    anchorDate = new Date(ranges.currentEnd);
  } else {
    // Anchor = última fecha disponible bajo el filtro activo. Si la DB está vacía,
    // fallback a hoy (los rangos quedarán vacíos pero no rompen).
    const latestSnapshot = await prisma.salesSnapshot.findFirst({
      where: { ...branchFilter, ...execVisibility },
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true },
    });
    anchorDate = latestSnapshot?.snapshotDate
      ? new Date(latestSnapshot.snapshotDate)
      : new Date();
    anchorDate.setHours(0, 0, 0, 0);
    ranges = getPeriodRanges(period, anchorDate)!;
  }

  const [currentRows, pastRows, branches] = await Promise.all([
    prisma.salesSnapshot.findMany({
      where: {
        ...branchFilter, ...execVisibility,
        snapshotDate: { gte: ranges.currentStart, lte: ranges.currentEnd },
      },
      select: {
        branchId: true, totalSales: true, units: true, receipts: true,
        snapshotDate: true, branch: { select: { id: true, name: true } },
      },
    }),
    prisma.salesSnapshot.findMany({
      where: {
        ...branchFilter, ...execVisibility,
        snapshotDate: { gte: ranges.pastStart, lte: ranges.pastEnd },
      },
      select: {
        branchId: true, totalSales: true, units: true, receipts: true,
        snapshotDate: true, branch: { select: { id: true, name: true } },
      },
    }),
    prisma.branch.findMany({
      where: {
        active: true, showInExecutive: true, showInOperative: true,
        ...(branchId !== "ALL" && { id: branchId }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Totales agregados — 3 métricas × (current / yearAgo / variation)
  const sumSales    = (rs: typeof currentRows) => rs.reduce((s, r) => s + Number(r.totalSales), 0);
  const sumUnits    = (rs: typeof currentRows) => rs.reduce((s, r) => s + r.units, 0);
  const sumReceipts = (rs: typeof currentRows) => rs.reduce((s, r) => s + r.receipts, 0);

  const aggregate = {
    sales:   buildMetric(sumSales(currentRows),    sumSales(pastRows)),
    units:   buildMetric(sumUnits(currentRows),    sumUnits(pastRows)),
    tickets: buildMetric(sumReceipts(currentRows), sumReceipts(pastRows)),
  };

  // Por sucursal — 3 métricas × (current / yearAgo / variation)
  type BranchAcc = {
    branchId:   string;
    branchName: string;
    salesCur:   number; salesPast:    number;
    unitsCur:   number; unitsPast:    number;
    ticketsCur: number; ticketsPast:  number;
    currentDays: Set<string>;
  };
  const branchMap = new Map<string, BranchAcc>();
  for (const b of branches) {
    branchMap.set(b.id, {
      branchId: b.id, branchName: b.name,
      salesCur: 0, salesPast: 0, unitsCur: 0, unitsPast: 0, ticketsCur: 0, ticketsPast: 0,
      currentDays: new Set<string>(),
    });
  }
  for (const r of currentRows) {
    const e = branchMap.get(r.branchId);
    if (!e) continue;
    e.salesCur   += Number(r.totalSales);
    e.unitsCur   += r.units;
    e.ticketsCur += r.receipts;
    e.currentDays.add(new Date(r.snapshotDate).toISOString().slice(0, 10));
  }
  for (const r of pastRows) {
    const e = branchMap.get(r.branchId);
    if (!e) continue;
    e.salesPast   += Number(r.totalSales);
    e.unitsPast   += r.units;
    e.ticketsPast += r.receipts;
  }

  const byBranch = Array.from(branchMap.values())
    .map((e) => ({
      branchId:   e.branchId,
      branchName: e.branchName,
      sales:      buildMetric(e.salesCur,   e.salesPast),
      units:      buildMetric(e.unitsCur,   e.unitsPast),
      tickets:    buildMetric(e.ticketsCur, e.ticketsPast),
      currentDaysWithData: e.currentDays.size,
    }))
    // Orden por ventas del periodo actual DESC (sentido ejecutivo: priorizar volumen).
    .sort((a, b) => b.sales.current - a.sales.current);

  // Por mes (solo ventas, para el gráfico)
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
      const d = new Date(r.snapshotDate);
      const aligned = new Date(d.getFullYear() + 1, d.getMonth(), 1);
      const k = monthKey(aligned);
      pastByMonth.set(k, (pastByMonth.get(k) ?? 0) + Number(r.totalSales));
    }

    byMonth = [];
    const cursor   = new Date(ranges.currentStart.getFullYear(), ranges.currentStart.getMonth(), 1);
    const endMonth = new Date(ranges.currentEnd.getFullYear(),   ranges.currentEnd.getMonth(),   1);
    while (cursor <= endMonth) {
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
    anchorDate: anchorDate.toISOString(),
    range: {
      currentStart: ranges.currentStart.toISOString(),
      currentEnd:   ranges.currentEnd.toISOString(),
      pastStart:    ranges.pastStart.toISOString(),
      pastEnd:      ranges.pastEnd.toISOString(),
    },
    aggregate,
    byBranch,
    byMonth,
  });
}
