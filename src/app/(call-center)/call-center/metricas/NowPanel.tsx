"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EVIDENCE_LABELS, indicator, type IndicatorDefinition } from "@/lib/call-center/metrics/indicators";
import { formatMinutes as formatWait } from "@/lib/call-center/metrics/format";
import { NOW_CACHE_SECONDS, type NowGroup, type NowListItem, type NowPayload } from "@/lib/call-center/metrics/now-types";

const REFRESH_MS = NOW_CACHE_SECONDS * 1000;
const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const minutesSince = (iso: string, nowMs: number) => Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: NowPayload; fetchedAt: number };

export default function NowPanel() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/call-center/metrics/now", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        // Si ya había datos en pantalla se conservan: un refresco fallido no los borra.
        setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: body?.error ?? "No se pudieron cargar las métricas." }));
        return;
      }
      setState({ status: "ready", data: body.data as NowPayload, fetchedAt: Date.now() });
    } catch {
      setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: "No se pudieron cargar las métricas. Revisá la conexión." }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (state.status === "loading") return <p className="mt-6 text-sm text-gray-500">Cargando…</p>;
  if (state.status === "error") {
    return (
      <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.message}{" "}
        <button type="button" onClick={load} className="font-medium underline">Reintentar</button>
      </div>
    );
  }

  const d = state.data;
  const generatedMs = new Date(d.generatedAt).getTime();
  const open = d.openWaiting;
  const closed = d.closedUnanswered;

  return (
    <section className="mt-4" aria-label="Ahora">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-gray-800">Ahora</h2>
        <p className="text-xs text-gray-500">
          Calculado a las {timeFmt.format(new Date(d.generatedAt))} · se actualiza cada {NOW_CACHE_SECONDS} segundos{refreshing ? " · actualizando…" : ""}
        </p>
      </div>
      <p className="mt-1 text-xs text-gray-500" title={indicator("freshness").definition}>
        Último evento de Emozion: {d.freshness.lastWebhookAt ? dateTimeFmt.format(new Date(d.freshness.lastWebhookAt)) : "No disponible"}
        {" · "}último mensaje: {d.freshness.lastMessageAt ? dateTimeFmt.format(new Date(d.freshness.lastMessageAt)) : "No disponible"}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card def={indicator("queue.open_waiting")} value={open.total}
          detail={open.oldestWaitStart ? `La más vieja espera hace ${formatWait(minutesSince(open.oldestWaitStart, generatedMs))}` : "Nadie esperando"}
          extra={`${nf.format(open.neverHuman)} sin primera respuesta · ${nf.format(open.awaitingNext)} esperan la siguiente`} />
        <Card def={indicator("queue.completed_orders_waiting")} value={d.completedOrdersWaiting}
          detail={`${nf.format(open.completedOrders)} abiertas · ${nf.format(closed.completedOrders)} cerradas`} />
        <Card def={indicator("queue.closed_unanswered")} value={closed.total}
          detail={`${nf.format(closed.neverHuman)} sin primera respuesta · ${nf.format(closed.awaitingNext)} esperaban la siguiente`}
          extra={`Creadas desde el ${dateTimeFmt.format(new Date(d.closedSince)).slice(0, 5)}`} />
        <Card def={indicator("queue.thanks_candidates")} value={closed.thanksCandidates + open.thanksCandidates}
          detail="Para revisar: siguen contando como pendientes" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card small def={indicator("queue.old_open")} value={d.openOlderThanListWindow} />
        <Card small def={indicator("queue.no_bot_exit")} value={open.noBotExit + closed.noBotExit}
          detail={`${nf.format(open.noBotExit)} abiertas · ${nf.format(closed.noBotExit)} cerradas`} />
        <AgeCard group={closed} />
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs font-medium text-gray-600">Cerradas sin respuesta, anteriores</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{d.closedBefore ? nf.format(d.closedBefore.total) : "No disponible"}</p>
          {d.closedBefore && (
            <p className="mt-0.5 text-xs text-gray-500">
              {nf.format(d.closedBefore.neverHuman)} sin primera respuesta · {nf.format(d.closedBefore.completedOrders)} con pedido completo
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-400">Medido · histórico, se recalcula cada hora</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Casos</h3>
        <p className="text-xs text-gray-500">
          Todas las abiertas y las cerradas de las últimas {d.listWindowHours} horas, de la espera más vieja a la más nueva.
          {d.listTotal > d.list.length ? ` Se muestran ${nf.format(d.list.length)} de ${nf.format(d.listTotal)}.` : ""}
        </p>
      </div>
      {d.list.length === 0 ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">No hay nadie esperando una respuesta.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Espera</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Situación</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {d.list.map((it) => <Row key={it.conversationId} it={it} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Card({ def, value, detail, extra, small }: { def: IndicatorDefinition; value: number; detail?: string; extra?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3" title={def.definition}>
      <p className="text-xs font-medium text-gray-600">{def.label}</p>
      <p className={`mt-1 font-semibold tabular-nums text-gray-900 ${small ? "text-xl" : "text-2xl"}`}>{nf.format(value)}</p>
      {detail && <p className="mt-0.5 text-xs text-gray-500">{detail}</p>}
      {extra && <p className="text-xs text-gray-500">{extra}</p>}
      <p className="mt-1 text-[11px] text-gray-400">{EVIDENCE_LABELS[def.evidence]}</p>
    </div>
  );
}

function AgeCard({ group }: { group: NowGroup }) {
  const rows: Array<[string, number]> = [
    ["Menos de 24 h", group.byAge.lt24h], ["24 a 72 h", group.byAge.h24to72], ["3 a 30 días", group.byAge.d3to30], ["Más de 30 días", group.byAge.gt30d],
  ];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium text-gray-600">Cerradas sin respuesta, por antigüedad</p>
      <dl className="mt-1 space-y-0.5 text-xs text-gray-600">
        {rows.map(([label, n]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt>{label}</dt><dd className="tabular-nums font-medium text-gray-900">{nf.format(n)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[11px] text-gray-400">Medido</p>
    </div>
  );
}

function Row({ it }: { it: NowListItem }) {
  const tags: string[] = [];
  tags.push(it.hasHumanResponse ? "Espera la siguiente respuesta" : "Sin primera respuesta");
  if (it.botOrderComplete && !it.hasHumanResponse) tags.push("Pedido completo");
  if (it.thanksCandidate) tags.push("Posible agradecimiento");
  if (it.noBotExit) tags.push("Sin salida del bot");
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums text-gray-900">{formatWait(it.waitMinutes)}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-500">{dateTimeFmt.format(new Date(it.waitStart))}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${it.open ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>
          {it.open ? "Abierta" : "Cerrada"}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">{tags.join(" · ")}</td>
      <td className="px-3 py-2 text-right">
        <Link href={`/call-center/${it.conversationId}`} className="text-xs font-medium text-[#1E2D5A] hover:underline">Ver conversación</Link>
      </td>
    </tr>
  );
}
