"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

const NAVY   = "#1E2D5A";
const ORANGE = "#D4632A";

const PERIODS_SHORT   = ["7d", "14d", "21d", "30d"] as const;
const PERIODS_MONTHLY = ["3m", "6m", "12m"] as const;
type Period = typeof PERIODS_SHORT[number] | typeof PERIODS_MONTHLY[number];

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 días", "14d": "14 días", "21d": "21 días", "30d": "30 días",
  "3m": "3 meses", "6m": "6 meses", "12m": "12 meses",
};

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

interface ComparativeResponse {
  period:   string;
  branchId: string;
  aggregate: { current: number; yearAgo: number; variation: number | null };
  byBranch:  Array<{ branchId: string; branchName: string; current: number; yearAgo: number; variation: number | null }>;
  byMonth:   Array<{ month: string; current: number; yearAgo: number }> | null;
}

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtShort = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
};

function monthShortLabel(key: string) {
  // key = "2025-11" → "Nov '25"
  const [y, m] = key.split("-");
  const mIdx = parseInt(m) - 1;
  return `${MONTH_LABELS[mIdx] ?? m} '${y.slice(-2)}`;
}

export function ComparativeSection() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branch") ?? "ALL";
  const [period, setPeriod] = useState<Period>("30d");

  const { data, isLoading, error } = useQuery<ComparativeResponse>({
    queryKey: ["comparative", period, branchId],
    queryFn:  async () => {
      const res = await fetch(`/api/dashboard/comparative?period=${period}&branchId=${branchId}`);
      if (!res.ok) throw new Error("Error al cargar comparativo");
      return res.json();
    },
  });

  const isMonthly = PERIODS_MONTHLY.includes(period as typeof PERIODS_MONTHLY[number]);

  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: NAVY }}>
          <BarChart3 className="w-4 h-4" />
          Comparativo anual
        </h3>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      <div className="p-4 space-y-5">
        {isLoading && (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2.5">
            {(error as Error).message}
          </p>
        )}

        {data && (
          <>
            <SummaryCards aggregate={data.aggregate} />
            {isMonthly && data.byMonth && data.byMonth.length > 0 && (
              <MonthlyChart data={data.byMonth} />
            )}
            <BranchTable rows={data.byBranch} />
          </>
        )}
      </div>
    </section>
  );
}

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const btnCls = (active: boolean) => cn(
    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
    active
      ? "bg-[#1E2D5A] text-white"
      : "bg-white text-gray-600 border border-gray-200 hover:border-gray-400",
  );
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PERIODS_SHORT.map(p => (
        <button key={p} onClick={() => onChange(p)} className={btnCls(period === p)}>
          {p}
        </button>
      ))}
      <span className="mx-1 text-gray-300">|</span>
      {PERIODS_MONTHLY.map(p => (
        <button key={p} onClick={() => onChange(p)} className={btnCls(period === p)}>
          {p}
        </button>
      ))}
    </div>
  );
}

function SummaryCards({ aggregate }: { aggregate: ComparativeResponse["aggregate"] }) {
  const { current, yearAgo, variation } = aggregate;
  const VarIcon = variation == null || variation === 0 ? Minus : variation > 0 ? TrendingUp : TrendingDown;
  const varColor = variation == null
    ? "text-gray-400"
    : variation > 0 ? "text-emerald-600"
    : variation < 0 ? "text-red-500" : "text-gray-400";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Este período</p>
        <p className="mt-1.5 text-xl font-bold" style={{ color: NAVY }}>{fmtARS(current)}</p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Año anterior</p>
        <p className="mt-1.5 text-xl font-bold text-gray-600">
          {yearAgo > 0 ? fmtARS(yearAgo) : <span className="text-gray-400 text-sm font-medium">Sin datos</span>}
        </p>
      </div>
      <div className="rounded-lg border p-4" style={{ borderColor: ORANGE, borderWidth: 1 }}>
        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Variación</p>
        <p className={`mt-1.5 text-xl font-bold flex items-center gap-1.5 ${varColor}`}>
          <VarIcon className="w-5 h-5" />
          {variation != null ? `${variation > 0 ? "+" : ""}${variation.toFixed(1)}%` : "—"}
        </p>
      </div>
    </div>
  );
}

function MonthlyChart({ data }: { data: Array<{ month: string; current: number; yearAgo: number }> }) {
  const chartData = data.map(d => ({
    month:    monthShortLabel(d.month),
    Actual:   d.current,
    Anterior: d.yearAgo,
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500 mb-3">Ventas mensuales — Actual vs año anterior</p>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#d1d5db" }} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={fmtShort}
              tickLine={false}
              axisLine={{ stroke: "#d1d5db" }}
              width={50}
            />
            <Tooltip
              formatter={(v) => (typeof v === "number" ? fmtARS(v) : String(v))}
              cursor={{ fill: "rgba(30, 45, 90, 0.05)" }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            <Bar dataKey="Actual"    fill={NAVY}   radius={[4, 4, 0, 0]} maxBarSize={40} />
            <Bar dataKey="Anterior"  fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BranchTable({ rows }: { rows: ComparativeResponse["byBranch"] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-gray-400 italic text-center py-4">Sin datos por sucursal</p>;
  }
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="text-left  px-4 py-2 font-medium">Sucursal</th>
            <th className="text-right px-4 py-2 font-medium">Este período</th>
            <th className="text-right px-4 py-2 font-medium">Año anterior</th>
            <th className="text-right px-4 py-2 font-medium">Variación %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => {
            const v = r.variation;
            const VarIcon = v == null || v === 0 ? Minus : v > 0 ? TrendingUp : TrendingDown;
            const varColor = v == null ? "text-gray-400"
              : v > 0 ? "text-emerald-600"
              : v < 0 ? "text-red-500" : "text-gray-400";
            return (
              <tr key={r.branchId} className="hover:bg-gray-50/60">
                <td className="px-4 py-2.5 text-gray-800 font-medium">{r.branchName}</td>
                <td className="px-4 py-2.5 text-right font-semibold" style={{ color: NAVY }}>{fmtARS(r.current)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">
                  {r.yearAgo > 0 ? fmtARS(r.yearAgo) : <span className="text-gray-400">—</span>}
                </td>
                <td className={`px-4 py-2.5 text-right ${varColor}`}>
                  <span className="inline-flex items-center gap-1 text-xs font-medium">
                    <VarIcon className="w-3.5 h-3.5" />
                    {v != null ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
