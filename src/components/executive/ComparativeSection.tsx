"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid,
} from "recharts";
import type { ComparativeResponse, ComparativeMetric, ComparativeBranchRow } from "@/types/dashboard";

const NAVY   = "#1E2D5A";
const ORANGE = "#D4632A";

const PERIODS_SHORT   = ["7d", "14d", "21d", "30d"] as const;
const PERIODS_MONTHLY = ["3m", "6m", "12m"] as const;
type Period = typeof PERIODS_SHORT[number] | typeof PERIODS_MONTHLY[number];

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);
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

function varColor(v: number | null) {
  if (v == null) return "#9ca3af";
  if (v > 0)     return "#059669";
  if (v < 0)     return "#ef4444";
  return "#9ca3af";
}
function VarIconOf(v: number | null) {
  return v == null || v === 0 ? Minus : v > 0 ? TrendingUp : TrendingDown;
}
function formatVar(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

const COMP_CSS = `
.cmp-period-bar { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
.cmp-period-btn {
  padding: 0.35rem 0.75rem; font-size: 11px; font-weight: 600;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.25);
  background: transparent; color: rgba(255,255,255,0.85);
  cursor: pointer; transition: all 0.15s;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.cmp-period-btn:hover { background: rgba(255,255,255,0.12); }
.cmp-period-btn--active { background: #D4632A; border-color: #D4632A; color: white; }
.cmp-period-divider { color: rgba(255,255,255,0.3); margin: 0 0.125rem; font-weight: 300; }

/* === Matriz 3x3 (métrica × período): desktop tabla, mobile cards apiladas === */
.cmp-matrix-wrap { margin-bottom: 1rem; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: white; }
.cmp-matrix { display: none; width: 100%; border-collapse: collapse; font-size: 13px; }
@media (min-width: 640px) { .cmp-matrix { display: table; } }
.cmp-matrix thead { background: #f9fafb; }
.cmp-matrix th {
  padding: 0.625rem 0.875rem; text-align: left;
  font-size: 10px; font-weight: 500; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.cmp-matrix th.num { text-align: right; }
.cmp-matrix td { padding: 0.75rem 0.875rem; border-top: 1px solid #f3f4f6; vertical-align: middle; }
.cmp-matrix td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cmp-matrix td.metric-label { font-weight: 700; color: #1E2D5A; font-size: 12px; letter-spacing: 0.03em; }
.cmp-matrix td.value-current { color: #1E2D5A; font-weight: 700; font-size: 15px; }
.cmp-matrix td.value-past    { color: #6b7280; }

/* Mobile cards */
.cmp-matrix-cards { display: grid; gap: 0.75rem; padding: 0.75rem; }
@media (min-width: 640px) { .cmp-matrix-cards { display: none; } }
.cmp-mcard { border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.875rem; }
.cmp-mcard--accent { border-color: #D4632A; }
.cmp-mcard-title { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin-bottom: 0.625rem; }
.cmp-mcard-row { display: flex; justify-content: space-between; font-size: 13px; padding: 0.2rem 0; }
.cmp-mcard-row .label { color: #6b7280; }
.cmp-mcard-row .value { font-weight: 600; color: #1E2D5A; }
.cmp-mcard-row.primary .value { font-size: 18px; font-weight: 800; }
.cmp-mcard-row.sub     .value { color: #6b7280; font-weight: 500; }

.cmp-chart-wrap { padding: 1rem; border: 1px solid #e5e7eb; border-radius: 10px; background: white; margin-bottom: 1rem; }
.cmp-chart-title { font-size: 11px; color: #6b7280; margin-bottom: 0.625rem; }
.cmp-chart-container { width: 100%; height: 240px; }
@media (min-width: 768px) { .cmp-chart-container { height: 280px; } }

/* Tabla por sucursal — 7 columnas desktop, 3 mobile */
.cmp-table-wrap { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: white; }
.cmp-table { width: 100%; font-size: 12.5px; border-collapse: collapse; }
.cmp-table thead { background: #f9fafb; }
.cmp-table th {
  padding: 0.5rem 0.5rem; text-align: left;
  font-size: 9.5px; font-weight: 500; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.cmp-table th.num { text-align: right; }
.cmp-table td { padding: 0.5rem 0.5rem; border-top: 1px solid #f3f4f6; }
.cmp-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cmp-table tr:hover td { background: #fafafa; }
.cmp-var-inline { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; }

/* En mobile ocultar columnas extra: dejar solo Sucursal | Ventas | Var */
.cmp-table .col-unid,
.cmp-table .col-unid-var,
.cmp-table .col-tkt,
.cmp-table .col-tkt-var,
.cmp-table .col-sales-year { display: none; }
@media (min-width: 640px) {
  .cmp-table .col-unid,
  .cmp-table .col-unid-var,
  .cmp-table .col-tkt,
  .cmp-table .col-tkt-var { display: table-cell; }
}

.cmp-anchor-note {
  font-size: 11.5px; color: #6b7280; font-style: italic;
  margin-bottom: 0.75rem;
}

.cmp-empty { padding: 1.5rem; text-align: center; color: #9ca3af; font-size: 13px; }
.cmp-error { font-size: 13px; color: #dc2626; background: #fef2f2; border-radius: 6px; padding: 0.625rem 0.875rem; }
.cmp-loading { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
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
              <AnchorNote anchorDate={data.anchorDate} />
              <MetricsMatrix aggregate={data.aggregate} />
              {isMonthly && data.byMonth && data.byMonth.length > 0 && <MonthlyChart data={data.byMonth} />}
              <BranchTable rows={data.byBranch} />
            </>
          )}
        </div>
      </section>
    </>
  );
}

function AnchorNote({ anchorDate }: { anchorDate?: string | null }) {
  if (!anchorDate) return null;
  const anchor = new Date(anchorDate);
  if (Number.isNaN(anchor.getTime())) return null;
  anchor.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (anchor.getTime() >= today.getTime()) return null;
  return (
    <p className="cmp-anchor-note">
      Período calculado hasta {anchor.toLocaleDateString("es-AR")} (último dato disponible)
    </p>
  );
}

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="cmp-period-bar">
      {PERIODS_SHORT.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={period === p ? "cmp-period-btn cmp-period-btn--active" : "cmp-period-btn"}>{p}</button>
      ))}
      <span className="cmp-period-divider">|</span>
      {PERIODS_MONTHLY.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={period === p ? "cmp-period-btn cmp-period-btn--active" : "cmp-period-btn"}>{p}</button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Matriz 3×3: métricas (Ventas, Unidades, Tickets) × (Este, Año anterior, Var)
// Desktop → tabla. Mobile → cards apiladas.
// ═══════════════════════════════════════════════════════════════════════════
function MetricsMatrix({ aggregate }: { aggregate: ComparativeResponse["aggregate"] }) {
  const rows: Array<{ key: string; label: string; metric: ComparativeMetric; fmt: (n: number) => string }> = [
    { key: "sales",   label: "Ventas $",  metric: aggregate.sales,   fmt: fmtARS },
    { key: "units",   label: "Unidades",  metric: aggregate.units,   fmt: fmtInt },
    { key: "tickets", label: "Tickets",   metric: aggregate.tickets, fmt: fmtInt },
  ];

  return (
    <div className="cmp-matrix-wrap">
      {/* Desktop: tabla 4 cols × 3 filas */}
      <table className="cmp-matrix">
        <thead>
          <tr>
            <th>Métrica</th>
            <th className="num">Este período</th>
            <th className="num">Año anterior</th>
            <th className="num">Variación</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.metric.variation;
            const VarIcon = VarIconOf(v);
            return (
              <tr key={r.key}>
                <td className="metric-label">{r.label}</td>
                <td className="num value-current">{r.fmt(r.metric.current)}</td>
                <td className="num value-past">
                  {r.metric.yearAgo > 0 ? r.fmt(r.metric.yearAgo) : <span style={{ color: "#9ca3af" }}>—</span>}
                </td>
                <td className="num" style={{ color: varColor(v) }}>
                  <span className="cmp-var-inline">
                    <VarIcon style={{ width: 14, height: 14 }} />
                    {formatVar(v)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Mobile: 3 cards apiladas */}
      <div className="cmp-matrix-cards">
        {rows.map((r, i) => {
          const v = r.metric.variation;
          const VarIcon = VarIconOf(v);
          return (
            <div key={r.key} className={i === 0 ? "cmp-mcard cmp-mcard--accent" : "cmp-mcard"}>
              <div className="cmp-mcard-title">{r.label}</div>
              <div className="cmp-mcard-row primary">
                <span className="label">Este período</span>
                <span className="value">{r.fmt(r.metric.current)}</span>
              </div>
              <div className="cmp-mcard-row sub">
                <span className="label">Año anterior</span>
                <span className="value">{r.metric.yearAgo > 0 ? r.fmt(r.metric.yearAgo) : "—"}</span>
              </div>
              <div className="cmp-mcard-row" style={{ marginTop: "0.375rem" }}>
                <span className="label">Variación</span>
                <span className="value" style={{ color: varColor(v), display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <VarIcon style={{ width: 14, height: 14 }} />
                  {formatVar(v)}
                </span>
              </div>
            </div>
          );
        })}
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
            <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} tickLine={false} axisLine={{ stroke: "#d1d5db" }} width={50} />
            <Tooltip formatter={(v) => (typeof v === "number" ? fmtARS(v) : String(v))}
              cursor={{ fill: "rgba(30, 45, 90, 0.05)" }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            <Bar dataKey="Actual"   fill={NAVY}   radius={[4, 4, 0, 0]} maxBarSize={40} />
            <Bar dataKey="Anterior" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BranchTable({ rows }: { rows: ComparativeBranchRow[] }) {
  if (rows.length === 0) {
    return <p className="cmp-empty">Sin datos por sucursal</p>;
  }
  return (
    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th>Sucursal</th>
            <th className="num">Ventas</th>
            <th className="num">Var%</th>
            <th className="num col-unid">Unidades</th>
            <th className="num col-unid-var">Var%</th>
            <th className="num col-tkt">Tickets</th>
            <th className="num col-tkt-var">Var%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <BranchRow key={r.branchId} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchRow({ row }: { row: ComparativeBranchRow }) {
  const renderVar = (v: number | null) => {
    const Icon = VarIconOf(v);
    return (
      <span className="cmp-var-inline" style={{ color: varColor(v) }}>
        <Icon style={{ width: 12, height: 12 }} />
        {formatVar(v)}
      </span>
    );
  };

  return (
    <tr>
      <td style={{ color: "#111827", fontWeight: 500 }}>{row.branchName}</td>
      <td className="num" style={{ color: "#1E2D5A", fontWeight: 600 }}>{fmtARS(row.sales.current)}</td>
      <td className="num">{renderVar(row.sales.variation)}</td>
      <td className="num col-unid"     style={{ color: "#374151" }}>{fmtInt(row.units.current)}</td>
      <td className="num col-unid-var">{renderVar(row.units.variation)}</td>
      <td className="num col-tkt"      style={{ color: "#374151" }}>{fmtInt(row.tickets.current)}</td>
      <td className="num col-tkt-var"> {renderVar(row.tickets.variation)}</td>
    </tr>
  );
}
