"use client";

import { useState } from "react";
import Link from "next/link";
import { EVIDENCE_LABELS } from "@/lib/call-center/metrics/indicators";
import { formatMinutes as formatWait } from "@/lib/call-center/metrics/format";
import type { ClosedReason, NowListItem, NowPayload, WaitLevel } from "@/lib/call-center/metrics/now-types";
import { useNowData } from "./useNowData";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: TZ });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

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
  o.kind === "SYSTEM" ? "Asignación automática" : o.kind === "ACCOUNT" ? `Asignada a ${o.label}` : "Sin responsable identificado";

/** Semáforo: fondo suave y la etiqueta siempre en texto. Fuera del horario público va sin color. */
const LEVELS: Record<WaitLevel, { label: string; chip: string; dot: string }> = {
  EN_PLAZO: { label: "En plazo", chip: "border-green-200 bg-green-50 text-green-900", dot: "bg-green-600" },
  DEMORADO: { label: "Demorado", chip: "border-orange-200 bg-orange-50 text-orange-900", dot: "bg-orange-500" },
  CRITICO: { label: "Crítico", chip: "border-red-200 bg-red-50 text-red-900", dot: "bg-red-600" },
  FUERA_HORARIO: { label: "Fuera del horario público", chip: "border-gray-300 bg-white text-gray-800", dot: "border border-gray-400 bg-white" },
};

const REASON_LABELS: Record<ClosedReason, string> = {
  QUESTION: "Hizo una consulta",
  ORDER: "Hizo un pedido",
  ATTACHMENT: "Mandó una receta o un comprobante",
};

type CaseFilter = "all" | "critical" | "orders" | "longest";

const FILTER_LABELS: Record<Exclude<CaseFilter, "all">, string> = {
  critical: "en demora crítica",
  orders: "con pedido completo sin primera respuesta",
  longest: "el caso con mayor espera",
};

export default function NowPanel() {
  const { state, refreshing, reload } = useNowData();
  const [filter, setFilter] = useState<CaseFilter>("all");

  if (state.status === "loading") return <p className="mt-6 text-sm text-gray-500">Cargando…</p>;
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
  const shown =
    filter === "critical" ? d.list.filter((it) => it.level === "CRITICO")
    : filter === "orders" ? d.list.filter((it) => it.botOrderComplete && !it.hasHumanResponse)
    : filter === "longest" ? d.list.slice(0, 1)
    : d.list;

  return (
    <section className="mt-4" aria-label="Ahora">
      <p className="text-xs text-gray-500">
        Actualizado a las {timeFmt.format(new Date(d.generatedAt))} · últimas {d.windowHours} horas{refreshing ? " · actualizando…" : ""}
      </p>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-800">Requiere acción</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <ActionButton label="En demora crítica" value={w.critical === null ? "—" : nf.format(w.critical)} tone={w.critical ? "critical" : "plain"}
            active={filter === "critical"} disabled={w.critical === null} onClick={() => toggle("critical")} />
          <ActionButton label="Pedidos completos sin primera respuesta" value={nf.format(w.completedOrders)} tone="plain"
            active={filter === "orders"} onClick={() => toggle("orders")} />
          <ActionButton label="Mayor espera" value={w.oldestWaitStart ? formatWait(minutesSince(w.oldestWaitStart, nowMs)) : "—"} tone="plain"
            active={filter === "longest"} disabled={!w.oldestWaitStart} onClick={() => toggle("longest")} />
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Tocá un número para ver esos casos. Los grupos se superponen: no se suman.
          {w.critical === null ? " Sin configuración cargada no se puede marcar la demora crítica." : ""}
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-600">Clientes esperando respuesta</h2>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-gray-900">{nf.format(w.total)}</p>
        <p className="mt-1 text-sm text-gray-700">
          {w.oldestWaitStart ? <>El que más espera: <span className="font-semibold">{formatWait(minutesSince(w.oldestWaitStart, nowMs))}</span></> : "No hay nadie esperando."}
        </p>
        {w.total > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {nf.format(w.neverHuman)} esperan la primera respuesta · {nf.format(w.awaitingNext)} esperan la siguiente
          </p>
        )}
        <Evidence level="MEDIDO" />
      </div>

      <div className="mt-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-xs font-medium text-gray-600">Hoy</h2>
          {d.today ? (
            <dl className="mt-1 space-y-1 text-sm text-gray-700">
              <div className="flex items-baseline justify-between gap-2"><dt>Entraron</dt><dd className="text-xl font-semibold tabular-nums text-gray-900">{nf.format(d.today.entered)}</dd></div>
              <div className="flex items-baseline justify-between gap-2"><dt>Respondidos</dt><dd className="text-xl font-semibold tabular-nums text-gray-900">{nf.format(d.today.answered)}</dd></div>
            </dl>
          ) : (
            <p className="mt-1 text-sm text-gray-500">No disponible</p>
          )}
          <Evidence level={d.today ? "MEDIDO" : "NO_DISPONIBLE"} />
        </div>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        Casos{d.listTotal > 0 ? ` (${nf.format(filter === "all" ? d.listTotal : shown.length)})` : ""}
        <span className="ml-2 text-xs font-normal text-gray-500">del que más espera al que menos</span>
      </h2>
      {filter !== "all" && (
        <p className="mt-1 text-xs text-gray-700">
          Mostrando solo {FILTER_LABELS[filter]}.{" "}
          <button type="button" onClick={() => setFilter("all")} className="font-medium text-[#1E2D5A] underline">Ver todos</button>
        </p>
      )}
      {d.listTotal > d.list.length && (
        <p className="mt-1 text-xs text-gray-500">Se muestran los {nf.format(d.list.length)} que más esperan.</p>
      )}
      {shown.length === 0 ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
          {filter === "all" ? "No hay nadie esperando una respuesta." : "Ningún caso en este grupo."}
        </p>
      ) : (
        <ul className="mt-2 grid gap-2 lg:grid-cols-2">
          {shown.map((it) => <CaseCard key={it.conversationId} it={it} nowMs={nowMs} schedule={d.schedule} />)}
        </ul>
      )}

      <StaleCard d={d} nowMs={nowMs} />
      <ClosedCard d={d} nowMs={nowMs} />
    </section>
  );
}

