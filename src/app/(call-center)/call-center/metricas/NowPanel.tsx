"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { EVIDENCE_LABELS } from "@/lib/call-center/metrics/indicators";
import { formatMinutes as formatWait } from "@/lib/call-center/metrics/format";
import type { ClosedReason, NowListItem, NowOwnerRow, NowPayload, WaitLevel } from "@/lib/call-center/metrics/now-types";
import { CLAIM_LABELS } from "@/lib/call-center/metrics/detected-patterns";
import { comparisonNote, comparisonVerdict, scheduleNote } from "@/lib/call-center/metrics/comparison";
import { coverStatus } from "@/lib/call-center/metrics/cover";
import { useNowData } from "./useNowData";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: TZ });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

const pct = (v: number | null) => (v === null ? "Sin datos" : `${Math.round(v * 100)} %`);
const mins = (v: number | null) => (v === null ? "Sin datos" : formatWait(v));

const minutesSince = (iso: string, nowMs: number) => Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));

/** "hoy 12:22", "ayer 18:40" o "19/11 09:10", en hora de Buenos Aires. */
function whenLabel(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const key = dayKeyFmt.format(d);
  const time = timeFmt.format(d);
  if (key === dayKeyFmt.format(new Date(nowMs))) return `hoy ${time}`;
  if (key === dayKeyFmt.format(new Date(nowMs - 86_400_000))) return `ayer ${time}`;
  return `${dayFmt.format(d)} ${time}`;
}

const ownerLabel = (o: NowListItem["owner"]) =>
  o.kind === "SYSTEM" ? "Sin tomar" : o.kind === "ACCOUNT" ? `Asignada a ${o.label}` : "Sin dato de asignado";

/** Semáforo: fondo suave y la etiqueta siempre en texto. */
const LEVELS: Record<WaitLevel, { label: string; chip: string; dot: string }> = {
  EN_PLAZO: { label: "En plazo", chip: "border-green-200 bg-green-50 text-green-900", dot: "bg-green-600" },
  DEMORADO: { label: "Demorado", chip: "border-orange-200 bg-orange-50 text-orange-900", dot: "bg-orange-500" },
  CRITICO: { label: "Crítico", chip: "border-red-200 bg-red-50 text-red-900", dot: "bg-red-600" },
};

const REASON_LABELS: Record<ClosedReason, string> = {
  QUESTION: "Hizo una consulta",
  ORDER: "Hizo un pedido",
  ATTACHMENT: "Mandó una receta o un comprobante",
};

type CaseFilter = "all" | "claims" | "urgent" | "insisting" | "closing" | "closed" | "critical" | "orders" | "longest";

/** "3 h 20 min" o "45 min" que faltan para que se cierre la ventana de WhatsApp. */
function windowLeftLabel(lastCustomerAt: string, nowMs: number, hours: number): string {
  const left = Math.max(0, Math.floor((new Date(lastCustomerAt).getTime() + hours * 3_600_000 - nowMs) / 60_000));
  const h = Math.floor(left / 60);
  return h > 0 ? `${h} h ${left % 60} min` : `${left} min`;
}

/** "3 h 20 min" o "2 días 4 h" desde que se cerró la ventana de WhatsApp. */
function windowClosedAgoLabel(lastCustomerAt: string, nowMs: number, hours: number): string {
  const ago = Math.max(0, Math.floor((nowMs - new Date(lastCustomerAt).getTime() - hours * 3_600_000) / 60_000));
  const h = Math.floor(ago / 60);
  if (h >= 48) return `${Math.floor(h / 24)} días ${h % 24} h`;
  return h > 0 ? `${h} h ${ago % 60} min` : `${ago} min`;
}

const FILTER_LABELS: Record<Exclude<CaseFilter, "all">, string> = {
  claims: "pendientes con un reclamo detectado",
  urgent: "posibles urgencias",
  insisting: "clientes insistiendo",
  closing: "con la ventana de WhatsApp por vencer, de la que vence antes a la que vence después",
  closed: "con la ventana de WhatsApp cerrada",
  critical: "en demora crítica",
  orders: "con pedido completo sin primera respuesta",
  longest: "el caso con mayor espera",
};

