"use client";
import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, ShoppingBag, ChevronDown, ChevronRight, Search } from "lucide-react";
import type { BranchSales } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

// ─── Tipos para rawData SIAF ────────────────────────────────────
interface SiafVendorRaw { codigo: string; nombre: string; ventas: number; tickets: number; descuentos: number; }
interface SiafObraSocialRaw { codigo: string; nombre: string; ventas_bruto: number; descuentos: number; ventas_neto: number; }
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

.sal-row {
  display: grid;
  grid-template-columns: 20px 1fr auto auto;
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
.sal-total { font-size: 14px; font-weight: 700; color: #1E2D5A; white-space: nowrap; text-align: right; }
.sal-var {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  justify-content: flex-end;
}

.sal-extras { display: none; }
.sal-num-col {
  text-align: right; font-size: 12px; color: #6b7280;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
@media (min-width: 640px) {
  .sal-extras { display: block; }
  .sal-row { grid-template-columns: 20px 25fr 18fr 12fr 12fr 18fr 15fr; }
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

.sal-detail-list { display: flex; flex-direction: column; gap: 0.5rem; }
.sal-detail-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  font-size: 13px; gap: 0.5rem;
}
.sal-detail-item .label-col { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.sal-detail-item .label-line {
  display: flex; align-items: baseline; gap: 0.375rem; min-width: 0;
}
.sal-detail-item .cod {
  font-size: 10.5px; color: #9ca3af;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex-shrink: 0;
}
.sal-detail-item .label {
  color: #374151; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sal-detail-item .sub {
  font-size: 11px; color: #9ca3af; font-weight: 400; flex-shrink: 0;
}
.sal-detail-item .sub-line { font-size: 11px; color: #9ca3af; }
.sal-detail-item .value {
  color: #1E2D5A; font-weight: 700;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.sal-detail-placeholder {
  font-size: 12px; color: #9ca3af; font-style: italic;
  padding: 0.5rem 0; text-align: center;
}
.sal-detail-scroll { max-height: 260px; overflow-y: auto; padding-right: 0.25rem; }

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

/* Encabezado tabla solo desktop */
.sal-head {
  display: none; gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}
@media (min-width: 640px) {
  .sal-head {
    display: grid;
    grid-template-columns: 20px 25fr 18fr 12fr 12fr 18fr 15fr;
    align-items: center;
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
                <span className="num">Unid.</span>
                <span className="num">Compr.</span>
                <span className="num">Ticket prom.</span>
                <span className="num">vs ayer</span>
              </div>

              {sorted.map((s) => {
                const open = expanded.has(s.branchId);
                const v = s.vsYesterday;
                const VarIcon = v == null || v === 0 ? Minus : v > 0 ? TrendingUp : TrendingDown;
                const varColor = v == null ? "#9ca3af" : v > 0 ? "#059669" : v < 0 ? "#ef4444" : "#9ca3af";

                return (
                  <div key={s.branchId}>
                    <div className="sal-row" onClick={() => toggle(s.branchId)}>
                      {open
                        ? <ChevronDown style={{ width: 16, height: 16, color: "#9ca3af" }} />
                        : <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af" }} />}
                      <span className="sal-name">{s.branchName}</span>
                      <span className="sal-total">{fmtARS(s.totalSales)}</span>
                      <span className="sal-extras sal-num-col">{s.units > 0 ? fmtInt(s.units) : "—"}</span>
                      <span className="sal-extras sal-num-col">{s.receipts > 0 ? fmtInt(s.receipts) : "—"}</span>
                      <span className="sal-extras sal-num-col">{s.avgTicket > 0 ? fmtARS(s.avgTicket) : "—"}</span>
                      <span className="sal-var" style={{ color: varColor }}>
                        <VarIcon style={{ width: 14, height: 14 }} />
                        {v != null ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—"}
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
    <div className="sal-detail-list sal-detail-scroll">
      {filtered.map((o, i) => {
        const desc  = Number(o.descuentos  ?? 0);
        const bruto = Number(o.ventas_bruto ?? 0);
        return (
          <div key={`o-${i}`} className="sal-detail-item">
            <div className="label-col">
              <div className="label-line">
                {o.codigo && <span className="cod">[{o.codigo}]</span>}
                <span className="label">{o.nombre}</span>
                {/* TODO: agregar `tickets` por OS al CSV en siaf_to_drive.py */}
              </div>
              {desc > 0 && (
                <span className="sub-line">· desc {fmtARS(desc)}</span>
              )}
            </div>
            <span className="value">{fmtARS(bruto)}</span>
          </div>
        );
      })}
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
    <div className="sal-detail-list sal-detail-scroll">
      {filtered.map((v, i) => (
        <div key={`v-${i}`} className="sal-detail-item">
          <div className="label-col">
            <div className="label-line">
              {v.codigo && <span className="cod">[{v.codigo}]</span>}
              <span className="label">{v.nombre}</span>
              <span className="sub">· {fmtInt(v.tickets)} tk</span>
              {/* TODO: agregar `unidades` por vendedor al CSV en siaf_to_drive.py */}
            </div>
          </div>
          <span className="value">{fmtARS(Number(v.ventas ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}
