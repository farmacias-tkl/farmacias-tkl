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
type Period = typeof PERIODS_SHORT[number] | typeof PERIODS_MONTHLY[number] | "custom";

interface CustomRange {
  currentStart: string;  // YYYY-MM-DD
  currentEnd:   string;
  pastStart:    string;
  pastEnd:      string;
}
const EMPTY_CUSTOM: CustomRange = { currentStart: "", currentEnd: "", pastStart: "", pastEnd: "" };

function isCustomRangeValid(r: CustomRange): boolean {
  if (!r.currentStart || !r.currentEnd || !r.pastStart || !r.pastEnd) return false;
  if (r.currentStart > r.currentEnd) return false;  // string comparison funciona para YYYY-MM-DD
  if (r.pastStart    > r.pastEnd)    return false;
  return true;
}

function fmtDateAR(iso: string): string {
  // iso = YYYY-MM-DD -> DD/MM/YYYY (sin TZ shift)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

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
  if (v > 0)     return "#16a34a";
  if (v < 0)     return "#dc2626";
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
.cmp-matrix td { padding: 0.625rem 0.875rem; border-top: 1px solid #f3f4f6; vertical-align: middle; }
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
.cmp-table td { padding: 0.625rem 0.5rem; border-top: 1px solid #f3f4f6; }
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

.cmp-anchor-note-block { margin-bottom: 0.75rem; }
.cmp-anchor-main {
  font-size: 12px; color: #6b7280; margin: 0;
}
.cmp-anchor-sub {
  font-size: 10.5px; color: #9ca3af; margin: 0.125rem 0 0 0;
}

.cmp-empty { padding: 1.5rem; text-align: center; color: #9ca3af; font-size: 13px; }
.cmp-error { font-size: 13px; color: #dc2626; background: #fef2f2; border-radius: 6px; padding: 0.625rem 0.875rem; }
.cmp-loading { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
.cmp-loading > div { height: 70px; background: #f3f4f6; border-radius: 10px; animation: cmp-pulse 1.2s ease-in-out infinite; }
@keyframes cmp-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

/* === Panel comparativo personalizado === */
.cmp-custom-panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: white;
}
.cmp-custom-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.875rem;
}
@media (min-width: 640px) {
  .cmp-custom-grid { grid-template-columns: 1fr 1fr; gap: 1.25rem; }
}
.cmp-custom-col-title {
  font-size: 10px; color: #1E2D5A; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  margin: 0 0 0.5rem 0;
}
.cmp-custom-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.cmp-custom-field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.cmp-custom-field label {
  font-size: 10px; color: #6b7280; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.cmp-custom-field input {
  border: 1px solid #d1d5db; border-radius: 6px;
  padding: 0.4rem 0.5rem; font-size: 12.5px; color: #111827;
  background: white; outline: none; min-width: 0; width: 100%;
}
.cmp-custom-field input:focus { border-color: #1E2D5A; }
.cmp-custom-actions {
  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  margin-top: 0.875rem; padding-top: 0.875rem;
  border-top: 1px solid #f3f4f6;
}
.cmp-custom-apply {
  background: #1E2D5A; color: white;
  border: none; border-radius: 6px;
  padding: 0.5rem 1rem; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
}
.cmp-custom-apply:hover:not(:disabled) { background: #2a3d75; }
.cmp-custom-apply:disabled { background: #9ca3af; cursor: not-allowed; }
.cmp-custom-hint { font-size: 11px; color: #9ca3af; }
.cmp-custom-summary {
  font-size: 12.5px; color: #1E2D5A; font-weight: 500;
  background: #f3f4f6; border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}
.cmp-custom-summary strong { color: #111827; }
`;

export function ComparativeSection() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branch") ?? "ALL";
  const [period, setPeriod] = useState<Period>("30d");

  // Custom: draft = lo que el user esta editando; applied = lo aplicado al fetch.
  // No refetcheamos con cada keystroke — solo al click "Aplicar comparacion".
  const [customDraft,   setCustomDraft]   = useState<CustomRange>(EMPTY_CUSTOM);
  const [customApplied, setCustomApplied] = useState<CustomRange | null>(null);

  // Cuando el user cambia a "custom" sin haber aplicado, no fetcheamos hasta apply.
  // Cuando elige un preset, limpiamos el applied custom.
  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
    if (p !== "custom") setCustomApplied(null);
  };

  const isCustom        = period === "custom";
  const customReady     = isCustom && customApplied != null;
  const customCanApply  = isCustom && isCustomRangeValid(customDraft);
  const isMonthly       = PERIODS_MONTHLY.includes(period as typeof PERIODS_MONTHLY[number]);

  const { data, isLoading, error } = useQuery<ComparativeResponse>({
    // Cache key:
    //  - preset: ["comparative", period, branchId]
    //  - custom aplicado: ["comparative", "custom", customApplied, branchId]
    queryKey: isCustom
      ? ["comparative", "custom", customApplied, branchId]
      : ["comparative", period, branchId],
    queryFn:  async () => {
      const url = new URL("/api/dashboard/comparative", window.location.origin);
      url.searchParams.set("branchId", branchId);
      if (isCustom && customApplied) {
        url.searchParams.set("period",       "custom");
        url.searchParams.set("currentStart", customApplied.currentStart);
        url.searchParams.set("currentEnd",   customApplied.currentEnd);
        url.searchParams.set("pastStart",    customApplied.pastStart);
        url.searchParams.set("pastEnd",      customApplied.pastEnd);
      } else {
        url.searchParams.set("period", period);
      }
      const res = await fetch(url.toString());
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Error al cargar comparativo");
      }
      return res.json();
    },
    // Solo dispara fetch si: NO es custom, o (es custom Y hay applied)
    enabled: !isCustom || customReady,
  });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: COMP_CSS }} />
      <section className="exec-section">
        <div className="exec-section-header" style={{ gap: "1rem" }}>
          <h3 className="exec-section-title">Comparativo</h3>
          <PeriodSelector period={period} onChange={handlePeriodChange} />
        </div>
        <div className="exec-section-body exec-section-body-padded">
          {isCustom && (
            <CustomPanel
              draft={customDraft}
              onChange={setCustomDraft}
              onApply={() => setCustomApplied({ ...customDraft })}
              canApply={customCanApply}
              applied={customApplied}
            />
          )}

          {isCustom && !customReady && (
            <p className="cmp-empty">Definí los 4 rangos y hacé clic en &quot;Aplicar comparación&quot;.</p>
          )}

          {isLoading && customReady && (
            <div className="cmp-loading">
              <div /><div /><div />
            </div>
          )}
          {!isCustom && isLoading && (
            <div className="cmp-loading">
              <div /><div /><div />
            </div>
          )}
          {error && <p className="cmp-error">{(error as Error).message}</p>}
          {data && (
            <>
              {isCustom ? (
                customApplied && (
                  <p className="cmp-custom-summary">
                    Comparando <strong>{fmtDateAR(customApplied.currentStart)} – {fmtDateAR(customApplied.currentEnd)}</strong>
                    {" vs "}
                    <strong>{fmtDateAR(customApplied.pastStart)} – {fmtDateAR(customApplied.pastEnd)}</strong>
                  </p>
                )
              ) : (
                <AnchorNote
                  anchorDate={data.anchorDate}
                  branchId={branchId}
                  period={period}
                  byBranch={data.byBranch}
                />
              )}
              <MetricsMatrix aggregate={data.aggregate} isCustom={isCustom} />
              {!isCustom && isMonthly && data.byMonth && data.byMonth.length > 0 && (
                <MonthlyChart data={data.byMonth} />
              )}
              <BranchTable rows={data.byBranch} />
            </>
          )}
        </div>
      </section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CustomPanel: 4 inputs date + boton Aplicar
// ═══════════════════════════════════════════════════════════════════════════
function CustomPanel({
  draft, onChange, onApply, canApply, applied,
}: {
  draft:    CustomRange;
  onChange: (r: CustomRange) => void;
  onApply:  () => void;
  canApply: boolean;
  applied:  CustomRange | null;
}) {
  const update = (k: keyof CustomRange, v: string) => onChange({ ...draft, [k]: v });
  const draftEqualsApplied = applied
    && applied.currentStart === draft.currentStart
    && applied.currentEnd   === draft.currentEnd
    && applied.pastStart    === draft.pastStart
    && applied.pastEnd      === draft.pastEnd;
  const applyDisabled = !canApply || !!draftEqualsApplied;

  return (
    <div className="cmp-custom-panel">
      <div className="cmp-custom-grid">
        <div>
          <p className="cmp-custom-col-title">Período A</p>
          <div className="cmp-custom-fields">
            <div className="cmp-custom-field">
              <label>Desde</label>
              <input type="date" value={draft.currentStart}
                onChange={(e) => update("currentStart", e.target.value)} />
            </div>
            <div className="cmp-custom-field">
              <label>Hasta</label>
              <input type="date" value={draft.currentEnd}
                onChange={(e) => update("currentEnd", e.target.value)} />
            </div>
          </div>
        </div>
        <div>
          <p className="cmp-custom-col-title">Período B (comparación)</p>
          <div className="cmp-custom-fields">
            <div className="cmp-custom-field">
              <label>Desde</label>
              <input type="date" value={draft.pastStart}
                onChange={(e) => update("pastStart", e.target.value)} />
            </div>
            <div className="cmp-custom-field">
              <label>Hasta</label>
              <input type="date" value={draft.pastEnd}
                onChange={(e) => update("pastEnd", e.target.value)} />
            </div>
          </div>
        </div>
      </div>
      <div className="cmp-custom-actions">
        <button
          className="cmp-custom-apply"
          onClick={onApply}
          disabled={applyDisabled}
          title={!canApply ? "Las 4 fechas son obligatorias y desde ≤ hasta en cada período" : undefined}
        >
          Aplicar comparación
        </button>
        {!canApply && (
          <span className="cmp-custom-hint">Las 4 fechas son obligatorias. Desde ≤ Hasta en cada período.</span>
        )}
      </div>
    </div>
  );
}

// Parsea "YYYY-MM-DD..." como fecha local a mediodía para evitar shift por TZ.
function parseLocalDate(iso: string): Date | null {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

function AnchorNote({
  anchorDate, branchId, period, byBranch,
}: {
  anchorDate?: string | null;
  branchId:   string;
  period:     Period;
  byBranch:   ComparativeBranchRow[];
}) {
  if (!anchorDate) return null;
  const anchor = parseLocalDate(anchorDate);
  if (!anchor) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (anchor.getTime() >= today.getTime()) return null;

  const isMonthly  = /^\d+m$/.test(period);
  const n          = parseInt(period);
  const periodText = isMonthly ? `${n} meses` : `${n} días`;
  const dateText   = anchor.toLocaleDateString("es-AR");

  if (branchId === "ALL") {
    return (
      <div className="cmp-anchor-note-block">
        <p className="cmp-anchor-main">
          Últimos {periodText} hasta {dateText}
        </p>
        <p className="cmp-anchor-sub">
          Algunas sucursales pueden tener menos días operativos según actividad.
        </p>
      </div>
    );
  }

  const days = byBranch[0]?.currentDaysWithData ?? 0;
  return (
    <div className="cmp-anchor-note-block">
      <p className="cmp-anchor-main">
        Últimos {periodText} hasta {dateText} · {days} días con datos
      </p>
    </div>
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
      <span className="cmp-period-divider">|</span>
      <button onClick={() => onChange("custom")}
        className={period === "custom" ? "cmp-period-btn cmp-period-btn--active" : "cmp-period-btn"}>
        Personalizado
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Matriz 3×3: métricas (Ventas, Unidades, Tickets) × (Este, Año anterior, Var)
// Desktop → tabla. Mobile → cards apiladas.
// ═══════════════════════════════════════════════════════════════════════════
function MetricsMatrix({
  aggregate, isCustom,
}: {
  aggregate: ComparativeResponse["aggregate"];
  isCustom?: boolean;
}) {
  const rows: Array<{ key: string; label: string; metric: ComparativeMetric; fmt: (n: number) => string }> = [
    { key: "sales",   label: "Ventas $",  metric: aggregate.sales,   fmt: fmtARS },
    { key: "units",   label: "Unidades",  metric: aggregate.units,   fmt: fmtInt },
    { key: "tickets", label: "Tickets",   metric: aggregate.tickets, fmt: fmtInt },
  ];
  const labelCurrent = isCustom ? "Período A" : "Este período";
  const labelPast    = isCustom ? "Período B" : "Año anterior";

  return (
    <div className="cmp-matrix-wrap">
      {/* Desktop: tabla 4 cols × 3 filas */}
      <table className="cmp-matrix">
        <thead>
          <tr>
            <th>Métrica</th>
            <th className="num">{labelCurrent}</th>
            <th className="num">{labelPast}</th>
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
                <span className="label">{labelCurrent}</span>
                <span className="value">{r.fmt(r.metric.current)}</span>
              </div>
              <div className="cmp-mcard-row sub">
                <span className="label">{labelPast}</span>
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
