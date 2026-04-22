"use client";
import { TrendingUp, TrendingDown, Minus, ShoppingBag } from "lucide-react";
import type { BranchSales } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

export function SalesTable({ sales }: { sales: BranchSales[] }) {
  const sorted = [...sales].sort((a, b) => b.totalSales - a.totalSales);

  if (sorted.length === 0) {
    return (
      <div className="card p-8 text-center">
        <ShoppingBag className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">Sin datos de ventas para mostrar.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "#1E2D5A" }}>Ventas por sucursal</h3>
        <span className="text-xs text-gray-400">{sorted.length} sucursales</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Sucursal</th>
              <th className="text-right px-4 py-2 font-medium">Ventas</th>
              <th className="text-right px-4 py-2 font-medium">Unid.</th>
              <th className="text-right px-4 py-2 font-medium">Comprobantes</th>
              <th className="text-right px-4 py-2 font-medium">Ticket prom.</th>
              <th className="text-right px-4 py-2 font-medium">vs ayer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(s => {
              const v = s.vsYesterday;
              const varColor = v == null ? "text-gray-400" : v > 0 ? "text-emerald-600" : v < 0 ? "text-red-500" : "text-gray-400";
              const VarIcon  = v == null || v === 0 ? Minus : v > 0 ? TrendingUp : TrendingDown;
              return (
                <tr key={s.branchId} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 text-gray-800 font-medium">{s.branchName}</td>
                  <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "#1E2D5A" }}>{fmtARS(s.totalSales)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtInt(s.units)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtInt(s.receipts)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{fmtARS(s.avgTicket)}</td>
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
    </div>
  );
}
