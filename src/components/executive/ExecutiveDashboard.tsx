"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, LayoutDashboard } from "lucide-react";
import { KPICard } from "./KPICard";
import { BalanceTable } from "./BalanceTable";
import { SalesTable } from "./SalesTable";
import { AlertBanner } from "./AlertBanner";
import type { DashboardSummary } from "@/types/dashboard";

// =============================================================================
// Formatters deterministas (SSR-safe, sin toLocale*)
// =============================================================================
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS   = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fmtLongDate(d: Date | string): string {
  const date = new Date(d);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

function fmtDateTime(d: Date | string): string {
  const date    = new Date(d);
  const day     = date.getDate().toString().padStart(2, "0");
  const month   = (date.getMonth() + 1).toString().padStart(2, "0");
  const year    = date.getFullYear().toString().slice(-2);
  const hours   = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${day}/${month}/${year}, ${hours}:${minutes}`;
}

// =============================================================================
// CSS compartido para todas las secciones del ejecutivo
// Responsive via @media queries — SSR-safe, sin flash.
// =============================================================================
const EXEC_STYLES = `
/* === LAYOUT BASE === */
.exec-root {
  min-height: 100vh;
  background: #F4F5F7;
  font-family: system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.exec-main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  box-sizing: border-box;
}
@media (min-width: 768px) {
  .exec-main { padding: 1.5rem 2rem; gap: 1.5rem; }
}

/* === HEADER === */
.exec-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #1E2D5A;
  border-bottom: 1px solid #0f1a3a;
}
.exec-header-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0.625rem 1rem;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: 1fr auto;
  grid-template-areas: "brand actions";
}
@media (min-width: 768px) {
  .exec-header-inner { padding: 0.625rem 2rem; grid-template-columns: 1fr auto auto; grid-template-areas: "brand user actions"; gap: 1rem; }
}
.exec-brand    { grid-area: brand;   display: flex; align-items: center; gap: 0.625rem; min-width: 0; }
.exec-user-box { grid-area: user;    display: none; text-align: right; }
.exec-actions  { grid-area: actions; display: flex; align-items: center; gap: 0.375rem; flex-wrap: nowrap; }
@media (min-width: 768px) { .exec-user-box { display: block; } }

.exec-logo {
  width: 36px; height: 36px;
  border-radius: 8px;
  background: #D4632A;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 800; font-size: 12px;
  flex-shrink: 0;
}
.exec-brand-title { font-size: 13px; font-weight: 600; color: white; line-height: 1.1; }
.exec-brand-sub   { font-size: 10px; color: rgba(255,255,255,0.6); margin-top: 1px; }

.exec-btn-icon {
  display: inline-flex; align-items: center; gap: 0.375rem;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  padding: 0.375rem 0.625rem;
  font-size: 11px;
  color: rgba(255,255,255,0.8);
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  white-space: nowrap;
}
.exec-btn-icon:hover { border-color: rgba(255,255,255,0.4); color: white; }
@media (min-width: 768px) { .exec-btn-icon { font-size: 12px; padding: 0.375rem 0.75rem; } }

/* El botón "Plataforma Operativa" se muestra siempre (mobile + desktop).
   En mobile queda solo el ícono; el texto interno aparece desde 768px. */
.exec-operative-link-text { display: none; }
@media (min-width: 768px) { .exec-operative-link-text { display: inline; } }