/** Número del bloque "Requiere acción": funciona como filtro de la lista de casos. */
function ActionButton({ label, value, tone, active, disabled, onClick }: {
  label: string; value: string; tone: "critical" | "plain"; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`flex min-h-[76px] flex-col rounded-md border p-2 text-left disabled:opacity-60 ${
        active ? "border-[#1E2D5A] ring-2 ring-[#1E2D5A]" : tone === "critical" ? "border-red-200" : "border-gray-200"
      } ${tone === "critical" ? "bg-red-50" : "bg-white"}`}>
      <span className={`text-xl font-semibold tabular-nums ${tone === "critical" ? "text-red-900" : "text-gray-900"}`}>{value}</span>
      <span className="mt-0.5 text-[11px] leading-tight text-gray-700">{label}</span>
    </button>
  );
}

function Evidence({ level }: { level: keyof typeof EVIDENCE_LABELS }) {
  return <p className="mt-2 text-[11px] text-gray-400">{EVIDENCE_LABELS[level]}</p>;
}

function ConversationLink({ id }: { id: string }) {
  return (
    <Link href={`/call-center/${id}`} className="inline-flex min-h-[36px] items-center text-xs font-medium text-[#1E2D5A] hover:underline">
      Ver conversación →
    </Link>
  );
}

/** Etiqueta del semáforo con el tiempo destacado. Sin configuración no hay semáforo: solo la espera real. */
function WaitBadge({ it, schedule }: { it: NowListItem; schedule: NowPayload["schedule"] }) {
  if (it.level === null || it.businessMinutes === null) {
    return <p className="text-lg font-semibold tabular-nums text-gray-900">{formatWait(it.waitMinutes)}</p>;
  }
  const l = LEVELS[it.level];
  const paused = !schedule?.inPublicHours;
  return (
    <div>
      <p className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${l.chip}`}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${l.dot}`} />
        {l.label}
        {it.level === "FUERA_HORARIO" && schedule?.operatorShiftActive ? " · turno de operadores activo" : ""}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {it.level === "FUERA_HORARIO" ? formatWait(it.waitMinutes) : `${formatWait(it.businessMinutes)} hábiles`}
      </p>
      <p className="text-xs text-gray-600">
        {it.level === "FUERA_HORARIO"
          ? `Espera real del cliente. Reloj hábil pausado en ${formatWait(it.businessMinutes)}.`
          : `Espera real: ${formatWait(it.waitMinutes)}${paused ? " · reloj hábil pausado" : ""}`}
      </p>
    </div>
  );
}

function CaseCard({ it, nowMs, schedule }: { it: NowListItem; nowMs: number; schedule: NowPayload["schedule"] }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <WaitBadge it={it} schedule={schedule} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{ownerLabel(it.owner)}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{it.hasHumanResponse ? "Esperando nueva respuesta" : "Sin primera respuesta"}</span>
      </div>
      <p className="mt-2 text-sm text-gray-900">Espera respuesta desde <span className="font-semibold">{whenLabel(it.waitStart, nowMs)}</span></p>
      <p className="text-xs text-gray-600">La conversación entró {whenLabel(it.createdAt, nowMs)}</p>
      {it.botOrderComplete && !it.hasHumanResponse && <p className="text-sm text-gray-800">Completó el pedido en el bot.</p>}
      {it.thanksCandidate && <p className="text-sm text-gray-500">Puede ser solo un agradecimiento.</p>}
      <div className="mt-1 text-right"><ConversationLink id={it.conversationId} /></div>
    </li>
  );
}

function StaleCard({ d, nowMs }: { d: NowPayload; nowMs: number }) {
  const s = d.stale;
  return (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Para cerrar en Emozion</h2>
        <p className="text-2xl font-semibold tabular-nums text-gray-900">{nf.format(s.total)}</p>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        Abiertas hace más de {d.windowHours} horas. No cuentan como clientes esperando.
        {s.oldestWaitStart ? ` La más vieja: ${dayFmt.format(new Date(s.oldestWaitStart))}.` : ""}
      </p>
      {s.items.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver las {nf.format(s.items.length)}</summary>
          <ul className="mt-1 divide-y divide-amber-200">
            {s.items.map((it) => (
              <li key={it.conversationId} className="flex items-center justify-between gap-2 py-1">
                <span className="text-xs text-gray-700">Espera desde {whenLabel(it.waitStart, nowMs)}</span>
                <ConversationLink id={it.conversationId} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <Evidence level="MEDIDO" />
    </div>
  );
}

function ClosedCard({ d, nowMs }: { d: NowPayload; nowMs: number }) {
  const c = d.closedUnanswered;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">Cerradas sin responder</h2>
        <p className="text-2xl font-semibold tabular-nums text-gray-900">{c ? nf.format(c.total) : "No disponible"}</p>
      </div>
      {c && (
        <>
          <p className="mt-1 text-xs text-gray-600">
            Últimos {c.days} días. Se cerraron sin contestar lo último que escribió el cliente. No incluye agradecimientos ni avisos de que ya compró.
          </p>
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
                      <span className="block text-gray-500">Escribió {whenLabel(it.lastCustomerAt, nowMs)}</span>
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
