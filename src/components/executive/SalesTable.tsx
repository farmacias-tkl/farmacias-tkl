"use client";
import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, ShoppingBag, ChevronDown, ChevronRight } from "lucide-react";
import type { BranchSales } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

const SALES_CSS = `
/* Fila de sucursal (header clickeable) — mobile: 4 columnas */
.sal-row {
  display: grid;
  grid-template-columns: 20px 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  border-bottom: 1px solid #f3f4f6;
  transition: background 0.1s;
  background: white;
  min-width: 0;
}
.sal-row:hover { background: #f9fafb; }
.sal-row:last-child { border-bottom: none; }
.sal-name {
  font-size: 14px; font-weight: 600; color: #111827;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-align: left;
}
.sal-total { font-size: 14px; font-weight: 700; color: #1E2D5A; white-space: nowrap; text-align: right; }
.sal-var {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  justify-content: flex-end;
}

/* Columnas extras (Unidades, Comprobantes, Ticket) — solo desktop */
.sal-extras { display: none; }
.sal-num-col {
  text-align: right;
  font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (min-width: 640px) {
  .sal-extras { display: block; }
  /* Desktop: 7 columnas con fracciones proporcionales fijas
     chevron(20px) | sucursal(25) | ventas(18) | unid(12) | compr(12) | ticket(18) | var(15) */
  .sal-row {
    grid-template-columns: 20px 25fr 18fr 12fr 12fr 18fr 15fr;
  }
}

/* Detalle expandido */
.sal-detail {
  background: #fafafa;
  padding: 1rem;
  border-bottom: 1px solid #f3f4f6;
}
.sal-detail-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #6b7280; font-weight: 600; margin-bottom: 0.5rem;
}
.sal-detail-subtitle {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #1E2D5A; font-weight: 600; margin-bottom: 0.375rem;
}
.sal-detail-list {
  display: flex; flex-direction: column; gap: 0.375rem;
}
.sal-detail-item {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px; gap: 0.5rem;
}
.sal-detail-item .label { color: #374151; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sal-detail-item .value { color: #1E2D5A; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sal-detail-item .sub   { font-size: 11px; color: #9ca3af; margin-left: 0.375rem; font-weight: 400; }
.sal-detail-placeholder {
  font-size: 12px; color: #9ca3af; font-style: italic;
  padding: 0.375rem 0;
}
.sal-detail-divider {
  border: none; border-top: 1px dashed #e5e7eb;
  margin: 0.75rem 0;
}
.sal-detail-scroll {
  max-height: 260px; overflow-y: auto;
  padding-right: 0.25rem;
}

/* Encabezado tabla solo desktop, misma grid que .sal-row */
.sal-head {
  display: none;
  gap: 0.5rem;
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
  font-size: 10px;
  color: #6b7280; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;
}
.sal-head .num { text-align: right; }

.sal-empty { padding: 2rem 1rem; text-align: center; color: #9ca3af; }
`;

