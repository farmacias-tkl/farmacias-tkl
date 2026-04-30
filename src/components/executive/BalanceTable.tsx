"use client";
import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Building2 } from "lucide-react";
import type { BranchBalance } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

const BALANCE_CSS = `
/* Lista de sucursales (común desktop + mobile) */
.bal-branch-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  cursor: pointer;
  border-bottom: 1px solid #f3f4f6;
  transition: background 0.1s;
  background: white;
  min-width: 0;
}
.bal-branch-row:hover { background: #f9fafb; }
.bal-branch-row:last-child { border-bottom: none; }
.bal-branch-name {
  font-size: 14px; font-weight: 600; color: #1E2D5A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bal-branch-total {
  font-size: 14px; font-weight: 700; color: #1E2D5A; white-space: nowrap;
}

/* Mobile-first: mobile visible por default, desktop oculto */
.bal-detail-mobile  { display: block; background: #fafafa; padding: 0.5rem 1rem 1rem 1rem; }
.bal-detail-desktop { display: none; }

/* Desktop (≥640px): override — mobile oculto, desktop visible */
@media (min-width: 640px) {
  .bal-detail-mobile  { display: none; }
  .bal-detail-desktop { display: block; padding: 0.5rem 1rem 1rem 1rem; background: #fafafa; }
}

/* === DESKTOP: grid compartido entre header y filas === */
.bal-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 1fr 0.8fr 1fr;
  align-items: center;
  column-gap: 1rem;
  padding: 0.5rem 0.5rem;
  min-width: 0;
}
.bal-grid > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bal-grid-head {
  border-bottom: 1px solid #e5e7eb;
  padding-top: 0.375rem; padding-bottom: 0.375rem;
}
.bal-grid-head span {
  font-size: 10px; color: #6b7280; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.bal-grid-head span.num,
.bal-grid-row  span.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.bal-grid-row {
  border-top: 1px solid #f3f4f6;
  font-size: 12px;
  color: #374151;
}
.bal-row-balance   { color: #111827; font-weight: 500; }
.bal-row-secondary { color: #6b7280; }

/* === MOBILE: cards apiladas === */
.bal-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.625rem 0.75rem;
  margin-bottom: 0.5rem;
}
.bal-card:last-child { margin-bottom: 0; }
.bal-card-title {
  font-size: 12px; font-weight: 600; color: #111827;
  margin-bottom: 0.375rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bal-card-row {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 0.5rem;
  font-size: 12px; padding: 2px 0;
}
.bal-card-row .label { color: #6b7280; flex-shrink: 0; }
.bal-card-row .value {
  color: #374151; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.bal-card-row.primary .label { color: #1E2D5A; font-weight: 600; }
.bal-card-row.primary .value { color: #1E2D5A; font-weight: 700; font-size: 13px; }

.bal-empty { padding: 2rem 1rem; text-align: center; color: #9ca3af; }
`;

export function BalanceTable({ balances }: { balances: BranchBalance[] }) {
  // PRIORIDAD 4: expandido por default → Set con todos los branchIds iniciales
  const allIds = useMemo(() => new Set(balances.map(b => b.branchId)), [balances]);
  const [expanded, setExpanded] = useState<Set<string>>(allIds);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const expandAll   = () => setExpanded(new Set(balances.map(b => b.branchId)));
  const collapseAll = () => setExpanded(new Set());

  if (balances.length === 0) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: BALANCE_CSS }} />
        <section className="exec-section">
          <div className="exec-section-header">
            <h3 className="exec-section-title">Saldos por sucursal</h3>
          </div>
          <div className="exec-section-body">
            <div className="bal-empty">
              <Building2 style={{ width: 32, height: 32, color: "#d1d5db", margin: "0 auto 0.5rem" }} />
              <p>Sin saldos bancarios para mostrar.</p>
            </div>
          </div>
        </section>
      </>
    );
  }

  const allExpanded = expanded.size === balances.length;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BALANCE_CSS }} />
      <section className="exec-section">
        <div className="exec-section-header">
          <h3 className="exec-section-title">Saldos por sucursal</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="exec-section-meta">{balances.length} sucursales</span>
            <button
              className="exec-section-header-btn"
              onClick={allExpanded ? collapseAll : expandAll}
            >
              {allExpanded ? "Comprimir todo" : "Expandir todo"}
            </button>
          </div>
        </div>
        <div className="exec-section-body">
          {balances.map((b) => {
            const open = expanded.has(b.branchId);
            return (
              <div key={b.branchId}>
                <div className="bal-branch-row" onClick={() => toggle(b.branchId)}>
                  {open
                    ? <ChevronDown style={{ width: 16, height: 16, color: "#9ca3af" }} />
                    : <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af" }} />}
                  <span className="bal-branch-name">
                    {b.branchName}
                    <span style={{ color: "#9ca3af", fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                      ({b.accounts.length} cta{b.accounts.length !== 1 ? "s" : ""})
                    </span>
                  </span>
                  <span className="bal-branch-total">{fmtARS(b.total)}</span>
                </div>
                {open && (
                  <>
                    {/* Desktop: grid compartido entre header y filas */}
                    <div className="bal-detail-desktop">
                      <div className="bal-grid bal-grid-head">
                        <span>Banco</span>
                        <span>Cuenta</span>
                        <span className="num">Saldo</span>
                        <span className="num">Cheques</span>
                        <span className="num">Saldo ant.</span>
                      </div>
                      {b.accounts.map((a, i) => {
                        const cuenta = a.accountLabel.replace(`${a.bankName} - `, "");
                        return (
                          <div key={`${b.branchId}-${i}`} className="bal-grid bal-grid-row">
                            <span title={a.bankName}>{a.bankName}</span>
                            <span title={cuenta} style={{ color: "#6b7280" }}>{cuenta}</span>
                            <span className="num bal-row-balance">{fmtARS(a.balance)}</span>
                            <span className="num bal-row-secondary">{a.checks != null ? fmtARS(a.checks) : "—"}</span>
                            <span className="num bal-row-secondary">{a.prevBalance != null ? fmtARS(a.prevBalance) : "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Mobile: una card apilada por cuenta */}
                    <div className="bal-detail-mobile">
                      {b.accounts.map((a, i) => {
                        const cuenta = a.accountLabel.replace(`${a.bankName} - `, "");
                        const titulo = `${a.bankName} — ${cuenta}`;
                        return (
                          <div key={`${b.branchId}-${i}-m`} className="bal-card">
                            <div className="bal-card-title" title={titulo}>{titulo}</div>
                            <div className="bal-card-row primary">
                              <span className="label">Saldo</span>
                              <span className="value">{fmtARS(a.balance)}</span>
                            </div>
                            <div className="bal-card-row">
                              <span className="label">Cheques</span>
                              <span className="value">{a.checks != null ? fmtARS(a.checks) : "—"}</span>
                            </div>
                            <div className="bal-card-row">
                              <span className="label">Saldo ant.</span>
                              <span className="value">{a.prevBalance != null ? fmtARS(a.prevBalance) : "—"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
