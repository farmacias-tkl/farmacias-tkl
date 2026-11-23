"use client";

import { useState, type ReactNode } from "react";
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
  o.kind === "SYSTEM" ? "Asignación automática" : o.kind === "ACCOUNT" ? `Asignada a ${o.label}` : "Sin responsable identificado";

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

type CaseFilter = "all" | "urgent" | "insisting" | "closing" | "closed" | "critical" | "orders" | "longest";

/** "3 h 20 min" o "45 min" que faltan para que se cierre la ventana de WhatsApp. */
function windowLeftLabel(lastCustomerAt: string, nowMs: number, hours: number): string {
  const left = Math.max(0, Math.floor((new Date(lastCustomerAt).getTime() + hours * 3_600_000 - nowMs) / 60_000));
  const h = Math.floor(left / 60);
  return h > 0 ? `${h} h ${left % 60} min` : `${left} min`;
}

const FILTER_LABELS: Record<Exclude<CaseFilter, "all">, string> = {
  urgent: "clientes urgentes",
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
  const shown =
    filter === "urgent" ? d.list.filter((it) => it.alert === "URGENTE")
    : filter === "insisting" ? d.list.filter((it) => it.alert === "INSISTIENDO")
    : filter === "closing" ? d.list.filter((it) => it.window === "POR_VENCER").sort((a, b) => (a.lastCustomerAt < b.lastCustomerAt ? -1 : 1))
    : filter === "closed" ? d.list.filter((it) => it.window === "CERRADA")
    : filter === "critical" ? d.list.filter((it) => it.level === "CRITICO")
    : filter === "orders" ? d.list.filter((it) => it.botOrderComplete && !it.hasHumanResponse)
    : filter === "longest" ? d.list.slice(0, 1)
    : d.list;

  return (
    <section className="mt-4" aria-label="Ahora">
      <p className="text-xs text-gray-600">
        Actualizado a las {timeFmt.format(new Date(d.generatedAt))} · últimas {d.windowHours} horas{refreshing ? " · actualizando…" : ""}
      </p>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-800">Requiere acción</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ActionButton label="Cliente urgente" value={nf.format(w.urgent)} tone={w.urgent ? "critical" : "plain"}
            active={filter === "urgent"} onClick={() => toggle("urgent")} />
          <ActionButton label="Cliente insistiendo" value={nf.format(w.insisting)} tone={w.insisting ? "warning" : "plain"}
            active={filter === "insisting"} onClick={() => toggle("insisting")} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ActionButton label={`Ventana de WhatsApp por vencer (menos de ${d.window.warningHours} h)`} value={nf.format(d.window.closing)} tone={d.window.closing ? "warning" : "plain"}
            active={filter === "closing"} onClick={() => toggle("closing")} />
          <ActionButton label="Ventana de WhatsApp cerrada · requiere plantilla" value={nf.format(d.window.closed)} tone="plain"
            active={filter === "closed"} onClick={() => toggle("closed")} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <ActionButton label="En demora crítica" value={w.critical === null ? "—" : nf.format(w.critical)} tone={w.critical ? "critical" : "plain"}
            active={filter === "critical"} disabled={w.critical === null} onClick={() => toggle("critical")} />
          <ActionButton label="Pedidos completos sin primera respuesta" value={nf.format(w.completedOrders)} tone="plain"
            active={filter === "orders"} onClick={() => toggle("orders")} />
          <ActionButton label="Mayor espera" value={w.oldestWaitStart ? formatWait(minutesSince(w.oldestWaitStart, nowMs)) : "—"} tone="plain"
            active={filter === "longest"} disabled={!w.oldestWaitStart} onClick={() => toggle("longest")} />
        </div>
        <p className="mt-2 text-xs text-gray-700">
          Tocá un número para ver esos casos.
          {w.critical === null ? " Sin configuración cargada no se puede marcar la demora crítica." : ""}
        </p>
        <More>
          Cliente urgente: en mensajes que todavía no tuvieron respuesta de un operador, pide urgencia o avisa que se va a otro lado. Cliente insistiendo: después de
          completar el bot escribió 2 mensajes o más, separados por más de 10 minutos, y sigue sin respuesta. Los dos dejan de mostrarse cuando un operador responde.
          {" "}Ventana de WhatsApp: desde el último mensaje del cliente hay {d.window.hours} horas de reloj para responder libremente, también de noche, los fines de semana y
          los feriados. Pasado ese plazo la conversación solo se reabre con una plantilla aprobada. &quot;Por vencer&quot; son las que todavía se pueden responder y les
          quedan menos de {d.window.warningHours} horas. La ventana es independiente del semáforo, que mide minutos hábiles.
          {" "}Los grupos se superponen y no se suman: un pedido completo puede estar además en demora crítica.
          {d.schedule ? ` En plazo es hasta ${d.schedule.goalMinutes} minutos hábiles de espera, demorado hasta ${d.schedule.criticalMinutes} y crítico más de ${d.schedule.criticalMinutes}.` : ""}
          {" "}Los minutos hábiles corren solo dentro del horario público; fuera de ese horario el reloj se pausa y el caso conserva su color. Además es crítico todo caso
          con la ventana de WhatsApp cerrada: {d.window.hours} horas o más de espera real desde el último mensaje del cliente, sume lo que sume el reloj hábil.
        </More>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Conversaciones esperando respuesta</h2>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-gray-900">
          <span className="text-4xl font-semibold tabular-nums">{nf.format(w.total)}</span>
          <span className="text-sm">en las últimas {d.windowHours} h</span>
          <span className="text-2xl font-semibold tabular-nums">+ {nf.format(d.stale.total)}</span>
          <span className="text-sm">antiguas por revisar</span>
        </p>
        <p className="mt-1 text-sm text-gray-700">
          {w.oldestWaitStart ? <>La que más espera: <span className="font-semibold">{formatWait(minutesSince(w.oldestWaitStart, nowMs))}</span></> : "No hay ninguna esperando en las últimas horas."}
        </p>
        {w.total > 0 && (
          <p className="mt-2 text-xs text-gray-600">
            {nf.format(w.neverHuman)} esperan la primera respuesta · {nf.format(w.awaitingNext)} esperan la siguiente
          </p>
        )}
        <Evidence level="MEDIDO" />
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
          <Evidence level={d.today ? "MEDIDO" : "NO_DISPONIBLE"} />
        </div>
      </div>

      <ProgressCard d={d} />

      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        Casos{d.listTotal > 0 ? ` (${nf.format(filter === "all" ? d.listTotal : shown.length)})` : ""}
        <span className="ml-2 text-xs font-normal text-gray-600">primero los de ventana cerrada, después del que más espera al que menos</span>
      </h2>
      {filter !== "all" && (
        <p className="mt-1 text-xs text-gray-700">
          Mostrando solo {FILTER_LABELS[filter]}.{" "}
          <button type="button" onClick={() => setFilter("all")} className="font-medium text-[#1E2D5A] underline">Ver todos</button>
        </p>
      )}
      {d.listTotal > d.list.length && (
        <p className="mt-1 text-xs text-gray-600">Se muestran los {nf.format(d.list.length)} que más esperan.</p>
      )}
      {shown.length === 0 ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">
          {filter === "all" ? "No hay nadie esperando una respuesta." : "Ningún caso en este grupo."}
        </p>
      ) : (
        <ul className="mt-2 grid gap-2 lg:grid-cols-2">
          {shown.map((it) => <CaseCard key={it.conversationId} it={it} nowMs={nowMs} schedule={d.schedule} windowHours={d.window.hours} />)}
        </ul>
      )}

      <StaleCard d={d} nowMs={nowMs} />
      <ClosedCard d={d} nowMs={nowMs} />
    </section>
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

/** Flecha de avance: verde si mejora, naranja con la palabra "Peor" si empeora, gris solo si no cambia. */
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
        <p className="mt-1 text-sm text-gray-600">Sin datos: el turno de hoy todavía no empezó, o hoy no hay turno.</p>
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
                <dt>La mitad esperó (tiempo real)</dt>
                <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{mins(today.medianClockMinutes)} <span className="font-normal text-gray-600">· antes {mins(previous.medianClockMinutes)}</span></dd>
              </div>
              {today.medianClockMinutes !== null && previous.medianClockMinutes !== null && (
                <Trend better={today.medianClockMinutes < previous.medianClockMinutes} same={mins(today.medianClockMinutes) === mins(previous.medianClockMinutes)}
                  text={formatWait(Math.abs(today.medianClockMinutes - previous.medianClockMinutes))} />
              )}
            </div>
          </dl>
        </>
      ) : (
      <dl className="mt-1 space-y-2 text-sm text-gray-800">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>Respondidas dentro de la meta</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{pct(today.compliance)} <span className="font-normal text-gray-600">· antes {pct(previous.compliance)}</span></dd>
            </div>
            {today.compliance !== null && previous.compliance !== null && (
              <Trend better={today.compliance > previous.compliance} same={pct(today.compliance) === pct(previous.compliance)}
                text={`${Math.abs(Math.round((today.compliance - previous.compliance) * 100))} puntos`} />
            )}
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>La mitad esperó (minutos hábiles)</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-gray-900">{mins(today.medianBusinessMinutes)} <span className="font-normal text-gray-600">· antes {mins(previous.medianBusinessMinutes)}</span></dd>
            </div>
            {today.medianBusinessMinutes !== null && previous.medianBusinessMinutes !== null && (
              <Trend better={today.medianBusinessMinutes < previous.medianBusinessMinutes} same={mins(today.medianBusinessMinutes) === mins(previous.medianBusinessMinutes)}
                text={formatWait(Math.abs(today.medianBusinessMinutes - previous.medianBusinessMinutes))} />
            )}
          </div>
        </dl>
      )}
      <h3 className="mt-3 border-t border-gray-100 pt-2 text-xs font-semibold text-gray-700">Ventana de WhatsApp</h3>
      {p.windowClosed ? (
        <div className="mt-1 text-sm text-gray-800">
          <div className="flex items-baseline justify-between gap-3">
            <span>Conversaciones cuya ventana se cerró sin respuesta, hoy</span>
            <span className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(p.windowClosed.today)} <span className="font-normal text-gray-600">· antes {nf.format(p.windowClosed.previous)}</span></span>
          </div>
          <Trend better={p.windowClosed.today < p.windowClosed.previous} same={p.windowClosed.today === p.windowClosed.previous}
            text={`${nf.format(Math.abs(p.windowClosed.today - p.windowClosed.previous))} ${p.windowClosed.today < p.windowClosed.previous ? "menos" : "más"}`} />
        </div>
      ) : (
        <p className="mt-1 text-sm text-gray-600">No disponible</p>
      )}
      <More>
        Ventana cerrada sin respuesta: pasaron {d.window.hours} horas de reloj desde el último mensaje del cliente sin la primera respuesta de una persona. Cuenta las
        ventanas que se cerraron hoy, hayan entrado cuando hayan entrado, contra las del mismo día de la semana pasada hasta esta misma hora.
        {" "}Pendientes al empezar el turno: conversaciones abiertas, con el último mensaje del cliente y hasta {d.windowHours} horas de espera, a la hora en que empieza el
        horario de operadores. La comparación toma lo que había entrado y lo que se había respondido el mismo día de la semana pasada a esta misma hora
        ({nf.format(today.entries)} entradas hoy, {nf.format(previous.entries)} ese día). &quot;Sin datos&quot; quiere decir que no hay con qué calcularlo, no que sea cero.
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
  if (it.level === null) {
    return <p className="text-base font-semibold tabular-nums text-gray-900">{formatWait(it.waitMinutes)}</p>;
  }
  const l = LEVELS[it.level];
  const paused = schedule !== null && !schedule.inPublicHours;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${l.chip}`}>
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${l.dot}`} />
        {l.label}
      </span>
      <span className="text-base font-semibold tabular-nums text-gray-900">
        {it.businessMinutes === null || it.window === "CERRADA" ? `${formatWait(it.waitMinutes)} reales` : `${formatWait(it.businessMinutes)} hábiles`}
      </span>
      {paused && (
        <span className="basis-full text-xs text-gray-700">
          Fuera del horario público · reloj hábil pausado{schedule?.operatorShiftActive ? " · turno de operadores activo" : ""}
        </span>
      )}
    </p>
  );
}