export function SalesTable({ sales }: { sales: BranchSales[] }) {
  const sorted = [...sales].sort((a, b) => b.totalSales - a.totalSales);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (sorted.length === 0) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: SALES_CSS }} />
        <section className="exec-section">
          <div className="exec-section-header">
            <h3 className="exec-section-title">Ventas por sucursal</h3>
          </div>
          <div className="exec-section-body">
            <div className="sal-empty">
              <ShoppingBag style={{ width: 32, height: 32, color: "#d1d5db", margin: "0 auto 0.5rem" }} />
              <p>Sin datos de ventas para mostrar.</p>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SALES_CSS }} />
      <section className="exec-section">
        <div className="exec-section-header">
          <h3 className="exec-section-title">Ventas por sucursal</h3>
          <span className="exec-section-meta">{sorted.length} sucursales</span>
        </div>
        <div className="exec-section-body">
          {/* Encabezado (solo desktop) */}
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
            const varColor = v == null ? "#9ca3af"
              : v > 0 ? "#059669"
              : v < 0 ? "#ef4444" : "#9ca3af";
            const VarIcon = v == null || v === 0 ? Minus : v > 0 ? TrendingUp : TrendingDown;

            return (
              <div key={s.branchId}>
                <div className="sal-row" onClick={() => toggle(s.branchId)}>
                  {open
                    ? <ChevronDown style={{ width: 16, height: 16, color: "#9ca3af" }} />
                    : <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af" }} />}
                  <span className="sal-name">{s.branchName}</span>
                  <span className="sal-total">{fmtARS(s.totalSales)}</span>
                  {/* Extras desktop */}
                  <span className="sal-extras sal-num-col">{fmtInt(s.units)}</span>
                  <span className="sal-extras sal-num-col">{fmtInt(s.receipts)}</span>
                  <span className="sal-extras sal-num-col">{fmtARS(s.avgTicket)}</span>
                  <span className="sal-var" style={{ color: varColor }}>
                    <VarIcon style={{ width: 14, height: 14 }} />
                    {v != null ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—"}
                  </span>
                </div>
                {open && <SalesDetail sales={s} />}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

interface SiafVendorRaw {
  codigo: string; nombre: string; ventas: number; tickets: number; descuentos: number;
}
interface SiafObraSocialRaw {
  codigo: string; nombre: string; ventas_bruto: number; descuentos: number; ventas_neto: number;
}
interface SiafRawData {
  source?: string;
  efectivo?: number;
  tarjeta?: number;
  obra_social?: number;
  vendedores?: SiafVendorRaw[];
  obras_sociales?: SiafObraSocialRaw[];
}

function SalesDetail({ sales }: { sales: BranchSales }) {
  const isSiaf = sales.dataSource === "siaf";
  const raw = sales.rawData as SiafRawData | null | undefined;

  const vendedores = Array.isArray(raw?.vendedores) ? raw!.vendedores : [];
  const obrasSoc   = Array.isArray(raw?.obras_sociales) ? raw!.obras_sociales : [];

  return (
    <div className="sal-detail">
      {/* Forma de pago */}
      <div className="sal-detail-title">Detalle por forma de pago</div>
      <div className="sal-detail-list">
        {isSiaf && raw ? (
          <>
            <div className="sal-detail-item">
              <span className="label">Efectivo</span>
              <span className="value">{fmtARS(Number(raw.efectivo ?? 0))}</span>
            </div>
            <div className="sal-detail-item">
              <span className="label">Tarjeta</span>
              <span className="value">{fmtARS(Number(raw.tarjeta ?? 0))}</span>
            </div>
            <div className="sal-detail-item">
              <span className="label">Obra social</span>
              <span className="value">{fmtARS(Number(raw.obra_social ?? 0))}</span>
            </div>
          </>
        ) : (
          <div className="sal-detail-placeholder">
            Detalle por forma de pago: pendiente de datos reales
          </div>
        )}
      </div>

      <hr className="sal-detail-divider" />

      {/* Vendedores */}
      {vendedores.length > 0 ? (
        <>
          <div className="sal-detail-subtitle">Por vendedor ({vendedores.length})</div>
          <div className="sal-detail-list sal-detail-scroll">
            {vendedores.map((v, i) => (
              <div key={`v-${i}`} className="sal-detail-item">
                <span className="label">
                  {v.nombre}
                  <span className="sub">· {v.tickets} tk</span>
                </span>
                <span className="value">{fmtARS(Number(v.ventas ?? 0))}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="sal-detail-placeholder">
          Detalle por vendedor: pendiente de datos reales
        </div>
      )}

      <hr className="sal-detail-divider" />

      {/* Obras sociales */}
      {obrasSoc.length > 0 ? (
        <>
          <div className="sal-detail-subtitle">Por obra social ({obrasSoc.length})</div>
          <div className="sal-detail-list sal-detail-scroll">
            {obrasSoc.map((o, i) => (
              <div key={`o-${i}`} className="sal-detail-item">
                <span className="label">
                  {o.nombre}
                  {Number(o.descuentos ?? 0) > 0 && (
                    <span className="sub">· desc {fmtARS(Number(o.descuentos))}</span>
                  )}
                </span>
                <span className="value">{fmtARS(Number(o.ventas_neto ?? 0))}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="sal-detail-placeholder">
          Detalle por obra social: pendiente de datos reales
        </div>
      )}
    </div>
  );
}
