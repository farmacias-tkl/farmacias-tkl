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

.bal-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.bal-table thead tr { border-bottom: 1px solid #e5e7eb; }
.bal-table th {
  padding: 0.375rem 0.5rem; text-align: left; font-size: 10px;
  font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;
}
.bal-table th.num, .bal-table td.num { text-align: right; }
.bal-table td {
  padding: 0.5rem; border-top: 1px solid #f3f4f6;
  color: #374151;
}
.bal-account-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
}
.bal-account-row:last-child { border-bottom: none; }
.bal-account-info { display: flex; flex-direction: column; min-width: 0; }
.bal-account-bank { color: #111827; font-weight: 500; }
.bal-account-type { color: #6b7280; font-size: 11px; margin-top: 1px; }
.bal-account-amount { color: #1E2D5A; font-weight: 600; white-space: nowrap; }

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
                    {/* Desktop: tabla completa */}
                    <div className="bal-detail-desktop">
                      <table className="bal-table">
                        <thead>
                          <tr>
                            <th>Banco</th>
                            <th>Cuenta</th>
                            <th className="num">Saldo</th>
                            <th className="num">Cheques</th>
                            <th className="num">Saldo ant.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.accounts.map((a, i) => (
                            <tr key={`${b.branchId}-${i}`}>
                              <td>{a.bankName}</td>
                              <td style={{ color: "#6b7280" }}>{a.accountLabel.replace(`${a.bankName} - `, "")}</td>
                              <td className="num" style={{ fontWeight: 500 }}>{fmtARS(a.balance)}</td>
                              <td className="num" style={{ color: "#6b7280" }}>{a.checks != null ? fmtARS(a.checks) : "—"}</td>
                              <td className="num" style={{ color: "#6b7280" }}>{a.prevBalance != null ? fmtARS(a.prevBalance) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile: lista vertical, sólo Banco·Cuenta y Saldo */}
                    <div className="bal-detail-mobile">
                      {b.accounts.map((a, i) => (
                        <div key={`${b.branchId}-${i}-m`} className="bal-account-row">
                          <div className="bal-account-info">
                            <span className="bal-account-bank">{a.bankName}</span>
                            <span className="bal-account-type">{a.accountLabel.replace(`${a.bankName} - `, "")}</span>
                          </div>
                          <span className="bal-account-amount">{fmtARS(a.balance)}</span>
                        </div>
                      ))}
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