/** Tarjeta compacta: semáforo y tiempo, las dos etiquetas, desde cuándo espera y el enlace. */
function CaseCard({ it, nowMs, schedule, windowHours }: { it: NowListItem; nowMs: number; schedule: NowPayload["schedule"]; windowHours: number }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <WaitBadge it={it} schedule={schedule} />
        <ConversationLink id={it.conversationId} />
      </div>
      <p className="mt-1 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{ownerLabel(it.owner)}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{it.hasHumanResponse ? "Esperando nueva respuesta" : "Sin primera respuesta"}</span>
        {it.botOrderComplete && !it.hasHumanResponse && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">Pedido completo</span>}
      </p>
      {it.alert === "URGENTE" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900">Urgente · el cliente pide urgencia o avisa que se va</span></p>
      )}
      {it.alert === "INSISTIENDO" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-900">Insistiendo · volvió a escribir sin respuesta</span></p>
      )}
      {it.window === "CERRADA" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-gray-400 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-900">Ventana de WhatsApp cerrada · requiere plantilla</span></p>
      )}
      {it.window === "POR_VENCER" && (
        <p className="mt-1"><span className="inline-block rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-900">Ventana vence en {windowLeftLabel(it.lastCustomerAt, nowMs, windowHours)}</span></p>
      )}
      <p className="mt-1 text-xs text-gray-700">
        Espera respuesta desde <span className="font-semibold text-gray-900">{whenLabel(it.waitStart, nowMs)}</span>
        {" "}· espera real <span className="font-semibold text-gray-900">{formatWait(it.waitMinutes)}</span>
        {it.businessMinutes !== null ? ` · ${formatWait(it.businessMinutes)} hábiles` : ""}
        {it.thanksCandidate ? " · puede ser solo un agradecimiento" : ""}
      </p>
      <p className="text-xs text-gray-600">
        Último mensaje del cliente {whenLabel(it.lastCustomerAt, nowMs)}
        {it.window === "ABIERTA" ? ` · ventana de WhatsApp abierta, quedan ${windowLeftLabel(it.lastCustomerAt, nowMs, windowHours)}` : ""}
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
          <StaleGroup title="Siguen pendientes" count={s.pending!} note="El último mensaje del cliente no es un cierre, o trae una consulta, un pedido o un adjunto." items={pending} nowMs={nowMs} />
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
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
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
