"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Building2 } from "lucide-react";
import type { BranchBalance } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

export function BalanceTable({ balances }: { balances: BranchBalance[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (balances.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">Sin saldos bancarios para mostrar.</p>
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "#1E2D5A" }}>Saldos por sucursal</h3>
        <span className="text-xs text-gray-400">{balances.length} sucursales</span>
      </div>
      <div className="divide-y divide-gray-100">
        {balances.map(b => {
          const open = expanded.has(b.branchId);
          return (
            <div key={b.branchId}>
              <button
                onClick={() => toggle(b.branchId)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {open
                    ? <ChevronDown className="w-4 h-4 text-gray-400" />
                    : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <span className="text-sm font-medium text-gray-800">{b.branchName}</span>
                  <span className="text-xs text-gray-400">({b.accounts.length} cuenta{b.accounts.length !== 1 ? "s" : ""})</span>
                </div>
                <span className="text-sm font-bold" style={{ color: "#1E2D5A" }}>{fmtARS(b.total)}</span>
              </button>
              {open && (
                <div className="bg-gray-50/60 px-4 py-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="py-1.5 font-medium">Banco</th>
                        <th className="py-1.5 font-medium text-right">Saldo</th>
                        <th className="py-1.5 font-medium text-right">Cheques</th>
                        <th className="py-1.5 font-medium text-right">Saldo ant.</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-700">
                      {b.accounts.map((a, i) => (
                        <tr key={`${b.branchId}-${i}`} className="border-t border-gray-200">
                          <td className="py-1.5">{a.bankName}</td>
                          <td className="py-1.5 text-right font-medium">{fmtARS(a.balance)}</td>
                          <td className="py-1.5 text-right text-gray-500">{a.checks != null ? fmtARS(a.checks) : "—"}</td>
                          <td className="py-1.5 text-right text-gray-500">{a.prevBalance != null ? fmtARS(a.prevBalance) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