/* === FILTRO / META BAR === */
.exec-filter-row {
  display: flex; flex-direction: column; gap: 0.625rem;
}
@media (min-width: 768px) {
  .exec-filter-row { flex-direction: row; align-items: flex-end; justify-content: space-between; gap: 1rem; }
}
.exec-date-title {
  font-size: 0.95rem; font-weight: 700; color: #1E2D5A;
  line-height: 1.3;
}
@media (min-width: 768px) { .exec-date-title { font-size: 1.125rem; } }
.exec-meta-line  { font-size: 11px; color: #6b7280; margin-top: 2px; }

.exec-branch-select {
  display: flex; align-items: center; gap: 0.5rem;
  width: 100%;
}
@media (min-width: 768px) { .exec-branch-select { width: auto; } }
.exec-branch-select label { font-size: 11px; color: #6b7280; white-space: nowrap; }
.exec-branch-select select {
  flex: 1;
  min-width: 0;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 8px;
  padding: 0.5rem 0.625rem;
  font-size: 14px;
  color: #111827;
  outline: none;
}
.exec-branch-select select:focus { border-color: #1E2D5A; }
@media (min-width: 768px) { .exec-branch-select select { min-width: 180px; flex: none; } }

/* === KPI GRID === */
.exec-kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    "ventas    ticketprom"
    "unidades  tickets"
    "saldo     saldo";
  gap: 0.625rem;
}
@media (min-width: 768px) {
  .exec-kpi-grid {
    grid-template-columns: repeat(5, 1fr);
    grid-template-areas: "ventas ticketprom unidades tickets saldo";
    gap: 1.25rem;
    padding: 1rem 0;
  }
}
.kpi-slot-ventas     { grid-area: ventas; }
.kpi-slot-unidades   { grid-area: unidades; }
.kpi-slot-tickets    { grid-area: tickets; }
.kpi-slot-ticketprom { grid-area: ticketprom; }
.kpi-slot-saldo      { grid-area: saldo; }

/* === SECTION HEADER (navy con punto naranja) === */
.exec-section {
  display: flex; flex-direction: column;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  border-radius: 12px;
  overflow: hidden;
}
.exec-section-header {
  background: #1E2D5A;
  color: white;
  padding: 0.625rem 1rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  min-height: 36px;
  box-sizing: border-box;
  flex-wrap: wrap;
}
.exec-section-title {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  margin: 0;
}
.exec-section-title::before {
  content: "●";
  color: #D4632A;
  font-size: 14px;
  line-height: 1;
}
.exec-section-meta { font-size: 11px; color: rgba(255,255,255,0.7); white-space: nowrap; }
.exec-section-body {
  background: white;
  padding: 0;
  border-radius: 0 0 12px 12px;
  overflow: hidden;
}
.exec-section-body-padded {
  padding: 1rem;
}
@media (min-width: 768px) {
  .exec-section-body-padded { padding: 1.25rem; }
}

/* Botones outline para "Expandir/Comprimir todo" en header de sección */
.exec-section-header-btn {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: white;
  font-size: 10px;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.exec-section-header-btn:hover { background: rgba(255,255,255,0.18); }
`;

interface Props {
  data: DashboardSummary;
  user: { name: string; role: string };
  children?: React.ReactNode;
}

export function ExecutiveDashboard({ data, user, children }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentBranch = searchParams.get("branch") ?? "ALL";
  const operativaUrl  = process.env.NEXT_PUBLIC_OPERATIONAL_URL || "/dashboard";

  const onBranchChange = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (id === "ALL") p.delete("branch"); else p.set("branch", id);
    router.push(`/executive${p.toString() ? "?" + p.toString() : ""}`);
  };

  const lastSyncFmt = data.lastSync
    ? `${fmtDateTime(data.lastSync.at)} · ${data.lastSync.status}`
    : "sin datos";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: EXEC_STYLES }} />
      <div className="exec-root">
        {/* === HEADER === */}
        <header className="exec-header">
          <div className="exec-header-inner">
            <div className="exec-brand">
              <div className="exec-logo">TKL</div>
              <div style={{ minWidth: 0 }}>
                <div className="exec-brand-title">Dashboard Ejecutivo</div>
                <div className="exec-brand-sub">Farmacias TKL</div>
              </div>
            </div>
            <div className="exec-user-box">
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", lineHeight: 1.1 }}>{user.name}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{user.role}</div>
            </div>
            <div className="exec-actions">
              {user.role === "OWNER" && (
                <Link
                  href={operativaUrl}
                  className="exec-btn-icon"
                  title="Plataforma Operativa"
                  aria-label="Plataforma Operativa"
                >
                  <LayoutDashboard style={{ width: 14, height: 14 }} />
                  <span className="exec-operative-link-text">Plataforma Operativa →</span>
                </Link>
              )}
              <button onClick={() => signOut({ callbackUrl: "/login" })} className="exec-btn-icon">
                <LogOut style={{ width: 14, height: 14 }} />
                Salir
              </button>
            </div>
          </div>
        </header>

        {/* === MAIN === */}
        <main className="exec-main">
          {/* Filtro sucursal + meta */}
          <div className="exec-filter-row">
            <div style={{ minWidth: 0 }}>
              <h2 className="exec-date-title">{fmtLongDate(data.date)}</h2>
              <p className="exec-meta-line">Última sync: {lastSyncFmt}</p>
            </div>
            <div className="exec-branch-select">
              <label>Sucursal:</label>
              <select value={currentBranch} onChange={(e) => onBranchChange(e.target.value)}>
                <option value="ALL">Todas</option>
                {data.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          <AlertBanner alertas={data.alertas} />

          {/* KPIs — orden: Ventas → Ticket prom → Unidades → Tickets → Saldo */}
          <div className="exec-kpi-grid">
            <div className="kpi-slot-ventas">
              <KPICard label="Ventas del día" value={fmtARS(data.kpis.totalSales)} variation={data.kpis.salesVariation} sublabel="vs ayer" />
            </div>
            <div className="kpi-slot-ticketprom">
              <KPICard label="Ticket promedio" value={fmtARS(data.kpis.avgTicket)} />
            </div>
            <div className="kpi-slot-unidades">
              <KPICard label="Unidades" value={fmtInt(data.kpis.totalUnits)} />
            </div>
            <div className="kpi-slot-tickets">
              <KPICard label="Tickets" value={fmtInt(data.kpis.totalReceipts)} />
            </div>
            <div className="kpi-slot-saldo">
              <KPICard label="Saldo bancario total" value={fmtARS(data.kpis.totalBankBalance)} />
            </div>
          </div>

          {/* Secciones */}
          <BalanceTable balances={data.balancesByBranch} />
          <SalesTable   sales={data.salesByBranch} />
          {children}
        </main>
      </div>
    </>
  );
}
