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
    filter === "critical" ? d.list.filter((it) => it.level === "CRITICO")
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
          Los tres grupos se superponen y no se suman: un pedido completo puede estar además en demora crítica.
          {d.schedule ? ` En plazo es hasta ${d.schedule.goalMinutes} minutos hábiles de espera, demorado hasta ${d.schedule.criticalMinutes} y crítico más de ${d.schedule.criticalMinutes}.` : ""}
          {" "}Los minutos hábiles corren solo dentro del horario público; fuera de ese horario el reloj se pausa y el caso no se muestra en plazo.
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
                <dt>Entraron hoy y ya recibieron respuesta</dt>
                <dd className="shrink-0 text-xl font-semibold tabular-nums text-gray-900">{nf.format(d.today.answered)} de {nf.format(d.today.entered)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Conversaciones atendidas hoy<span className="block text-xs text-gray-600">Incluye las que venían de días anteriores.</span></dt>
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
        <span className="ml-2 text-xs font-normal text-gray-600">del que más espera al que menos</span>
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
            <dt>Atrasados atendidos durante el turno</dt>
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
      <More>
        Pendientes al empezar el turno: conversaciones abiertas, con el último mensaje del cliente y hasta {d.windowHours} horas de espera, a la hora en que empieza el
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
  if (it.level === null || it.businessMinutes === null) {
    return <p className="text-base font-semibold tabular-nums text-gray-900">{formatWait(it.waitMinutes)}</p>;
  }
  const l = LEVELS[it.level];
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${l.chip}`}>
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${l.dot}`} />
        {l.label}
        {it.level === "FUERA_HORARIO" && schedule?.operatorShiftActive ? " · turno de operadores activo" : ""}
      </span>
      <span className="text-base font-semibold tabular-nums text-gray-900">
        {it.level === "FUERA_HORARIO" ? formatWait(it.waitMinutes) : `${formatWait(it.businessMinutes)} hábiles`}
      </span>
    </p>
  );
}

/** Tarjeta compacta: semáforo y tiempo, las dos etiquetas, desde cuándo espera y el enlace. */
function CaseCard({ it, nowMs, schedule }: { it: NowListItem; nowMs: number; schedule: NowPayload["schedule"] }) {
  const paused = it.level !== null && !schedule?.inPublicHours;
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
      <p className="mt-1 text-xs text-gray-700">
        Espera respuesta desde <span className="font-semibold text-gray-900">{whenLabel(it.waitStart, nowMs)}</span>
        {it.level !== null && it.level !== "FUERA_HORARIO" ? ` · espera real ${formatWait(it.waitMinutes)}` : ""}
        {paused ? ` · reloj hábil pausado${it.level === "FUERA_HORARIO" && it.businessMinutes ? ` en ${formatWait(it.businessMinutes)}` : ""}` : ""}
        {it.thanksCandidate ? " · puede ser solo un agradecimiento" : ""}
      </p>
      <p className="text-xs text-gray-600">La conversación entró {whenLabel(it.createdAt, nowMs)}</p>
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
            <span className="text-xs text-gray-800">Espera desde {whenLabel(it.waitStart, nowMs)}</span>
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
          <p className="mt-1 text-xs text-gray-700">Últimos {c.days} días.</p>
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
                      <span className="block text-gray-600">Escribió {whenLabel(it.lastCustomerAt, nowMs)}</span>
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
