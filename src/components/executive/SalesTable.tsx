"use client";
import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, ShoppingBag, ChevronDown, ChevronRight, Search } from "lucide-react";
import type { BranchSales } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

// Formato abreviado para mobile: 105.530.538 -> "105.5M", 432.678 -> "433K"
// Threshold 999_500 evita "1000K" y bumpea a "1.0M" cuando corresponde.
function fmtAbbrev(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)   return `${Math.round(n / 1_000)}K`;
  return Math.round(n).toString();
}

// ─── Tipos para rawData SIAF ────────────────────────────────────
interface SiafVendorRaw { codigo: string; nombre: string; ventas: number; tickets: number; descuentos: number; unidades?: number; }
interface SiafObraSocialRaw { codigo: string; nombre: string; ventas_bruto: number; descuentos: number; ventas_neto: number; tickets?: number; unidades?: number; }
interface SiafRawData {
  source?: string;
  efectivo?: number;
  tarjeta?: number;
  obra_social?: number;
  vendedores?: SiafVendorRaw[];
  obras_sociales?: SiafObraSocialRaw[];
}

const getRaw = (s: BranchSales): SiafRawData | null =>
  (s.rawData && typeof s.rawData === "object") ? (s.rawData as SiafRawData) : null;

// ═══════════════════════════════════════════════════════════════════════════
// Estilos
// ═══════════════════════════════════════════════════════════════════════════
const SALES_CSS = `
.sal-filters {
  display: grid; gap: 0.5rem;
  grid-template-columns: 1fr 1fr;
  padding: 0.75rem 1rem;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}
.sal-filter-field {
  display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;
}
.sal-filter-label {
  font-size: 9.5px; font-weight: 600; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.sal-filter-select {
  width: 100%; min-width: 0;
  padding: 0.4rem 0.5rem;
  border: 1px solid #d1d5db; border-radius: 6px;
  background: white; font-size: 12.5px; color: #111827;
  outline: none;
}
.sal-filter-select:focus { border-color: #1E2D5A; }
.sal-filter-select:disabled { background: #f3f4f6; color: #9ca3af; cursor: not-allowed; }
.sal-filter-disabled-note {
  font-size: 10px; color: #9ca3af; font-style: italic;
  grid-column: 1 / -1; text-align: center; margin-top: 0.125rem;
}

/* === ROW (mobile + desktop) ===
   Mobile: 5 cols (chevron | sucursal | ventas-abrev | T | U).
   Desktop: 7 cols (chevron | sucursal | ventas-full | unid | compr | ticket-prom | vs-ayer). */
.sal-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 64px 80px;
  align-items: center; gap: 0.5rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  border-bottom: 1px solid #f3f4f6;
  transition: background 0.1s;
  background: white; min-width: 0;
}
.sal-row:hover { background: #f9fafb; }
.sal-row:last-child { border-bottom: none; }
.sal-name {
  font-size: 14px; font-weight: 600; color: #111827;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
}
.sal-total {
  font-size: 14px; font-weight: 700; color: #1E2D5A;
  white-space: nowrap; text-align: right;
  font-variant-numeric: tabular-nums;
}
.sal-var {
  /* Hidden mobile, inline-flex desktop. */
  display: none;
  align-items: center; gap: 0.25rem;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.sal-extras { display: none; }
.sal-num-col {
  text-align: right; font-size: 12px; color: #6b7280;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* Mobile: invertir orden visual de tickets/unidades.
   El DOM las renderiza units -> receipts (porque desktop muestra "Unid."
   antes que "Compr."), pero mobile pide "T (tickets) antes de U (unidades)". */
@media (max-width: 639px) {
  .sal-cell-receipts { order: 1; }
  .sal-cell-units    { order: 2; }
}

/* Visibilidad mobile/desktop para celdas de header y total ventas. */
.sal-head-desktop  { display: none; }
.sal-head-mobile   { display: block; }
.sal-total-mobile  { display: inline; }
.sal-total-desktop { display: none; }

@media (min-width: 640px) {
  .sal-row    { grid-template-columns: 20px 25fr 18fr 12fr 12fr 18fr 15fr; gap: 1rem; }
  .sal-extras { display: block; }
  .sal-var    { display: inline-flex; }
  .sal-head-desktop  { display: block; }
  .sal-head-mobile   { display: none; }
  .sal-total-mobile  { display: none; }
  .sal-total-desktop { display: inline; }
}

/* Detalle expandido */
.sal-detail { background: #fafafa; padding: 1rem; border-bottom: 1px solid #f3f4f6; }

/* Tabs dentro del detalle */
.sal-tabs {
  display: flex; gap: 0.25rem; margin-bottom: 0.875rem;
  border-bottom: 1px solid #e5e7eb; overflow-x: auto; scrollbar-width: none;
}
.sal-tabs::-webkit-scrollbar { display: none; }
.sal-tab {
  padding: 0.5rem 0.875rem; font-size: 11.5px; font-weight: 600;
  color: #6b7280; background: transparent; border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer; white-space: nowrap;
  text-transform: uppercase; letter-spacing: 0.04em;
  transition: all 0.15s;
}
.sal-tab:hover { color: #1E2D5A; }
.sal-tab--active { color: #1E2D5A; border-bottom-color: #D4632A; }

.sal-detail-list { display: flex; flex-direction: column; }
.sal-detail-placeholder {
  font-size: 12px; color: #9ca3af; font-style: italic;
  padding: 0.5rem 0; text-align: center;
}
.sal-detail-scroll { max-height: 260px; overflow-y: auto; padding-right: 0.25rem; }

/* Mini header solo desktop — fijo arriba, no scrollea con la lista */
.sal-grid-head { display: none; }
@media (min-width: 640px) {
  .sal-grid-head {
    display: grid;
    grid-template-columns: 48px 1fr 64px 64px 100px;
    column-gap: 0.5rem;
    padding: 0.25rem 0 0.375rem 0;
    border-bottom: 1px solid #e5e7eb;
    margin-bottom: 0.25rem;
  }
  .sal-grid-head span {
    font-size: 10px; color: #9ca3af; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .sal-grid-head .num { text-align: right; }
}

/* Item: mobile = 2 columnas + sub-line debajo · desktop = 5 columnas en línea */
.sal-grid-item {
  display: grid;
  align-items: center;
  font-size: 13px;
  padding: 0.5rem 0;
  border-bottom: 1px solid #f3f4f6;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "label value"
    "sub   sub";
  column-gap: 0.5rem; row-gap: 2px;
}
.sal-grid-item:last-child { border-bottom: none; }
.sal-grid-item .cell-cod,
.sal-grid-item .cell-unid,
.sal-grid-item .cell-tkt { display: none; }
.sal-grid-item .cell-label {
  grid-area: label; min-width: 0;
  display: flex; align-items: baseline; gap: 0.375rem;
}
.sal-grid-item .cell-label .cod-inline {
  font-size: 10.5px; color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex-shrink: 0;
}
.sal-grid-item .cell-label .name {
  color: #1E2D5A; font-weight: 500; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sal-grid-item .cell-value {
  grid-area: value; color: #1E2D5A; font-weight: 700;
  font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right;
}
.sal-grid-item .cell-sub {
  grid-area: sub; font-size: 11px; color: #4b5563;
  font-variant-numeric: tabular-nums;
}

@media (min-width: 640px) {
  .sal-grid-item {
    grid-template-columns: 48px 1fr 64px 64px 100px;
    grid-template-areas: "cod label unid tkt value";
    row-gap: 0; padding: 0.375rem 0;
  }
  .sal-grid-item .cell-cod {
    display: block; grid-area: cod;
    font-size: 10.5px; color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sal-grid-item .cell-label .cod-inline { display: none; }
  .sal-grid-item .cell-unid,
  .sal-grid-item .cell-tkt {
    display: block; text-align: right;
    color: #4b5563; font-variant-numeric: tabular-nums;
  }
  .sal-grid-item .cell-unid { grid-area: unid; }
  .sal-grid-item .cell-tkt  { grid-area: tkt; }
  .sal-grid-item .cell-sub  { display: none; }
}

.sal-search {
  display: flex; align-items: center; gap: 0.375rem;
  padding: 0.375rem 0.625rem; margin-bottom: 0.625rem;
  border: 1px solid #d1d5db; border-radius: 6px;
  background: white;
}
.sal-search input {
  flex: 1; border: none; outline: none;
  font-size: 12.5px; background: transparent; min-width: 0;
}
.sal-search-empty { font-size: 12px; color: #9ca3af; font-style: italic; padding: 0.375rem 0; text-align: center; }

/* Encabezado tabla — visible mobile y desktop con grids distintos. */
.sal-head {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 64px 80px;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  align-items: center;
}
@media (min-width: 640px) {
  .sal-head {
    grid-template-columns: 20px 25fr 18fr 12fr 12fr 18fr 15fr;
    gap: 1rem;
  }
}
.sal-head span {
  font-size: 10px; color: #6b7280; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.sal-head .num { text-align: right; }

.sal-empty { padding: 2rem 1rem; text-align: center; color: #9ca3af; }
`;