export default function NowPanel() {
  const { state, refreshing, reload } = useNowData();
  const [filter, setFilter] = useState<CaseFilter>("all");
  // Filtro por quién tiene el caso (clave de la fila de "Quién tiene cada caso"). Se combina con el anterior.
  const [ownerKey, setOwnerKey] = useState<string | null>(null);

  if (state.status === "loading") return <p className="mt-6 text-sm text-gray-600">Cargando…</p>;
  if (state.status === "error") {
    return (
      <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.message}{" "}
        <button type="button" onClick={reload} className="font-medium underline">Reintentar</button>
      </div>
    );
  }

  const d = state.data;
  const nowMs = new Date(d.generatedAt).getTime();
  const w = d.waiting;
  const toggle = (f: CaseFilter) => setFilter((cur) => (cur === f ? "all" : f));
  const ownerRow = ownerKey ? d.owners?.rows.find((r) => r.key === ownerKey) ?? null : null;
  const byOwner = (list: NowListItem[]) => (ownerKey ? list.filter((it) => it.ownerKey === ownerKey) : list);
  const shown = byOwner(
    filter === "claims" ? d.list.filter((it) => it.claims !== null && it.claims.length > 0)
    : filter === "urgent" ? d.list.filter((it) => it.alert === "URGENTE")
    : filter === "insisting" ? d.list.filter((it) => it.alert === "INSISTIENDO")
    : filter === "closing" ? d.list.filter((it) => it.window === "POR_VENCER").sort((a, b) => (a.lastCustomerAt < b.lastCustomerAt ? -1 : 1))
    : filter === "closed" ? d.list.filter((it) => it.window === "CERRADA")
    : filter === "critical" ? d.list.filter((it) => it.level === "CRITICO")
    : filter === "orders" ? d.list.filter((it) => it.botOrderComplete && !it.hasHumanResponse)
    : filter === "longest" ? d.list.slice(0, 1)
    : d.list);

  // "Requiere acción", en orden de gestión. count null = no se pudo calcular.
  const actions: Array<{ key: Exclude<CaseFilter, "all" | "longest">; label: string; short: string; count: number | null; tone: "critical" | "warning" | "plain" }> = [
    {
      key: "critical", tone: "critical", count: w.criticalCurrent, short: "demora crítica",
      label: `En demora crítica · atención actual${w.criticalHistorical ? ` (aparte, ${nf.format(w.criticalHistorical)} ${w.criticalHistorical === 1 ? "histórico" : "históricos"} por verificar)` : ""}`,
    },
    { key: "orders", tone: "warning", count: w.completedOrders, short: "pedidos completos sin primera respuesta", label: "Pedidos completos sin primera respuesta" },
    { key: "closing", tone: "warning", count: d.window.closing, short: "ventana por vencer", label: `Ventana de WhatsApp por vencer (menos de ${d.window.warningHours} h)` },
    { key: "urgent", tone: "critical", count: w.urgent, short: "posible urgencia", label: "Posible urgencia · detectada por palabras" },
    { key: "insisting", tone: "warning", count: w.insisting, short: "cliente insistiendo", label: "Cliente insistiendo" },
    { key: "claims", tone: "warning", count: w.claims, short: "reclamos detectados", label: "Reclamos pendientes de atención · detectados por palabras, para revisar" },
    { key: "closed", tone: "plain", count: d.window.closed, short: "ventana cerrada", label: "Ventana de WhatsApp cerrada · requiere plantilla" },
  ];
  const actionsWithCases = actions.filter((a) => a.count !== null && a.count > 0);
  const actionsAtZero = actions.filter((a) => a.count === 0);
  const actionsUnknown = actions.filter((a) => a.count === null);

  return (
    <section className="mt-4" aria-label="Ahora">
      <CoverCard d={d} nowMs={nowMs} refreshing={refreshing} />

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-800">Requiere acción</h2>
        {/* Primero las alertas con casos, en orden de gestión; las que están en cero, en una línea. */}
        {actionsWithCases.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {actionsWithCases.map((a) => (
              <ActionButton key={a.key} label={a.label} value={nf.format(a.count ?? 0)} tone={a.tone} active={filter === a.key} onClick={() => toggle(a.key)} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-700">Ninguna alerta con casos en este momento.</p>
        )}
        {(actionsAtZero.length > 0 || actionsUnknown.length > 0) && (
          <p className="mt-2 text-xs text-gray-700">
            {actionsAtZero.length > 0 && <>En cero: {actionsAtZero.map((a) => a.short).join(" · ")}. </>}
            {actionsUnknown.length > 0 && <>{d.partial ? "Cargando" : "Sin dato"}: {actionsUnknown.map((a) => a.short).join(" · ")}. </>}
            {actionsAtZero.some((a) => a.key === "urgent") && <>Las posibles urgencias salen de palabras: cero detectadas no significa que no haya urgencias.</>}
          </p>
        )}
        <div className="mt-2 grid grid-cols-1 gap-2">
          <ActionButton label="Mayor espera entre los recientes" value={w.oldestWaitStart ? formatWait(minutesSince(w.oldestWaitStart, nowMs)) : "—"} tone="plain"
            active={filter === "longest"} disabled={!w.oldestWaitStart} onClick={() => toggle("longest")} />
        </div>
        <a href="#cerradas-sin-responder"
          className={`mt-2 flex min-h-[44px] items-center justify-between gap-3 rounded-md border px-2 py-1.5 ${d.closedUnanswered?.total ? "border-orange-200 bg-orange-50" : "border-gray-200 bg-white"}`}>
          <span className="text-[11px] leading-tight text-gray-700">
            Cerradas sin responder{d.closedUnanswered ? ` · últimos ${d.closedUnanswered.days} días` : ""}
            <span className="block">No suman al total de pendientes. Tocá para revisarlas.</span>
          </span>
          <span className={`text-xl font-semibold tabular-nums ${d.closedUnanswered?.total ? "text-orange-900" : "text-gray-900"}`}>
            {d.closedUnanswered ? nf.format(d.closedUnanswered.total) : d.partial ? "…" : "—"}
          </span>
        </a>
        <p className="mt-2 text-xs text-gray-700">
          Tocá un número para ver esos casos.
          {w.critical === null ? " Sin configuración cargada no se puede marcar la demora crítica." : ""}
        </p>
        <More>
          Posible urgencia: en mensajes que todavía no tuvieron respuesta de un operador, el cliente pide urgencia o avisa que se va a otro lado. Sale de palabras:
          puede haber urgencias que no use esas palabras. Cliente insistiendo: después de
          completar el bot escribió 2 mensajes o más, separados por más de 10 minutos, y sigue sin respuesta. Los dos dejan de mostrarse cuando un operador responde.
          {" "}Reclamos pendientes: conversaciones que esperan respuesta y en las que algún mensaje del cliente coincide con un motivo de reclamo de la pestaña
          &quot;Reclamos y pérdidas&quot; (demora, pedido sin novedades, pago, entrega y los demás). Son detectados por palabras, no confirmados: todavía no hay un
          registro de reclamos. Cuentan los que entraron cualquier día y siguen sin respuesta, no solo los de hoy.
          {" "}Ventana de WhatsApp: desde el último mensaje del cliente hay {d.window.hours} horas de reloj para responder libremente, también de noche, los fines de semana y
          los feriados. Pasado ese plazo la conversación solo se reabre con una plantilla aprobada. &quot;Por vencer&quot; son las que todavía se pueden responder y les
          quedan menos de {d.window.warningHours} horas. La ventana es independiente del semáforo, que mide minutos hábiles.
          {" "}Los grupos se superponen y no se suman: un pedido completo puede estar además en demora crítica.
          {" "}Las alertas cuentan los casos de atención actual. Los históricos por verificar se cuentan aparte, debajo de la lista. Las cerradas sin responder ya no están abiertas: son una alerta aparte y no suman al total.
          {d.schedule ? ` En plazo es hasta ${d.schedule.goalMinutes} minutos hábiles de espera, demorado hasta ${d.schedule.criticalMinutes} y crítico más de ${d.schedule.criticalMinutes}.` : ""}
          {" "}Los minutos hábiles corren solo dentro del horario público; fuera de ese horario el reloj se pausa y el caso conserva su color. Además es crítico todo caso
          con la ventana de WhatsApp cerrada: {d.window.hours} horas o más de espera real desde el último mensaje del cliente, sume lo que sume el reloj hábil.
        </More>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Total de pendientes</h2>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-gray-900">
          <span className="text-4xl font-semibold tabular-nums">{nf.format(w.current)}</span>
          <span className="text-sm">{w.current === 1 ? "pendiente reciente" : "pendientes recientes"}, en atención actual</span>
        </p>
        {w.historical > 0 && (
          <p className="mt-0.5 text-sm text-gray-800">
            + <span className="font-semibold tabular-nums">{nf.format(w.historical)}</span> {w.historical === 1 ? "antiguo" : "antiguos"} por verificar
            <span className="text-gray-600"> · no se sabe si siguen pendientes</span>
          </p>
        )}
        <dl className="mt-2 space-y-0.5 text-sm text-gray-800">
          <div className="flex justify-between gap-2"><dt>Recientes (últimas {d.windowHours} h)</dt><dd className="font-semibold tabular-nums text-gray-900">{nf.format(w.total)}</dd></div>
          <div className="flex justify-between gap-2"><dt>Posibles pendientes antiguos</dt><dd className="font-semibold tabular-nums text-gray-900">{nf.format(w.oldPending)}</dd></div>
          {w.oldPending !== w.historical && (
            <div className="flex justify-between gap-2 text-gray-700"><dt>De esos, con un mensaje nuevo del cliente (pasan a atención actual)</dt><dd className="tabular-nums">{nf.format(w.oldPending - w.historical)}</dd></div>
          )}
          {d.stale.probableClose !== null && d.stale.probableClose > 0 && (
            <div className="flex justify-between gap-2 text-gray-600"><dt>Aparte, antiguas probablemente resueltas (por revisar)</dt><dd className="tabular-nums">{nf.format(d.stale.probableClose)}</dd></div>
          )}
        </dl>
        <p className="mt-1 text-sm text-gray-700">
          {w.oldestWaitStart ? <>La reciente que más espera: <span className="font-semibold">{formatWait(minutesSince(w.oldestWaitStart, nowMs))}</span></> : "No hay ninguna esperando en las últimas horas."}
        </p>
        {w.total > 0 && (
          <p className="mt-2 text-xs text-gray-600">
            De las recientes, {nf.format(w.neverHuman)} esperan la primera respuesta y {nf.format(w.awaitingNext)} la siguiente.
          </p>
        )}
        <More>
          Pendiente es una conversación abierta cuyo último mensaje es del cliente. Las {d.windowHours} horas solo separan las recientes de las antiguas: ninguna se
          excluye por antigua. &quot;Posibles pendientes antiguos&quot; son las que esperan hace más de {d.windowHours} horas y cuyo último mensaje no parece un cierre;
          la separación es por palabras, por eso &quot;posibles&quot;. Mientras el cliente no vuelva a escribir quedan como históricos por verificar, aparte de la lista
          operativa; si escribe de nuevo, el caso vuelve a atención actual. Las antiguas cuyo último mensaje es un agradecimiento o un cierre no se suman: están abajo, para
          revisar y cerrar si corresponde. Nada se cierra por antigüedad.
        </More>
        <Evidence level={w.oldPending > 0 ? "DETECTADO" : "MEDIDO"} />
      </div>

      <div className="mt-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-xs font-medium text-gray-600">Hoy</h2>
          {d.today ? (
            <dl className="mt-1 space-y-2 text-sm text-gray-800">
              <div className="flex items-baseline justify-between gap-3">
                <dt>Nuevas de hoy<span className="block text-xs text-gray-600">{nf.format(Math.max(0, d.today.entered - d.today.answered))} sin respuesta</span></dt>
                <dd className="shrink-0 text-right text-xl font-semibold tabular-nums text-gray-900">{nf.format(d.today.answered)} <span className="text-sm font-normal text-gray-700">respondidas de</span> {nf.format(d.today.entered)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Respondidas hoy en total<span className="block text-xs text-gray-600">{nf.format(d.today.answered)} de hoy + {nf.format(Math.max(0, d.today.attended - d.today.answered))} de días anteriores</span></dt>
                <dd className="shrink-0 text-xl font-semibold tabular-nums text-gray-900">{nf.format(d.today.attended)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-1 text-sm text-gray-600">No disponible</p>
          )}
          <More>
            Son poblaciones distintas y no se restan entre sí. &quot;Nuevas de hoy&quot; son las conversaciones creadas hoy y, de esas, las que ya tienen una respuesta
            pública de un operador. &quot;Respondidas hoy en total&quot; son todas las conversaciones con una respuesta pública de un operador hoy, también las que entraron
            días anteriores. El total de pendientes de arriba es otra cosa: las abiertas cuyo último mensaje es del cliente, entren cuando entren. Ninguno cuenta las
            respuestas del bot ni las notas internas.
          </More>
          <Evidence level={d.today ? "MEDIDO" : "NO_DISPONIBLE"} />
        </div>
      </div>

      {d.partial ? (
        <SkeletonCard title="Actividad observada, últimos 60 minutos y avances" />
      ) : (
        <>
          <ObservedCard d={d} nowMs={nowMs} />

          <TrendCard d={d} />

          <ProgressCard d={d} />
        </>
      )}

      <OwnersCard d={d} nowMs={nowMs} selected={ownerKey} onSelect={(k) => setOwnerKey((cur) => (cur === k ? null : k))} />

      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        Atención actual{d.listTotal > 0 ? ` (${nf.format(filter === "all" && !ownerKey ? d.listTotal : shown.length)})` : ""}
        <span className="ml-2 text-xs font-normal text-gray-600">
          por prioridad: urgente o insistiendo, ventana por vencer, demora crítica, pedido completo, ventana cerrada y el resto
        </span>
      </h2>
      {filter !== "all" && (
        <p className="mt-1 text-xs text-gray-700">
          Mostrando solo {FILTER_LABELS[filter]}.{" "}
          <button type="button" onClick={() => setFilter("all")} className="font-medium text-[#1E2D5A] underline">Ver todos</button>
        </p>
      )}
      {ownerKey && (
        <p className="mt-1">
          <button type="button" onClick={() => setOwnerKey(null)} aria-label={`Quitar el filtro: ${ownerRow?.label ?? "cuenta"}`}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[#1E2D5A] bg-white px-3 text-xs font-semibold text-[#1E2D5A]">
            <span>Asignación: {ownerRow?.label ?? "cuenta sin casos abiertos"}</span>
            <span aria-hidden="true">✕</span>
          </button>
        </p>
      )}
      {d.listTotal > d.list.length && (
        <p className="mt-1 text-xs text-gray-600">Se muestran los {nf.format(d.list.length)} que más esperan.</p>
      )}
      {shown.length === 0 ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">
          {filter === "all" && !ownerKey ? "No hay nadie esperando una respuesta." : "Ningún caso en este grupo."}
        </p>
      ) : (
        <ul className="mt-2 grid gap-2 lg:grid-cols-2">
          {shown.map((it) => <CaseCard key={it.conversationId} it={it} nowMs={nowMs} schedule={d.schedule} windowHours={d.window.hours} />)}
        </ul>
      )}

      {d.historicalTotal > 0 && (
        <details className="mt-6 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            Históricos por verificar ({nf.format(ownerKey ? byOwner(d.historicalList).length : d.historicalTotal)})
            <span className="ml-2 text-xs font-normal text-gray-700">posibles pendientes antiguos · no se sabe si siguen pendientes</span>
          </summary>
          <p className="mt-2 text-xs text-gray-700">
            Esperan hace más de {d.windowHours} horas y el cliente no volvió a escribir. Su último mensaje no parece un cierre, por eso no se dan por resueltos,
            pero tampoco es seguro que sigan pendientes. Se verifican abriendo la conversación y resolviéndola en Emozion o respondiéndole al cliente: con cualquiera
            de las dos cosas dejan de figurar acá. No encabezan la lista operativa. Si el cliente escribe de nuevo, el caso vuelve solo a atención actual.
          </p>
          {d.historicalTotal > d.historicalList.length && (
            <p className="mt-1 text-xs text-gray-600">Se muestran los {nf.format(d.historicalList.length)} que más esperan.</p>
          )}
          <ul className="mt-2 grid gap-2 lg:grid-cols-2">
            {byOwner(d.historicalList).map((it) => <CaseCard key={it.conversationId} it={it} nowMs={nowMs} schedule={d.schedule} windowHours={d.window.hours} />)}
          </ul>
        </details>
      )}

      <StaleCard d={d} nowMs={nowMs} />
      {d.partial ? <SkeletonCard title="Cerradas sin responder" /> : <ClosedCard d={d} nowMs={nowMs} />}
    </section>
  );
}

/** Lugar de una tarjeta que todavía se está calculando (carga progresiva). */
function SkeletonCard({ title }: { title: string }) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3" aria-busy="true">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <p className="mt-1 text-sm text-gray-600">Cargando…</p>
      <div className="mt-2 space-y-2" aria-hidden="true">
        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-gray-200" />
      </div>
    </div>
  );
}

const COVER_LEVELS = {
  ATENCION: { label: "Atención", dot: "bg-red-600", box: "border-red-300 bg-red-50", text: "text-red-900" },
  REVISAR: { label: "Para revisar", dot: "bg-orange-500", box: "border-orange-300 bg-orange-50", text: "text-orange-900" },
  AL_DIA: { label: "Al día", dot: "bg-green-600", box: "border-green-300 bg-green-50", text: "text-green-900" },
} as const;

/** Un número de la portada con su rótulo. */
function CoverFigure({ value, label, tag }: { value: string; label: string; tag?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dd className="w-16 shrink-0 text-right text-2xl font-semibold tabular-nums text-gray-900">{value}</dd>
      <dt className="text-sm leading-tight text-gray-800">
        {label}
        {tag ? <span className="ml-1.5 rounded border border-gray-300 px-1 text-[11px] font-semibold text-gray-700">{tag}</span> : null}
      </dt>
    </div>
  );
}

/**
 * Portada de 30 segundos: estado general con su motivo, lo que espera ahora y los cierres de
 * hoy. Reemplaza al encabezado: lleva también el contexto horario, la hora de cálculo, el
 * último evento y los avisos.
 */
function CoverCard({ d, nowMs, refreshing }: { d: NowPayload; nowMs: number; refreshing: boolean }) {
  const w = d.waiting;
  const status = coverStatus({ criticalCurrent: w.criticalCurrent, urgent: w.urgent, closing: d.window.closing, completedOrders: w.completedOrders, insisting: w.insisting });
  const lv = COVER_LEVELS[status.level];
  const paused = d.schedule !== null && !d.schedule.inPublicHours;
  const fr = d.progress?.firstResponse.today ?? null;
  const frSmall = fr ? comparisonVerdict(fr, fr).kind === "SMALL_SAMPLE" : false;
  const tc = d.todayClosures;
  const errors = d.quality.checks?.events.error ?? 0;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={`border-b px-3 py-2 ${lv.box}`}>
        <p className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base font-semibold ${lv.text}`}>
          <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${lv.dot}`} />
          <span>{lv.label}</span>
          <span className="text-sm font-medium">
            {status.reasons.length > 0 ? status.reasons.join(" · ") : "Sin demoras críticas, posibles urgencias, ventanas por vencer ni pedidos completos sin respuesta."}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-gray-700">
          {!d.schedule ? "Sin configuración de horarios cargada"
            : d.schedule.inPublicHours ? "Dentro del horario público"
            : d.schedule.operatorShiftActive ? "Fuera del horario público · dentro del horario de operadores"
            : "Fuera del horario público y del horario de operadores"}
          {paused ? " · reloj de la meta pausado" : ""}
          {" · "}calculado a las {timeFmt.format(new Date(d.generatedAt))}{d.partial ? " · cargando el resto…" : refreshing ? " · actualizando…" : ""}
          {" · "}último evento: {d.quality.freshness.lastWebhookAt ? whenLabel(d.quality.freshness.lastWebhookAt, nowMs) : "sin dato"}
        </p>
      </div>

      <div className="px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Ahora</h2>
        <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <CoverFigure value={nf.format(w.ordersUntaken)} label="pedidos sin tomar" tag="Detectado" />
          <CoverFigure value={nf.format(w.queriesUnanswered)} label="consultas sin responder" tag="Detectado" />
          <CoverFigure value={w.claims === null ? (d.partial ? "…" : "—") : nf.format(w.claims)} label="posibles reclamos abiertos" tag="Detectado por palabras" />
          <CoverFigure value={w.oldestWaitStart ? formatWait(minutesSince(w.oldestWaitStart, nowMs)) : "—"} label="mayor espera entre los recientes" />
        </dl>
        <p className="mt-1.5 text-sm text-gray-800">
          <span className="font-semibold tabular-nums">{nf.format(w.current)}</span> {w.current === 1 ? "pendiente reciente" : "pendientes recientes"}
          {w.historical > 0 ? <> + <span className="font-semibold tabular-nums">{nf.format(w.historical)}</span> {w.historical === 1 ? "antiguo" : "antiguos"} por verificar</> : null}
        </p>
        <p className="mt-0.5 text-sm text-gray-800">
          Primera respuesta hoy:{" "}
          {d.partial ? "cargando…" : !fr || !d.schedule ? "sin datos"
            : fr.hasPublicHours === false ? <>la mitad en <span className="font-semibold">{mins(fr.medianClockMinutes)}</span> de espera real · hoy no hay horario público, la meta no aplica</>
            : <>la mitad en <span className="font-semibold">{mins(fr.medianBusinessMinutes)}</span> · meta {d.schedule.goalMinutes} min</>}
          {fr && frSmall ? <span className="text-gray-700"> · Muestra pequeña: {nf.format(fr.answered)} {fr.answered === 1 ? "respondida" : "respondidas"} de {nf.format(fr.entries)}, no permite concluir cómo viene el día</span> : null}
        </p>
      </div>

      <div className="border-t border-gray-100 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Hoy</h2>
        {!tc ? (
          <p className="mt-1 text-sm text-gray-600" aria-busy={d.partial ? "true" : undefined}>{d.partial ? "Cargando los cierres de hoy…" : "Cierres de hoy: no disponible."}</p>
        ) : (
          <>
            <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-3">
              <CoverFigure value={nf.format(tc.sales)} label="ventas concretadas" />
              <CoverFigure value={nf.format(tc.queries)} label="consultas resueltas" />
              <CoverFigure value={nf.format(tc.notCompleted.customerLeft + tc.notCompleted.noStockOrNotCarried)} label="no concretadas" />
            </dl>
            <p className="mt-1 text-xs text-gray-700">
              No concretadas: {nf.format(tc.notCompleted.customerLeft)} el cliente no siguió · {nf.format(tc.notCompleted.noStockOrNotCarried)} sin stock o no lo trabajamos.
              {tc.other > 0 ? ` Otros cierres con tipo: ${nf.format(tc.other)}.` : ""}
            </p>
            <p className="mt-0.5 text-xs text-gray-700">
              {nf.format(tc.typed)} de {nf.format(tc.closed)} cierres con tipo.
              {tc.lowCoverage ? <span className="ml-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900">Pocos cierres con tipo: dato parcial</span> : null}
            </p>
          </>
        )}
      </div>

      {errors > 0 && d.quality.checks && (
        <p role="status" className="border-t border-orange-200 bg-orange-50 px-3 py-1.5 text-xs text-orange-900">
          Hay {nf.format(errors)} {errors === 1 ? "evento" : "eventos"} de Emozion con error en los últimos {d.quality.checks.days} días: los indicadores pueden estar incompletos.
          El detalle está en &quot;Calidad de datos&quot;.
        </p>
      )}
      <div className="border-t border-gray-100 px-3 pb-2">
        <More>
          El color resume la atención actual: rojo si hay demoras críticas o posibles urgencias; naranja si hay ventanas de WhatsApp por vencer, pedidos completos sin
          primera respuesta o clientes insistiendo; verde si no hay nada de eso. Los antiguos por verificar no cambian el color.
          {" "}Pedidos sin tomar: pendientes recientes sin primera respuesta que completaron el recorrido del bot, mandaron el link de una receta electrónica o
          escribieron la frase con la que llega un pedido. Consultas sin responder: el resto de los pendientes recientes sin primera respuesta. Los dos son detectados,
          no medidos; no se leen nombres de productos.
          {" "}Hoy: conversaciones resueltas hoy, por el tipo de cierre que eligió el operador. Las que se cerraron sin tipo no entran en ningún grupo, por eso se
          muestra cuántas lo tienen. &quot;No concretadas&quot; no es lo mismo que una venta perdida: junta los pedidos que el cliente no siguió con los que no se
          pudieron vender.
          {" "}El horario público determina el cálculo de la meta. El horario de operadores indica cuándo está previsto que trabaje el equipo; no demuestra presencia.
          Que no lleguen eventos nuevos no prueba, por sí solo, una falla: puede no haber movimiento.
        </More>
      </div>
    </div>
  );
}

