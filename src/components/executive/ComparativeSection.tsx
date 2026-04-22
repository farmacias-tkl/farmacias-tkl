"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid,
} from "recharts";

const NAVY   = "#1E2D5A";
const ORANGE = "#D4632A";

const PERIODS_SHORT   = ["7d", "14d", "21d", "30d"] as const;
const PERIODS_MONTHLY = ["3m", "6m", "12m"] as const;
type Period = typeof PERIODS_SHORT[number] | typeof PERIODS_MONTHLY[number];

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
  const [y, m] = key.split("-");
  const mIdx = parseInt(m) - 1;
  return `${MONTH_LABELS[mIdx] ?? m} '${y.slice(-2)}`;
}

const COMP_CSS = `
/* Period selector buttons */
.cmp-period-bar {
  display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap;
}
.cmp-period-btn {
  padding: 0.35rem 0.75rem;
  font-size: 11px; font-weight: 600;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.25);
  background: transparent;
  color: rgba(255,255,255,0.85);
  cursor: pointer;
  transition: all 0.15s;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cmp-period-btn:hover { background: rgba(255,255,255,0.12); }
.cmp-period-btn--active {
  background: #D4632A;
  border-color: #D4632A;
  color: white;
}
.cmp-period-divider {
  color: rgba(255,255,255,0.3); margin: 0 0.125rem; font-weight: 300;
}

/* Summary cards row */
.cmp-cards {
  display: grid; gap: 0.75rem;
  grid-template-columns: 1fr;
  margin-bottom: 1rem;
}
@media (min-width: 640px) { .cmp-cards { grid-template-columns: repeat(3, 1fr); } }

.cmp-card {
  padding: 1rem 1.125rem;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: white;
}
.cmp-card--accent { border-color: #D4632A; border-width: 1px; }
.cmp-card-label {
  font-size: 10px; color: #6b7280; text-transform: uppercase;
  letter-spacing: 0.08em; font-weight: 600;
}
.cmp-card-value {
  margin-top: 0.375rem; font-size: 1.375rem; font-weight: 800;
  color: #1E2D5A; word-break: break-word;
}
.cmp-card-value--sub { color: #6b7280; }
.cmp-card-value--var {
  display: inline-flex; align-items: center; gap: 0.375rem;
}

.cmp-chart-wrap {
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: white;
  margin-bottom: 1rem;
}
.cmp-chart-title {
  font-size: 11px; color: #6b7280; margin-bottom: 0.625rem;
}
.cmp-chart-container { width: 100%; height: 240px; }
@media (min-width: 768px) { .cmp-chart-container { height: 280px; } }

/* Tabla por sucursal */
.cmp-table-wrap {
  border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: white;
}
.cmp-table { width: 100%; font-size: 13px; border-collapse: collapse; }
.cmp-table thead { background: #f9fafb; }
.cmp-table th {
  padding: 0.625rem 0.75rem; text-align: left;
  font-size: 10px; font-weight: 500; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.cmp-table th.num { text-align: right; }
.cmp-table td { padding: 0.625rem 0.75rem; border-top: 1px solid #f3f4f6; }
.cmp-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cmp-table tr:hover td { background: #fafafa; }

@media (max-width: 639px) {
  /* Tabla responsive: oculta año anterior, deja solo sucursal | este período | var */
  .cmp-table th:nth-child(3), .cmp-table td:nth-child(3) { display: none; }
}

.cmp-empty { padding: 1.5rem; text-align: center; color: #9ca3af; font-size: 13px; }
.cmp-error { font-size: 13px; color: #dc2626; background: #fef2f2; border-radius: 6px; padding: 0.625rem 0.875rem; }
.cmp-loading {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;
}
.cmp-loading > div { height: 70px; background: #f3f4f6; border-radius: 10px; animation: cmp-pulse 1.2s ease-in-out infinite; }
@keyframes cmp-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
`;

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
    <>
      <style dangerouslySetInnerHTML={{ __html: COMP_CSS }} />
      <section className="exec-section">
        <div className="exec-section-header" style={{ gap: "1rem" }}>
          <h3 className="exec-section-title">Comparativo</h3>
          <PeriodSelector period={period} onChange={setPeriod} />
        </div>
        <div className="exec-section-body exec-section-body-padded">
          {isLoading && (
            <div className="cmp-loading">
              <div /><div /><div />
            </div>
          )}
          {error && <p className="cmp-error">{(error as Error).message}</p>}
          {data && (
            <>
              <SummaryCards aggregate={data.aggregate} />
              {isMonthly && data.byMonth && data.byMonth.length > 0 && <MonthlyChart data={data.byMonth} />}
              <BranchTable rows={data.byBranch} />
            </>
          )}
        </div>
      </section>
    </>
  );
}

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="cmp-period-bar">
      {PERIODS_SHORT.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={period === p ? "cmp-period-btn cmp-period-btn--active" : "cmp-period-btn"}
        >
          {p}
        </button>
      ))}
      <span className="cmp-period-divider">|</span>
      {PERIODS_MONTHLY.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={period === p ? "cmp-period-btn cmp-period-btn--active" : "cmp-period-btn"}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function SummaryCards({ aggregate }: { aggregate: ComparativeResponse["aggregate"] }) {
  const { current, yearAgo, variation } = aggregate;
  const VarIcon  = variation == null || variation === 0 ? Minus : variation > 0 ? TrendingUp : TrendingDown;
  const varColor = variation == null ? "#9ca3af"
    : variation > 0 ? "#059669"
    : variation < 0 ? "#ef4444" : "#9ca3af";

  return (
    <div className="cmp-cards">
      <div className="cmp-card">
        <div className="cmp-card-label">Este período</div>
        <div className="cmp-card-value">{fmtARS(current)}</div>
      </div>
      <div className="cmp-card">
        <div className="cmp-card-label">Año anterior</div>
        <div className="cmp-card-value cmp-card-value--sub">
          {yearAgo > 0 ? fmtARS(yearAgo) : <span style={{ fontSize: 14, color: "#9ca3af" }}>Sin datos</span>}
        </div>
      </div>
      <div className="cmp-card cmp-card--accent">
        <div className="cmp-card-label">Variación</div>
        <div className="cmp-card-value cmp-card-value--var" style={{ color: varColor }}>
          <VarIcon style={{ width: 20, height: 20 }} />
          {variation != null ? `${variation > 0 ? "+" : ""}${variation.toFixed(1)}%` : "—"}
        </div>
      </div>
    </div>
  );
}

function MonthlyChart({ data }: { data: Array<{ month: string; current: number; yearAgo: number }> }) {
  const chartData = data.map((d) => ({
    month:    monthShortLabel(d.month),
    Actual:   d.current,
    Anterior: d.yearAgo,
  }));

  return (
    <div className="cmp-chart-wrap">
      <p className="cmp-chart-title">Ventas mensuales — Actual vs año anterior</p>
      <div className="cmp-chart-container">
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
    return <p className="cmp-empty">Sin datos por sucursal</p>;
  }
  return (
    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th>Sucursal</th>
            <th className="num">Este período</th>
            <th className="num">Año anterior</th>
            <th className="num">Variación %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.variation;
            const VarIcon = v == null || v === 0 ? Minus : v > 0 ? TrendingUp : TrendingDown;
            const varColor = v == null ? "#9ca3af"
              : v > 0 ? "#059669"
              : v < 0 ? "#ef4444" : "#9ca3af";
            return (
              <tr key={r.branchId}>
                <td style={{ color: "#111827", fontWeight: 500 }}>{r.branchName}</td>
                <td className="num" style={{ color: "#1E2D5A", fontWeight: 600 }}>{fmtARS(r.current)}</td>
                <td className="num" style={{ color: "#6b7280" }}>
                  {r.yearAgo > 0 ? fmtARS(r.yearAgo) : <span style={{ color: "#9ca3af" }}>—</span>}
                </td>
                <td className="num" style={{ color: varColor }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
                    <VarIcon style={{ width: 14, height: 14 }} />
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