// ═══════════════════════════════════════════════════════════════════════════
// Filtros globales: agrega opciones de OS y vendedor desde todas las sucursales
// ═══════════════════════════════════════════════════════════════════════════
interface FilterOption { key: string; label: string; }

function buildFilterOptions(sales: BranchSales[]): { os: FilterOption[]; vendedores: FilterOption[] } {
  const osMap     = new Map<string, string>();
  const vendorMap = new Map<string, string>();
  for (const s of sales) {
    const raw = getRaw(s);
    if (!raw) continue;
    for (const o of raw.obras_sociales ?? []) {
      if (o.codigo) osMap.set(o.codigo, o.nombre || o.codigo);
    }
    for (const v of raw.vendedores ?? []) {
      if (v.codigo) vendorMap.set(v.codigo, v.nombre || v.codigo);
    }
  }
  const toSorted = (m: Map<string, string>): FilterOption[] =>
    Array.from(m.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return { os: toSorted(osMap), vendedores: toSorted(vendorMap) };
}

// Cuando hay filtro activo, transforma cada BranchSales a un "virtual" BranchSales
// con solo el subset del OS/vendedor seleccionado. Si la sucursal no tiene esa OS/vendedor, se omite.
function applyFilter(
  sales: BranchSales[],
  osFilter: string,
  vendorFilter: string,
): BranchSales[] {
  if (osFilter === "ALL" && vendorFilter === "ALL") return sales;

  const result: BranchSales[] = [];
  for (const s of sales) {
    const raw = getRaw(s);
    if (!raw) continue;

    if (osFilter !== "ALL") {
      const os = (raw.obras_sociales ?? []).find((o) => o.codigo === osFilter);
      if (!os) continue;
      result.push({
        ...s,
        totalSales:  os.ventas_neto,
        units:       0,
        receipts:    0,
        avgTicket:   0,
        vsYesterday: null,
      });
      continue;
    }
    if (vendorFilter !== "ALL") {
      const v = (raw.vendedores ?? []).find((x) => x.codigo === vendorFilter);
      if (!v) continue;
      const avg = v.tickets > 0 ? v.ventas / v.tickets : 0;
      result.push({
        ...s,
        totalSales:  v.ventas,
        units:       0,
        receipts:    v.tickets,
        avgTicket:   avg,
        vsYesterday: null,
      });
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// SalesTable
// ═══════════════════════════════════════════════════════════════════════════
export function SalesTable({ sales }: { sales: BranchSales[] }) {
  const [osFilter,     setOsFilter]     = useState<string>("ALL");
  const [vendorFilter, setVendorFilter] = useState<string>("ALL");
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set());

  const { os: osOptions, vendedores: vendorOptions } = useMemo(() => buildFilterOptions(sales), [sales]);
  const filtersDisabled = osOptions.length === 0 && vendorOptions.length === 0;

  // Si el OS filter y el vendor filter están activos a la vez, priorizo OS y reseteo vendor.
  // (Son mutuamente excluyentes — solo uno a la vez para no combinar filtros raros.)
  const effectiveOs     = osFilter;
  const effectiveVendor = osFilter !== "ALL" ? "ALL" : vendorFilter;

  const filtered = useMemo(
    () => applyFilter(sales, effectiveOs, effectiveVendor),
    [sales, effectiveOs, effectiveVendor],
  );
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.totalSales - a.totalSales),
    [filtered],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filterActive = effectiveOs !== "ALL" || effectiveVendor !== "ALL";
  const someExpanded = expanded.size > 0;
  const expandAll   = () => setExpanded(new Set(sorted.map((s) => s.branchId)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SALES_CSS }} />
      <section className="exec-section">
        <div className="exec-section-header">
          <h3 className="exec-section-title">Ventas por sucursal</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="exec-section-meta">
              {sales.length} sucursales
              {filterActive && ` · ${sorted.length} con datos filtrados`}
            </span>
            {sorted.length > 0 && (
              <button
                className="exec-section-header-btn"
                onClick={someExpanded ? collapseAll : expandAll}
              >
                {someExpanded ? "Comprimir todo" : "Expandir todo"}
              </button>
            )}
          </div>
        </div>

        <div className="exec-section-body">
          {/* Filtros globales */}
          <GlobalFilters
            os={osFilter}
            vendor={vendorFilter}
            osOptions={osOptions}
            vendorOptions={vendorOptions}
            disabled={filtersDisabled}
            onOsChange={(v) => { setOsFilter(v); if (v !== "ALL") setVendorFilter("ALL"); }}
            onVendorChange={(v) => { setVendorFilter(v); if (v !== "ALL") setOsFilter("ALL"); }}
          />

          {sorted.length === 0 ? (
            <div className="sal-empty">
              <ShoppingBag style={{ width: 32, height: 32, color: "#d1d5db", margin: "0 auto 0.5rem" }} />
              <p>{filterActive ? "Ninguna sucursal tiene datos para este filtro." : "Sin datos de ventas para mostrar."}</p>
            </div>
          ) : (
            <>
              <div className="sal-head">
                <span></span>
                <span>Sucursal</span>
                <span className="num">Ventas</span>
                <span className="num sal-head-desktop">Unid.</span>
                <span className="num sal-head-desktop">Compr.</span>
                <span className="num sal-head-desktop">Ticket prom.</span>
                <span className="num sal-head-desktop">vs ayer</span>
                <span className="num sal-head-mobile">T</span>
                <span className="num sal-head-mobile">U</span>
              </div>

              {sorted.map((s) => {
                const open = expanded.has(s.branchId);
                const v = s.vsYesterday;
                const isValidV = v != null && Number.isFinite(v);
                const VarIcon  = !isValidV || v === 0 ? Minus : v! > 0 ? TrendingUp : TrendingDown;
                const varColor = !isValidV ? "#9ca3af" : v! > 0 ? "#059669" : v! < 0 ? "#ef4444" : "#9ca3af";
                const ChevronIcon = open ? ChevronDown : ChevronRight;

                return (
                  <div key={s.branchId}>
                    <div className="sal-row" onClick={() => toggle(s.branchId)}>
                      <ChevronIcon style={{ width: 16, height: 16, color: "#9ca3af" }} />
                      <span className="sal-name">{s.branchName}</span>
                      <span className="sal-total" title={fmtARS(s.totalSales)}>
                        <span className="sal-total-mobile">{fmtAbbrev(s.totalSales)}</span>
                        <span className="sal-total-desktop">{fmtARS(s.totalSales)}</span>
                      </span>
                      <span className="sal-num-col sal-cell-units">{s.units > 0 ? fmtInt(s.units) : "—"}</span>
                      <span className="sal-num-col sal-cell-receipts">{s.receipts > 0 ? fmtInt(s.receipts) : "—"}</span>
                      <span className="sal-extras sal-num-col">{s.avgTicket > 0 ? fmtARS(s.avgTicket) : "—"}</span>
                      <span
                        className="sal-var"
                        style={{ color: varColor }}
                        title={!isValidV ? "Sin base de comparación (día anterior sin actividad)" : undefined}
                      >
                        <VarIcon style={{ width: 14, height: 14 }} />
                        {isValidV ? `${v! > 0 ? "+" : ""}${v!.toFixed(1)}%` : "N/A"}
                      </span>
                    </div>
                    {open && <SalesDetail sales={s} />}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Filtros globales
// ═══════════════════════════════════════════════════════════════════════════
function GlobalFilters({
  os, vendor, osOptions, vendorOptions, disabled,
  onOsChange, onVendorChange,
}: {
  os: string;
  vendor: string;
  osOptions: FilterOption[];
  vendorOptions: FilterOption[];
  disabled: boolean;
  onOsChange: (v: string) => void;
  onVendorChange: (v: string) => void;
}) {
  return (
    <div className="sal-filters">
      <div className="sal-filter-field">
        <label className="sal-filter-label">Obra Social</label>
        <select
          className="sal-filter-select"
          value={os}
          onChange={(e) => onOsChange(e.target.value)}
          disabled={disabled}
          title={disabled ? "Disponible con datos reales" : undefined}
        >
          <option value="ALL">Todas</option>
          {osOptions.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="sal-filter-field">
        <label className="sal-filter-label">Vendedor</label>
        <select
          className="sal-filter-select"
          value={vendor}
          onChange={(e) => onVendorChange(e.target.value)}
          disabled={disabled}
          title={disabled ? "Disponible con datos reales" : undefined}
        >
          <option value="ALL">Todos</option>
          {vendorOptions.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </div>
      {disabled && (
        <div className="sal-filter-disabled-note">
          Filtros disponibles con datos reales (SIAF)
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Detalle expandido con tabs
// ═══════════════════════════════════════════════════════════════════════════
type DetailTab = "os" | "vendedor";

function SalesDetail({ sales }: { sales: BranchSales }) {
  const [tab, setTab]       = useState<DetailTab>("os");
  const [search, setSearch] = useState("");

  const raw = getRaw(sales);
  const vendedores = Array.isArray(raw?.vendedores) ? raw!.vendedores : [];
  const obrasSoc   = Array.isArray(raw?.obras_sociales) ? raw!.obras_sociales : [];

  // Reset del search al cambiar de tab
  const onTabChange = (t: DetailTab) => {
    setTab(t);
    setSearch("");
  };

  return (
    <div className="sal-detail">
      {/* Tabs */}
      <div className="sal-tabs" role="tablist">
        <button
          role="tab"
          className={tab === "os" ? "sal-tab sal-tab--active" : "sal-tab"}
          onClick={() => onTabChange("os")}
        >
          Obra Social
        </button>
        <button
          role="tab"
          className={tab === "vendedor" ? "sal-tab sal-tab--active" : "sal-tab"}
          onClick={() => onTabChange("vendedor")}
        >
          Vendedor
        </button>
      </div>

      {/* Contenido del tab activo */}
      {tab === "os" && (
        obrasSoc.length > 0 ? (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar obra social..." />
            <OSSocialList rows={obrasSoc} search={search} />
          </>
        ) : (
          <div className="sal-detail-placeholder">
            Detalle por obra social: pendiente de datos reales
          </div>
        )
      )}

      {tab === "vendedor" && (
        vendedores.length > 0 ? (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar vendedor..." />
            <VendorList rows={vendedores} search={search} />
          </>
        ) : (
          <div className="sal-detail-placeholder">
            Detalle por vendedor: pendiente de datos reales
          </div>
        )
      )}
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="sal-search">
      <Search style={{ width: 14, height: 14, color: "#9ca3af" }} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Línea secundaria mobile: combina tickets + unidades respetando ceros.
// - ambos 0           → ""        (no se renderiza la sub-line)
// - solo tickets > 0  → "Tickets: X"
// - solo unidades > 0 → "Unidades: Y"
// - ambos > 0         → "Tickets: X · Unidades: Y"
function buildSubLine(tickets: number, unidades: number): string {
  if (tickets <= 0 && unidades <= 0) return "";
  if (unidades <= 0)                 return `Tickets: ${fmtInt(tickets)}`;
  if (tickets  <= 0)                 return `Unidades: ${fmtInt(unidades)}`;
  return `Tickets: ${fmtInt(tickets)} · Unidades: ${fmtInt(unidades)}`;
}

function OSSocialList({ rows, search }: { rows: SiafObraSocialRaw[]; search: string }) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? rows.filter((o) => o.nombre.toLowerCase().includes(q) || o.codigo.toLowerCase().includes(q))
      : [...rows];
    return list.sort((a, b) => Number(b.ventas_bruto) - Number(a.ventas_bruto));
  }, [rows, search]);

  if (filtered.length === 0) return <div className="sal-search-empty">Sin coincidencias</div>;

  return (
    <div>
      <div className="sal-grid-head">
        <span>Cod</span>
        <span>Obra Social</span>
        <span className="num">Unid.</span>
        <span className="num">Tickets</span>
        <span className="num">Ventas</span>
      </div>
      <div className="sal-detail-scroll">
        <div className="sal-detail-list">
          {filtered.map((o, i) => {
            const bruto    = Number(o.ventas_bruto ?? 0);
            const tickets  = Number(o.tickets  ?? 0);
            const unidades = Number(o.unidades ?? 0);
            const sub      = buildSubLine(tickets, unidades);
            return (
              <div key={`o-${i}`} className="sal-grid-item">
                <span className="cell-cod">{o.codigo ? `[${o.codigo}]` : ""}</span>
                <span className="cell-label">
                  {o.codigo && <span className="cod-inline">[{o.codigo}]</span>}
                  <span className="name">{o.nombre}</span>
                </span>
                <span className="cell-unid">{unidades > 0 ? fmtInt(unidades) : "—"}</span>
                <span className="cell-tkt">{tickets  > 0 ? fmtInt(tickets)  : "—"}</span>
                <span className="cell-value">{fmtARS(bruto)}</span>
                {sub && <span className="cell-sub">{sub}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VendorList({ rows, search }: { rows: SiafVendorRaw[]; search: string }) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? rows.filter((v) => v.nombre.toLowerCase().includes(q) || v.codigo.toLowerCase().includes(q))
      : [...rows];
    return list.sort((a, b) => Number(b.ventas) - Number(a.ventas));
  }, [rows, search]);

  if (filtered.length === 0) return <div className="sal-search-empty">Sin coincidencias</div>;

  return (
    <div>
      <div className="sal-grid-head">
        <span>Cod</span>
        <span>Vendedor</span>
        <span className="num">Unid.</span>
        <span className="num">Tickets</span>
        <span className="num">Ventas</span>
      </div>
      <div className="sal-detail-scroll">
        <div className="sal-detail-list">
          {filtered.map((v, i) => {
            const ventas   = Number(v.ventas ?? 0);
            const tickets  = Number(v.tickets  ?? 0);
            const unidades = Number(v.unidades ?? 0);
            const sub      = buildSubLine(tickets, unidades);
            return (
              <div key={`v-${i}`} className="sal-grid-item">
                <span className="cell-cod">{v.codigo ? `[${v.codigo}]` : ""}</span>
                <span className="cell-label">
                  {v.codigo && <span className="cod-inline">[{v.codigo}]</span>}
                  <span className="name">{v.nombre}</span>
                </span>
                <span className="cell-unid">{unidades > 0 ? fmtInt(unidades) : "—"}</span>
                <span className="cell-tkt">{tickets  > 0 ? fmtInt(tickets)  : "—"}</span>
                <span className="cell-value">{fmtARS(ventas)}</span>
                {sub && <span className="cell-sub">{sub}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