/**
 * Gráfico chico de pendientes durante el turno: una sola serie, línea fina, eje recesivo y los
 * valores inicial, máximo y actual rotulados. Cada punto tiene su valor al pasar el cursor
 * o tocarlo, y la misma información está en la tabla desplegable.
 */
function TrendChart({ points }: { points: NonNullable<NowPayload["trend"]>["points"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 96, PL = 26, PR = 30, PT = 10, PB = 18;
  const t0 = new Date(points[0].at).getTime();
  const t1 = new Date(points[points.length - 1].at).getTime();
  const max = Math.max(1, ...points.map((p) => p.pending));
  const x = (iso: string) => PL + (t1 === t0 ? 0 : ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - PL - PR));
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.pending).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" className="h-24 w-full max-w-md" onMouseLeave={() => setHover(null)}
        aria-label={`Pendientes durante el turno: ${points[0].pending} a las ${timeFmt.format(new Date(points[0].at))}, ${last.pending} a las ${timeFmt.format(new Date(last.at))}, máximo ${max}.`}>
        {/* Eje y líneas de referencia, recesivos */}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeWidth="1" />
        <line x1={PL} x2={W - PR} y1={y(max)} y2={y(max)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 3" />
        <text x={PL - 4} y={y(max) + 3} textAnchor="end" fontSize="9" fill="#6b7280">{max}</text>
        <text x={PL - 4} y={y(0) + 3} textAnchor="end" fontSize="9" fill="#6b7280">0</text>
        <text x={PL} y={H - 4} textAnchor="start" fontSize="9" fill="#6b7280">{timeFmt.format(new Date(points[0].at))}</text>
        <text x={W - PR} y={H - 4} textAnchor="end" fontSize="9" fill="#6b7280">{timeFmt.format(new Date(last.at))}</text>
        <path d={path} fill="none" stroke="#1E2D5A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Valor actual, rotulado en tinta de texto */}
        <circle cx={x(last.at)} cy={y(last.pending)} r="4" fill="#1E2D5A" stroke="#fff" strokeWidth="2" />
        <text x={x(last.at) + 7} y={y(last.pending) + 3} fontSize="11" fontWeight="600" fill="#111827">{last.pending}</text>
        {h && (
          <>
            <line x1={x(h.at)} x2={x(h.at)} y1={PT} y2={y(0)} stroke="#9ca3af" strokeWidth="1" />
            <circle cx={x(h.at)} cy={y(h.pending)} r="4" fill="#1E2D5A" stroke="#fff" strokeWidth="2" />
          </>
        )}
        {/* Zonas de contacto más anchas que la marca */}
        {points.map((p, i) => {
          const left = i === 0 ? PL : (x(points[i - 1].at) + x(p.at)) / 2;
          const right = i === points.length - 1 ? W - PR : (x(p.at) + x(points[i + 1].at)) / 2;
          return <rect key={p.at} x={left} y={0} width={Math.max(1, right - left)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />;
        })}
      </svg>
      <p className="h-4 text-xs tabular-nums text-gray-700" aria-live="polite">
        {h ? <>{timeFmt.format(new Date(h.at))} · <span className="font-semibold text-gray-900">{nf.format(h.pending)}</span> pendientes</> : null}
      </p>
      <details>
        <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver como tabla</summary>
        <table className="mt-1 text-xs text-gray-800">
          <thead><tr><th className="pr-4 text-left font-medium text-gray-600">Hora</th><th className="text-right font-medium text-gray-600">Pendientes</th></tr></thead>
          <tbody>
            {points.map((p) => <tr key={p.at}><td className="pr-4 tabular-nums">{timeFmt.format(new Date(p.at))}</td><td className="text-right tabular-nums">{nf.format(p.pending)}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** "Últimos 60 minutos" y la evolución de la cola durante el turno. */
function TrendCard({ d }: { d: NowPayload }) {
  const t = d.trend;
  if (!t) {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-800">Últimos 60 minutos</h2>
        <p className="mt-1 text-sm text-gray-600">No disponible</p>
        <Evidence level="NO_DISPONIBLE" />
      </div>
    );
  }
  const h = t.lastHour;
  const diff = h.pendingNow - h.pendingBefore;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">
        Últimos 60 minutos
        <span className="ml-2 text-xs font-normal text-gray-600">calculado a las {timeFmt.format(new Date(t.generatedAt))}</span>
      </h2>
      <p className="mt-1 text-sm text-gray-900">
        <span className="text-lg font-semibold" aria-hidden="true">{diff > 0 ? "↑" : diff < 0 ? "↓" : "→"}</span>{" "}
        <span className="font-semibold">
          {diff === 0 ? "La cola está igual" : diff > 0 ? `La cola subió ${nf.format(diff)}` : `La cola bajó ${nf.format(-diff)}`}
        </span>
        : había {nf.format(h.pendingBefore)} pendientes hace una hora y hay {nf.format(h.pendingNow)} ahora.
      </p>
      <dl className="mt-2 space-y-0.5 text-sm text-gray-800">
        <div className="flex justify-between gap-2"><dt>Conversaciones nuevas</dt><dd className="font-semibold tabular-nums text-gray-900">{nf.format(h.newConversations)}</dd></div>
        <div className="flex justify-between gap-2"><dt>Conversaciones que recibieron una respuesta de un operador</dt><dd className="font-semibold tabular-nums text-gray-900">{nf.format(h.answered)}</dd></div>
      </dl>
      <h3 className="mt-3 text-xs font-semibold text-gray-700">
        Pendientes recientes {t.fromIsShift ? "desde el inicio del horario de operadores" : "desde el comienzo del día"}
      </h3>
      <p className="text-xs text-gray-600">Muestra la cola reciente (hasta {d.windowHours} horas de espera). El resumen de arriba cuenta aparte los antiguos por verificar.</p>
      {t.points.length >= 2 ? <TrendChart points={t.points} /> : <p className="mt-1 text-sm text-gray-600">Todavía no hay puntos para mostrar.</p>}
      <More>
        &quot;Pendiente&quot; es, en todos los momentos, una conversación abierta cuyo último mensaje era del cliente y que esperaba hace hasta {d.windowHours} horas. No
        incluye los posibles pendientes antiguos, por eso el número de ahora puede ser menor que el total de pendientes de arriba. La variación compara la cola en dos
        momentos con la misma regla; no es conversaciones nuevas menos respondidas, porque en el medio hay reaperturas, cierres y clientes que vuelven a escribir. Que la
        cola baje no quiere decir que se atendió esa cantidad de casos. Hay un punto cada {t.stepMinutes} minutos y el cálculo se renueva cada 5 minutos.
      </More>
      <Evidence level="MEDIDO" />
    </div>
  );
}

/** "Actividad observada": la última respuesta pública de un operador y el detalle por cuenta. No es presencia. */
function ObservedCard({ d, nowMs }: { d: NowPayload; nowMs: number }) {
  const o = d.observed;
  const pending = d.waiting.total + d.waiting.oldPending;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">Actividad observada</h2>
      {!o ? (
        <p className="mt-1 text-sm text-gray-600">No disponible</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-800">
            Última respuesta pública de un operador:{" "}
            <span className="text-lg font-semibold tabular-nums text-gray-900">
              {o.lastResponseAt ? `hace ${formatWait(minutesSince(o.lastResponseAt, nowMs))}` : `ninguna en los últimos ${o.lookbackDays} días`}
            </span>
            {o.lastResponseAt ? <span className="text-xs text-gray-600"> · {whenLabel(o.lastResponseAt, nowMs)}</span> : null}
          </p>
          {o.review && (
            <p role="status" className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-900">
              <span className="font-semibold">Para revisar:</span> hay {nf.format(pending)} {pending === 1 ? "pendiente" : "pendientes"}, es horario de operadores y pasaron más de{" "}
              {formatWait(o.warningMinutes)} sin una respuesta pública. No significa que nadie esté trabajando.
            </p>
          )}
          {o.accounts.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver por cuenta</summary>
              <ul className="mt-1 divide-y divide-gray-100">
                {o.accounts.map((a) => (
                  <li key={a.label} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-xs text-gray-700">
                    <span className="font-medium text-gray-900">{a.label}</span>
                    <span className="tabular-nums">
                      última respuesta {whenLabel(a.lastResponseAt, nowMs)} · <span className="font-semibold text-gray-900">{nf.format(a.conversations)}</span>{" "}
                      {a.conversations === 1 ? "conversación atendida" : "conversaciones atendidas"} {o.sinceIsShift ? "en el turno" : "hoy"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <More>
            Es actividad registrada, no presencia: cuenta los mensajes públicos de operador que llegaron, sin el bot, las notas internas ni las cuentas de asignación
            automática. Conviene leerlo junto con los pendientes y con la hora del último evento recibido. Las conversaciones atendidas se cuentan desde{" "}
            {o.sinceIsShift ? "el inicio del horario de operadores de hoy" : "el comienzo del día"}, a las {timeFmt.format(new Date(o.since))}; una conversación en la que
            respondieron dos cuentas cuenta en las dos.{o.inOperatorHours === null ? " Sin configuración cargada no se conoce el horario de operadores y no se muestra el aviso." : ""}
          </More>
        </>
      )}
      <Evidence level={o ? "MEDIDO" : "NO_DISPONIBLE"} />
    </div>
  );
}

const OWNER_GROUP_NOTES: Partial<Record<NowOwnerRow["group"], string>> = {
  SUPERVISION: "supervisión",
  SIN_TOMAR: "asignación automática",
};

/**
 * "Quién tiene cada caso": una fila por cuenta con conversaciones abiertas, según el asignado
 * actual. Cada fila es un botón que filtra la lista de casos. Compacto: en el celular cada
 * fila ocupa dos líneas.
 */
function OwnersCard({ d, nowMs, selected, onSelect }: { d: NowPayload; nowMs: number; selected: string | null; onSelect: (key: string) => void }) {
  const o = d.owners;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">
        Asignación registrada
        {o ? <span className="ml-2 text-xs font-normal text-gray-600">{nf.format(o.open)} conversaciones abiertas</span> : null}
      </h2>
      {!o ? (
        <p className="mt-1 text-sm text-gray-600">No disponible</p>
      ) : o.rows.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600">No hay conversaciones abiertas.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {o.rows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => onSelect(r.key)} aria-pressed={selected === r.key}
                className={`flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 text-left ${selected === r.key ? "bg-blue-50 ring-2 ring-[#1E2D5A]" : "hover:bg-gray-50"}`}>
                <span className="min-w-0 text-sm font-medium text-gray-900">
                  {r.label}
                  {OWNER_GROUP_NOTES[r.group] ? <span className="ml-1.5 text-xs font-normal text-gray-600">{OWNER_GROUP_NOTES[r.group]}</span> : null}
                </span>
                <span className="text-xs tabular-nums text-gray-700">
                  <span className="font-semibold text-gray-900">{nf.format(r.open)}</span> abiertas
                  {" · "}<span className="font-semibold text-gray-900">{nf.format(r.waiting)}</span> esperan
                  {r.oldestWaitStart ? <> · la más vieja <span className="font-semibold text-gray-900">{formatWait(minutesSince(r.oldestWaitStart, nowMs))}</span></> : null}
                  {r.windowClosed > 0 ? <> · <span className="font-semibold text-red-800">{nf.format(r.windowClosed)} con ventana cerrada</span></> : null}
                </span>
              </button>
              {r.detected && (r.detected.byAccount.length > 0 || r.detected.none > 0) && (
                <p className="px-2 pb-1.5 text-[11px] leading-snug text-gray-600">
                  <span className="mr-1 rounded border border-gray-300 px-1 font-semibold text-gray-700">Antecedente</span>
                  último operador que respondió (no es el responsable actual):{" "}
                  {[...r.detected.byAccount.map((a) => `${a.label} ${nf.format(a.open)}`), ...(r.detected.none > 0 ? [`ninguno ${nf.format(r.detected.none)}`] : [])].join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-700">Tocá una fila para ver sus casos.</p>
      <More>
        Es la asignación que registró Emozion, no quién está trabajando el caso. Cada conversación abierta va en la fila de la cuenta que tiene asignada según el
        último evento recibido. Una reasignación que no cambia el estado
        puede tardar en verse. &quot;Esperan&quot; son las que están en la lista de casos: el último mensaje es del cliente y esperan hace hasta {d.windowHours} horas;
        las más viejas van en los casos antiguos. &quot;Sin tomar&quot; son las que siguen en una cuenta de asignación automática. &quot;Sin dato de asignado&quot; son
        las que no traen asignado: para esas se muestra, como antecedente y aparte, la cuenta del último mensaje de un operador. Haber respondido antes no quiere decir
        que el caso sea hoy de esa cuenta.
      </More>
      <Evidence level={o ? "MEDIDO" : "NO_DISPONIBLE"} />
    </div>
  );
}

/** Número del bloque "Requiere acción": funciona como filtro de la lista de casos. */
function ActionButton({ label, value, tone, active, disabled, onClick }: {
  label: string; value: string; tone: "critical" | "warning" | "plain"; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`flex min-h-[76px] flex-col rounded-md border p-2 text-left disabled:opacity-60 ${
        active ? "border-[#1E2D5A] ring-2 ring-[#1E2D5A]" : tone === "critical" ? "border-red-200" : tone === "warning" ? "border-orange-200" : "border-gray-200"
      } ${tone === "critical" ? "bg-red-50" : tone === "warning" ? "bg-orange-50" : "bg-white"}`}>
      <span className={`text-xl font-semibold tabular-nums ${tone === "critical" ? "text-red-900" : tone === "warning" ? "text-orange-900" : "text-gray-900"}`}>{value}</span>
      <span className="mt-0.5 text-[11px] leading-tight text-gray-700">{label}</span>
    </button>
  );
}

/**
 * Flecha de avance: verde si mejora, naranja con la palabra "Peor" si empeora, gris solo si no
 * cambia. Solo se usa cuando la comparación se puede interpretar (comparisonVerdict).
 */
function Trend({ better, same, text }: { better: boolean; same: boolean; text: string }) {
  if (same) return <span className="text-xs text-gray-700">Igual que la semana pasada</span>;
  return (
    <span className={`text-xs font-medium ${better ? "text-green-800" : "text-orange-800"}`}>
      <span aria-hidden>{better ? "▲" : "▼"}</span> {better ? "Mejor" : "Peor"}: {text}
    </span>
  );
}

/** "Avances": el turno de hoy y la primera respuesta contra el mismo día de la semana anterior. */
function ProgressCard({ d }: { d: NowPayload }) {
  const p = d.progress;
  if (!p) {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-800">Avances</h2>
        <p className="mt-1 text-sm text-gray-600">No disponible</p>
      </div>
    );
  }
  const { today, previous } = p.firstResponse;
  // Regla general: sin flecha ni color con muestra chica o con días que no son comparables.
  const verdict = comparisonVerdict(today, previous);
  const interpret = verdict.kind === "OK";
  const note = comparisonNote(verdict);
  // La mediana siempre lleva al lado sobre cuántas respondidas se calculó y de cuántas entradas.
  const answeredLabel = `${nf.format(today.answered)} ${today.answered === 1 ? "respondida" : "respondidas"} de ${nf.format(today.entries)}`;
  const windowNote = scheduleNote(today, previous);
  const pendingNow = d.waiting.total;
  const critical = d.waiting.critical;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">Avances</h2>

      <h3 className="mt-2 text-xs font-semibold text-gray-700">El turno de hoy</h3>
      {p.shift ? (
        <dl className="mt-1 space-y-1 text-sm text-gray-800">
          <div className="flex items-baseline justify-between gap-3">
            <dt>Pendientes al empezar, a las {timeFmt.format(new Date(p.shift.startedAt))}</dt>
            <dd className="shrink-0 text-lg font-semibold tabular-nums text-gray-900">{nf.format(p.shift.pendingAtStart)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt>Pendientes ahora</dt>
            <dd className="shrink-0 text-lg font-semibold tabular-nums text-gray-900">{nf.format(pendingNow)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt>Pendientes atendidas durante el turno</dt>
            <dd className="shrink-0 text-lg font-semibold tabular-nums text-gray-900">{nf.format(p.shift.attendedSince)} de {nf.format(p.shift.pendingAtStart)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-sm text-gray-600">
          {!d.schedule ? "Sin datos: falta cargar la configuración de horarios. Sin ella no se puede saber cuándo empieza el turno."
            : d.schedule.operatorsToday === "NONE" ? "Sin datos: hoy no hay horario de operadores cargado."
            : d.schedule.operatorsToday === "NOT_STARTED" ? `Sin datos: el horario de operadores de hoy todavía no empezó${d.schedule.operatorsStartAt ? ` (empieza a las ${timeFmt.format(new Date(d.schedule.operatorsStartAt))})` : ""}.`
            : "No disponible: el horario de operadores ya empezó, pero no se pudo calcular."}
        </p>
      )}
      {p.shift && pendingNow !== p.shift.pendingAtStart && (
        <p className="mt-1">
          <Trend better={pendingNow < p.shift.pendingAtStart} same={false}
            text={`${nf.format(Math.abs(pendingNow - p.shift.pendingAtStart))} ${pendingNow < p.shift.pendingAtStart ? "menos" : "más"} que al empezar`} />
        </p>
      )}
      {critical !== null && critical > 0 && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-900">
          {nf.format(critical)} {critical === 1 ? "caso sigue" : "casos siguen"} en demora crítica.
        </p>
      )}

      <h3 className="mt-3 border-t border-gray-100 pt-2 text-xs font-semibold text-gray-700">
        Primera respuesta: hoy contra el {dayFmt.format(new Date(`${previous.day}T12:00:00.000-03:00`))}, a esta misma hora
      </h3>
      {today.hasPublicHours === false ? (
        <>
          <p className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800">
            Hoy no hay horario público: la meta pública no aplica a las entradas de hoy. Se muestra la espera real.
          </p>
          <dl className="mt-2 space-y-2 text-sm text-gray-800">
            <div className="flex items-baseline justify-between gap-3">
              <dt>Recibieron respuesta</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(today.answered)} de {nf.format(today.entries)} <span className="font-normal text-gray-600">· antes {nf.format(previous.answered)} de {nf.format(previous.entries)}</span></dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>Siguen sin primera respuesta</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(today.pending)} <span className="font-normal text-gray-600">· antes {nf.format(previous.pending)}</span></dd>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Mediana de espera real entre las {answeredLabel}</dt>
                <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{mins(today.medianClockMinutes)} <span className="font-normal text-gray-600">· antes {mins(previous.medianClockMinutes)}</span></dd>
              </div>
              {interpret && today.medianClockMinutes !== null && previous.medianClockMinutes !== null && (
                <Trend better={today.medianClockMinutes < previous.medianClockMinutes} same={mins(today.medianClockMinutes) === mins(previous.medianClockMinutes)}
                  text={formatWait(Math.abs(today.medianClockMinutes - previous.medianClockMinutes))} />
              )}
            </div>
          </dl>
          {note && <p className="mt-2 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-800">{note}</p>}
        </>
      ) : (
      <dl className="mt-1 space-y-2 text-sm text-gray-800">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>Respondidas dentro de la meta</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{pct(today.compliance)} <span className="font-normal text-gray-600">· antes {pct(previous.compliance)}</span></dd>
            </div>
            {interpret && today.compliance !== null && previous.compliance !== null && (
              <Trend better={today.compliance > previous.compliance} same={pct(today.compliance) === pct(previous.compliance)}
                text={`${Math.abs(Math.round((today.compliance - previous.compliance) * 100))} puntos`} />
            )}
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>Mediana en tiempo hábil entre las {answeredLabel}</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{mins(today.medianBusinessMinutes)} <span className="font-normal text-gray-600">· antes {mins(previous.medianBusinessMinutes)}</span></dd>
            </div>
            {interpret && today.medianBusinessMinutes !== null && previous.medianBusinessMinutes !== null && (
              <Trend better={today.medianBusinessMinutes < previous.medianBusinessMinutes} same={mins(today.medianBusinessMinutes) === mins(previous.medianBusinessMinutes)}
                text={formatWait(Math.abs(today.medianBusinessMinutes - previous.medianBusinessMinutes))} />
            )}
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt>Siguen sin primera respuesta</dt>
            <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(today.pending)} de {nf.format(today.entries)} <span className="font-normal text-gray-600">· antes {nf.format(previous.pending)} de {nf.format(previous.entries)}</span></dd>
          </div>
          {today.pendingOverdue !== null && (
            <div className="flex items-baseline justify-between gap-3">
              <dt>De esas, con la meta ya vencida</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(today.pendingOverdue)}{previous.pendingOverdue !== null ? <span className="font-normal text-gray-600"> · antes {nf.format(previous.pendingOverdue)}</span> : null}</dd>
            </div>
          )}
          {note && <p className="rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-800">{note}</p>}
        </dl>
      )}
      <h3 className="mt-3 border-t border-gray-100 pt-2 text-xs font-semibold text-gray-700">Ventana de WhatsApp</h3>
      {p.windowClosed ? (
        <div className="mt-1 text-sm text-gray-800">
          <div className="flex items-baseline justify-between gap-3">
            <span>Conversaciones cuya ventana se cerró sin respuesta, hoy</span>
            <span className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(p.windowClosed.today)} <span className="font-normal text-gray-600">· antes {nf.format(p.windowClosed.previous)}</span></span>
          </div>
          {windowNote === null ? (
            <Trend better={p.windowClosed.today < p.windowClosed.previous} same={p.windowClosed.today === p.windowClosed.previous}
              text={`${nf.format(Math.abs(p.windowClosed.today - p.windowClosed.previous))} ${p.windowClosed.today < p.windowClosed.previous ? "menos" : "más"}`} />
          ) : (
            <span className="text-xs text-gray-700">{windowNote}</span>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm text-gray-600">No disponible</p>
      )}
      <More>
        Ventana cerrada sin respuesta: pasaron {d.window.hours} horas de reloj desde el último mensaje del cliente sin la primera respuesta de una persona. Cuenta las
        ventanas que se cerraron hoy, hayan entrado cuando hayan entrado, contra las del mismo día de la semana pasada hasta esta misma hora.
        {" "}Pendientes al empezar el turno: conversaciones abiertas, con el último mensaje del cliente y hasta {d.windowHours} horas de espera, a la hora en que empieza el
        horario de operadores. La comparación toma lo que había entrado y lo que se había respondido el mismo día de la semana pasada a esta misma hora
        ({nf.format(today.entries)} entradas hoy, {nf.format(previous.entries)} ese día). Las medianas describen solo las conversaciones ya respondidas. La flecha de mejor o peor
        aparece solo si cada día tiene al menos 20 respondidas y más de la mitad de sus entradas respondidas, y si se sabe que los dos días tienen la misma condición de horario público (sin configuración de alguno de los dos, no hay flecha). &quot;Sin datos&quot; quiere decir que no hay con qué calcularlo, no que sea cero.
      </More>
      <Evidence level="MEDIDO" />
    </div>
  );
}

/** Explicación ampliable: en el celular no ocupa lugar hasta que se la pide. */
function More({ children }: { children: ReactNode }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Qué significa</summary>
      <p className="text-xs text-gray-700">{children}</p>
    </details>
  );
}

function Evidence({ level }: { level: keyof typeof EVIDENCE_LABELS }) {
  return <p className="mt-2 text-[11px] text-gray-500">{EVIDENCE_LABELS[level]}</p>;
}

function ConversationLink({ id }: { id: string }) {
  return (
    <Link href={`/call-center/${id}`} className="inline-flex min-h-[36px] items-center text-xs font-medium text-[#1E2D5A] hover:underline">
      Ver conversación →
    </Link>
  );
}

/** Etiqueta del semáforo con el tiempo destacado, en una línea. Sin configuración no hay semáforo: solo la espera real. */
function WaitBadge({ it, schedule }: { it: NowListItem; schedule: NowPayload["schedule"] }) {
  // Un histórico por verificar no lleva semáforo: "crítico" y "posible" son dos niveles de certeza distintos.
  if (it.historical) {
    return (
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Por verificar</span>
        <span className="text-base font-semibold tabular-nums text-gray-900">Espera desde hace {formatWait(it.waitMinutes)}</span>
      </p>
    );
  }
  if (it.level === null) {
    return <p className="text-base font-semibold tabular-nums text-gray-900">Espera real: {formatWait(it.waitMinutes)}</p>;
  }
  const l = LEVELS[it.level];
  const paused = schedule !== null && !schedule.inPublicHours;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${l.chip}`}>
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${l.dot}`} />
        {l.label}
      </span>
      <span className="text-base font-semibold tabular-nums text-gray-900">Espera real: {formatWait(it.waitMinutes)}</span>
      {it.businessMinutes !== null && (
        <span className="basis-full text-xs text-gray-700">
          {it.businessPartial && schedule?.businessSince
            ? `Tiempo hábil calculado desde el ${dayFmt.format(new Date(`${schedule.businessSince}T12:00:00.000-03:00`))}: ${formatWait(it.businessMinutes)} · no hay horarios cargados antes de esa fecha`
            : `Tiempo hábil acumulado: ${formatWait(it.businessMinutes)}`}
          {paused ? ` · reloj pausado${schedule?.operatorShiftActive ? " · dentro del horario de operadores" : ""}` : ""}
        </span>
      )}
    </p>
  );
}

/** Tarjeta compacta: semáforo y tiempo, las dos etiquetas, desde cuándo espera y el enlace. */
function CaseCard({ it, nowMs, schedule, windowHours }: { it: NowListItem; nowMs: number; schedule: NowPayload["schedule"]; windowHours: number }) {
  // El cliente escribió de nuevo después del primer mensaje sin responder: espera y ventana cuentan desde momentos distintos.
  const insisted = new Date(it.lastCustomerAt).getTime() - new Date(it.waitStart).getTime() >= 60_000;
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <WaitBadge it={it} schedule={schedule} />
        <ConversationLink id={it.conversationId} />
      </div>
      <p className="mt-1 flex flex-wrap gap-1.5">
        {it.oldPending && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Posible pendiente antiguo</span>}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{ownerLabel(it.owner)}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{it.hasHumanResponse ? "Esperando nueva respuesta" : "Sin primera respuesta"}</span>
        {it.botOrderComplete && !it.hasHumanResponse && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">Pedido completo</span>}
      </p>
      {it.claims !== null && it.claims.length > 0 && (
        <p className="mt-1"><span className="inline-block rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-900">Reclamo detectado · {it.claims.map((c) => CLAIM_LABELS[c]).join(" · ")}</span></p>
      )}
      {it.detectedOwner && (
        <p className="mt-1 text-xs text-gray-700">
          <span className="mr-1 rounded border border-gray-300 px-1 text-[11px] font-semibold text-gray-700">Antecedente</span>
          último operador que respondió, no el responsable actual: <span className="font-medium text-gray-900">{it.detectedOwner}</span>
        </p>
      )}
      {it.alert === "URGENTE" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900">Posible urgencia · el cliente pide urgencia o avisa que se va</span></p>
      )}
      {it.alert === "INSISTIENDO" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-900">Insistiendo · volvió a escribir sin respuesta</span></p>
      )}
      {it.window === "CERRADA" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-gray-400 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-900">Ventana cerrada hace {windowClosedAgoLabel(it.lastCustomerAt, nowMs, windowHours)} · requiere plantilla</span></p>
      )}
      {it.window === "POR_VENCER" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-900">Ventana vence en {windowLeftLabel(it.lastCustomerAt, nowMs, windowHours)}</span></p>
      )}
      {/* La espera cuenta desde el primer mensaje sin responder y la ventana desde el último: si el cliente volvió a escribir, difieren. */}
      {it.window === "ABIERTA" && insisted && (
        <p className="mt-1"><span className="inline-block rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-900">Ventana vence en {windowLeftLabel(it.lastCustomerAt, nowMs, windowHours)}</span></p>
      )}
      <p className="mt-1 text-xs text-gray-700">
        Espera respuesta desde <span className="font-semibold text-gray-900">{whenLabel(it.waitStart, nowMs)}</span>, el primer mensaje que quedó sin responder
        {it.thanksCandidate ? " · puede ser solo un agradecimiento" : ""}
      </p>
      <p className="text-xs text-gray-600">
        {insisted ? "El cliente volvió a escribir: la ventana de WhatsApp cuenta desde su último mensaje, " : "Último mensaje del cliente "}{whenLabel(it.lastCustomerAt, nowMs)}
        {it.window === "ABIERTA" && !insisted ? ` · ventana de WhatsApp abierta, quedan ${windowLeftLabel(it.lastCustomerAt, nowMs, windowHours)}` : ""}
        {" "}· la conversación entró {whenLabel(it.createdAt, nowMs)}
      </p>
    </li>
  );
}

