"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_LABELS, POPULATION_LABELS } from "@/lib/call-center/metrics/indicators";
import type { SalesPayload } from "@/lib/call-center/metrics/sales-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import { formatShortDay } from "@/lib/call-center/metrics/format";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";

const nf = new Intl.NumberFormat("es-AR");
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const ratio = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

type Totals = { gross: number; receipts: number; discounts: number; units: number };
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SalesPayload };

const per100 = (v: number | null) => (v === null ? "Sin datos" : ratio.format(v));

/** Bloque "Ventas SIAF": comprobantes de los vendedores del Call Center. `today` es el día de Buenos Aires. */
export default function SalesPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>(defaultPeriod(today));
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (p: Period) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/call-center/metrics/sales?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los comprobantes." });
        return;
      }
      setState({ status: "ready", data: body.data as SalesPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los comprobantes. Revisá la conexión." });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  return (
    <section className="mt-4" aria-label="Ventas SIAF">
      <PeriodForm today={today} period={period} onChange={setPeriod} />
      <p className="mt-2 text-xs text-gray-500">
        Comprobantes de SIAF de los vendedores del Call Center, por fecha del comprobante. Hasta {PERIOD_MAX_DAYS} días. Cada consulta queda registrada.
      </p>

      {state.status === "loading" && <p className="mt-6 text-sm text-gray-500">Cargando…</p>}
      {state.status === "error" && (
        <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}{" "}
          <button type="button" onClick={() => load(period)} className="font-medium underline">Reintentar</button>
        </div>
      )}
      {state.status === "ready" && <Report data={state.data} />}
    </section>
  );
}

function Report({ data }: { data: SalesPayload }) {
  const noVendors = data.byVendor.length === 0;
  return (
    <>
      <p className="mt-4 text-xs text-gray-500">
        Calculado a las {timeFmt.format(new Date(data.generatedAt))}.
        {data.lastLoadedDay ? ` Último día con comprobantes cargados: ${formatShortDay(data.lastLoadedDay)}.` : " No hay comprobantes cargados en el período."}
        {" "}SIAF se carga con un día de atraso.
      </p>
      {!data.hasConfig && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Todavía no hay configuración cargada: no se sabe qué vendedores son del Call Center.
        </p>
      )}
      {data.daysWithoutConfig.length > 0 && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {nf.format(data.daysWithoutConfig.length)} {data.daysWithoutConfig.length === 1 ? "día del período no tenía" : "días del período no tenían"} configuración
          vigente ({data.daysWithoutConfig.map(formatShortDay).join(", ")}): no se suman y no valen cero.
        </p>
      )}

      {noVendors ? (
        <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
          No hay comprobantes de vendedores del Call Center en el período.
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-medium text-gray-600">Importe bruto</h2>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">{money.format(data.total.gross)}</p>
            <p className="mt-1 text-xs text-gray-500">No es lo cobrado: es el importe bruto, con las notas de crédito ya restadas.</p>
            <div className="mt-3 space-y-1">
              <Line label="Comprobantes" value={nf.format(data.total.receipts)} strong />
              <Line label="Descuentos (aparte, no se restan)" value={money.format(data.total.discounts)} />
              <Line label="Unidades" value={nf.format(data.total.units)} />
            </div>
            <Evidence badge={POPULATION_LABELS.COMPROBANTE} />
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-gray-800">Notas de crédito</h2>
            <p className="mt-1 text-xs text-gray-600">
              SIAF no las informa por separado. Están restadas del importe bruto y cuentan como un comprobante más: por eso la cantidad de
              comprobantes no es una cantidad de ventas.
            </p>
            <div className="mt-2 space-y-1">
              <Line label="Vendedor y día con importe negativo" value={nf.format(data.negativeVendorDays)} />
            </div>
            <p className="mt-1 text-xs text-gray-500">Ese día las notas de crédito superaron a lo vendido. Es lo único que se puede ver de ellas.</p>
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-gray-800">Comprobantes cada 100 pedidos</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{per100(data.receiptsPer100Orders)}</p>
            <div className="mt-2 space-y-1">
              <Line label="Pedidos que entraron esos días" value={nf.format(data.orders)} />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Compara dos volúmenes del mismo día. No es una tasa de conversión: no se sabe qué comprobante corresponde a qué conversación.
              Pedidos son las conversaciones de pedido en el bot y las recetas de Meducar.
            </p>
          </div>

          <Group title="Por día">
            {[...data.byDay].reverse().map((d) => (
              <Card key={d.day} title={formatShortDay(d.day)} t={d}>
                <Line label="Vendedores con comprobantes" value={nf.format(d.vendors)} />
                <Line label="Pedidos que entraron" value={nf.format(d.orders)} />
                <Line label="Comprobantes cada 100 pedidos" value={per100(d.receiptsPer100Orders)} />
              </Card>
            ))}
          </Group>

          <Group title="Por sucursal">
            {data.byBranch.map((b) => <Card key={b.branchId} title={b.branchName} t={b} />)}
          </Group>

          <Group title="Por vendedor" note="ordenados por sucursal y código, no por importe">
            {data.byVendor.map((v) => (
              <Card key={`${v.branchId}|${v.code}`} title={`${v.name} · ${v.code}`} subtitle={v.branchName} t={v}>
                <Line label="Días con comprobantes" value={`${nf.format(v.days)} (${formatShortDay(v.firstDay)} a ${formatShortDay(v.lastDay)})`} />
              </Card>
            ))}
          </Group>
        </>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Qué vendedor es del Call Center se decide día por día con la configuración que regía ese día. Los coseguros no se suman.
      </p>
    </>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <>
      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        {title}{note && <span className="ml-2 text-xs font-normal text-gray-500">{note}</span>}
      </h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">{children}</ul>
    </>
  );
}

function Card({ title, subtitle, t, children }: { title: string; subtitle?: string; t: Totals; children?: ReactNode }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      <div className="mt-2 space-y-1">
        <Line label="Importe bruto" value={money.format(t.gross)} strong />
        <Line label="Comprobantes" value={nf.format(t.receipts)} />
        <Line label="Descuentos" value={money.format(t.discounts)} />
        {children}
      </div>
    </li>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-700">{label}</span>
      <span className={`shrink-0 tabular-nums text-gray-900 ${strong ? "text-lg font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function Evidence({ badge }: { badge: string }) {
  return <p className="mt-2 text-[11px] text-gray-400">{EVIDENCE_LABELS.MEDIDO} · {badge}</p>;
}
