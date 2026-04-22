"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, Wallet, ShoppingBag, Receipt, Package, BarChart3 } from "lucide-react";
import { KPICard } from "./KPICard";
import { BalanceTable } from "./BalanceTable";
import { SalesTable } from "./SalesTable";
import { AlertBanner } from "./AlertBanner";
import type { DashboardSummary } from "@/types/dashboard";

const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

interface Props {
  data: DashboardSummary;
  user: { name: string; role: string };
}

export function ExecutiveDashboard({ data, user }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentBranch = searchParams.get("branch") ?? "ALL";

  const onBranchChange = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (id === "ALL") p.delete("branch"); else p.set("branch", id);
    router.push(`/executive${p.toString() ? "?" + p.toString() : ""}`);
  };

  const lastSyncFmt = data.lastSync
    ? `${new Date(data.lastSync.at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} · ${data.lastSync.status}`
    : "sin datos";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F4F5F7" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ backgroundColor: "#1E2D5A", borderColor: "#0f1a3a" }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white text-xs"
              style={{ backgroundColor: "#D4632A" }}
            >
              TKL
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-none">Dashboard Ejecutivo</p>
              <p className="text-[11px] text-white/60 mt-0.5">Farmacias TKL</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-xs text-white/80 leading-none">{user.name}</p>
              <p className="text-[10px] text-white/50 mt-0.5 uppercase tracking-wide">{user.role}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white border border-white/20 hover:border-white/40 rounded-lg px-3 py-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Filtro sucursal + meta */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#1E2D5A" }}>
              {new Date(data.date).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Última sync: {lastSyncFmt}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Sucursal:</label>
            <select
              className="input text-sm"
              value={currentBranch}
              onChange={e => onBranchChange(e.target.value)}
              style={{ minWidth: 180 }}
            >
              <option value="ALL">Todas</option>
              {data.branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        <AlertBanner alertas={data.alertas} />

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KPICard label="Saldo bancario total" value={fmtARS(data.kpis.totalBankBalance)} accent />
          <KPICard label="Ventas del día"       value={fmtARS(data.kpis.totalSales)} variation={data.kpis.salesVariation} sublabel="vs ayer" />
          <KPICard label="Unidades"             value={fmtInt(data.kpis.totalUnits)} />
          <KPICard label="Tickets"              value={fmtInt(data.kpis.totalReceipts)} />
          <KPICard label="Ticket promedio"      value={fmtARS(data.kpis.avgTicket)} />
        </div>

        {/* Tablas */}
        <BalanceTable balances={data.balancesByBranch} />
        <SalesTable   sales={data.salesByBranch} />
      </main>
    </div>
  );
}