function StaleCard({ d, nowMs }: { d: NowPayload; nowMs: number }) {
  const s = d.stale;
  const classified = s.probableClose !== null && s.pending !== null;
  const pending = s.items.filter((it) => it.kind !== "PROBABLE_CLOSE");
  const closing = s.items.filter((it) => it.kind === "PROBABLE_CLOSE");
  return (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Casos antiguos por revisar</h2>
        <p className="text-2xl font-semibold tabular-nums text-gray-900">{nf.format(s.total)}</p>
      </div>
      <p className="mt-1 text-xs text-gray-700">
        Abiertas hace más de {d.windowHours} horas.
        {s.oldestWaitStart ? ` La más vieja espera desde el ${dayFmt.format(new Date(s.oldestWaitStart))}.` : ""}
        {s.total > 0 ? ` ${nf.format(d.window.staleClosed)} de ${nf.format(s.total)} tienen la ventana de WhatsApp cerrada: para retomarlas hace falta una plantilla.` : ""}
      </p>
      {classified ? (
        <>
          <StaleGroup title="Posibles pendientes antiguos" count={s.pending!} note="El último mensaje del cliente no es un cierre, o trae una consulta, un pedido o un adjunto. Están también en la lista de casos y en las alertas." items={pending} nowMs={nowMs} />
          <StaleGroup title="Probablemente resueltas" count={s.probableClose!} note="El último mensaje del cliente es un agradecimiento o un cierre: pueden haber quedado abiertas por error." items={closing} nowMs={nowMs} />
        </>
      ) : (
        <StaleGroup title="Sin clasificar" count={s.total} note="No se pudo revisar el último mensaje de estos casos." items={s.items} nowMs={nowMs} />
      )}
      <Evidence level={classified ? "DETECTADO" : "MEDIDO"} />
    </div>
  );
}

