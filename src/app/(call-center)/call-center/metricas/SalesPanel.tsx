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
      <p className="mt-2 text-xs text-gray-600">
        Comprobantes de SIAF de los vendedores del Call Center, por fecha del comprobante. Hasta {PERIOD_MAX_DAYS} días. Cada consulta queda registrada.
      </p>

      {state.status === "loading" && <p className="mt-6 text-sm text-gray-600">Cargando…</p>}
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
      <p className="mt-4 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900">
        {data.siafLastDay
          ? <>Datos de SIAF hasta el <span className="font-semibold">{formatShortDay(data.siafLastDay)}</span>. Se actualizan una vez por día, de madrugada.</>
          : "Todavía no hay datos de SIAF cargados. Se actualizan una vez por día, de madrugada."}
      </p>
      {data.siafDelayed && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          Los datos de SIAF tienen más de un día de atraso.
        </p>
      )}
      {data.daysNotLoaded.length > 0 && (
        <p className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800">
          <span className="font-semibold">Sin datos todavía:</span> {data.daysNotLoaded.map(formatShortDay).join(", ")}.
          {" "}{data.daysNotLoaded.length === 1 ? "Ese día no entra" : "Esos días no entran"} en los totales y no {data.daysNotLoaded.length === 1 ? "vale" : "valen"} cero.
        </p>
      )}
      <p className="mt-2 text-xs text-gray-600">Calculado a las {timeFmt.format(new Date(data.generatedAt))}.</p>
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
        <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">
          No hay comprobantes de vendedores del Call Center en el período.
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-medium text-gray-600">Importe bruto</h2>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">{money.format(data.total.gross)}</p>
            <p className="mt-1 text-xs text-gray-600">No es lo cobrado: es el importe bruto, con las notas de crédito ya restadas.</p>
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
            <p className="mt-1 text-xs text-gray-600">Ese día las notas de crédito superaron a lo vendido. Es lo único que se puede ver de ellas.</p>
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-gray-800">Comprobantes cada 100 pedidos</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{per100(data.receiptsPer100Orders)}</p>
            <div className="mt-2 space-y-1">
              <Line label="Pedidos que entraron esos días" value={nf.format(data.orders)} />
              <Line label="Días con ventas cargadas" value={nf.format(data.relationDays)} />
            </div>
            <p className="mt-1 text-xs text-gray-600">
              Se calcula solo sobre los días que tienen ventas de SIAF cargadas. Compara dos volúmenes del mismo día. No es una tasa de conversión: no se sabe qué comprobante corresponde a qué conversación.
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

          <Group title="Por operador" note="ordenados por alias, no por importe">
            {data.byOperator.map((o) => (
              <Card key={o.account !== null ? `a|${o.account}` : `v|${o.branches[0]?.branchId}|${o.branches[0]?.code}`}
                title={o.account !== null ? o.alias ?? `Cuenta ${o.account}` : o.name}
                subtitle={o.account !== null ? (o.alias ? `cuenta ${o.account}` : undefined) : "sin cuenta asociada"} t={o}>
                <Line label="Días con comprobantes" value={nf.format(o.days)} />
                {o.conversations !== null && <Line label="Conversaciones atendidas" value={nf.format(o.conversations)} />}
                <div className="mt-2 border-t border-gray-100 pt-2">
                  <p className="text-xs font-medium text-gray-600">Por sucursal</p>
                  <ul className="mt-1 space-y-1">
                    {o.branches.map((b) => (
                      <li key={`${b.branchId}|${b.code}`} className="flex items-baseline justify-between gap-3 text-xs text-gray-700">
                        <span className="min-w-0 truncate">{b.branchName} <span className="text-gray-500">· código {b.code}</span></span>
                        <span className="shrink-0 tabular-nums text-gray-900">{nf.format(b.receipts)} comp. · {money.format(b.gross)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
          </Group>
        </>
      )}

      <p className="mt-4 text-xs text-gray-600">
        Qué vendedor es del Call Center, y a qué operador pertenece cada código, se decide día por día con la configuración que regía ese día.
        Las conversaciones atendidas salen de la pestaña Operadores, para el mismo período. Los coseguros no se suman.
      </p>
    </>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <>
      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        {title}{note && <span className="ml-2 text-xs font-normal text-gray-600">{note}</span>}
      </h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">{children}</ul>
    </>
  );
}

function Card({ title, subtitle, t, children }: { title: string; subtitle?: string; t: Totals; children?: ReactNode }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-600">{subtitle}</p>}
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
  return <p className="mt-2 text-[11px] text-gray-500">{EVIDENCE_LABELS.MEDIDO} · {badge}</p>;
}