function StaleGroup({ title, count, note, items, nowMs }: { title: string; count: number; note: string; items: NowPayload["stale"]["items"]; nowMs: number }) {
  return (
    <details className="mt-2 border-t border-amber-200 pt-2">
      <summary className="flex cursor-pointer items-baseline justify-between gap-2 py-1 text-sm text-gray-900">
        <span className="font-medium">{title}</span>
        <span className="font-semibold tabular-nums">{nf.format(count)}</span>
      </summary>
      <p className="text-xs text-gray-700">{note}</p>
      {items.length < count && <p className="text-xs text-gray-700">Se muestran las {nf.format(items.length)} más viejas.</p>}
      <ul className="mt-1 divide-y divide-amber-200">
        {items.map((it) => (
          <li key={it.conversationId} className="flex items-center justify-between gap-2 py-1">
            <span className="text-xs text-gray-800">
              Espera desde {whenLabel(it.waitStart, nowMs)}
              <span className="block text-gray-700">{it.windowClosed ? "Ventana de WhatsApp cerrada · requiere plantilla" : "Ventana de WhatsApp abierta"}</span>
            </span>
            <ConversationLink id={it.conversationId} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function ClosedCard({ d, nowMs }: { d: NowPayload; nowMs: number }) {
  const c = d.closedUnanswered;
  return (
    <div id="cerradas-sin-responder" className="mt-3 scroll-mt-4 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Cerradas sin responder</h2>
        <p className="text-2xl font-semibold tabular-nums text-gray-900">{c ? nf.format(c.total) : "No disponible"}</p>
      </div>
      {c && (
        <>
          <p className="mt-1 text-xs text-gray-700">
            Últimos {c.days} días.
            {d.window.closedUnansweredClosed !== null && c.total > 0 ? ` ${nf.format(d.window.closedUnansweredClosed)} de ${nf.format(c.total)} tienen la ventana de WhatsApp cerrada.` : ""}
          </p>
          <More>Se cerraron sin contestar lo último que escribió el cliente. No incluye agradecimientos ni avisos de que ya compró.</More>
          <dl className="mt-2 space-y-0.5 text-sm text-gray-700">
            <div className="flex justify-between gap-2"><dt>Con una consulta</dt><dd className="font-medium tabular-nums text-gray-900">{nf.format(c.question)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Con un pedido</dt><dd className="font-medium tabular-nums text-gray-900">{nf.format(c.order)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Con receta o comprobante</dt><dd className="font-medium tabular-nums text-gray-900">{nf.format(c.attachment)}</dd></div>
          </dl>
          {c.items.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver casos</summary>
              <ul className="mt-1 divide-y divide-gray-100">
                {c.items.map((it) => (
                  <li key={it.conversationId} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs text-gray-700">
                      {REASON_LABELS[it.reason]}
                      <span className="block text-gray-600">Escribió {whenLabel(it.lastCustomerAt, nowMs)} · {it.windowClosed ? "ventana de WhatsApp cerrada, requiere plantilla" : "ventana de WhatsApp abierta"}</span>
                    </span>
                    <ConversationLink id={it.conversationId} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <Evidence level={c ? "DETECTADO" : "NO_DISPONIBLE"} />
    </div>
  );
}
