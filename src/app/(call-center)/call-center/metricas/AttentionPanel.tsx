"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_LABELS, POPULATION_LABELS, effectiveEvidence, indicator, type IndicatorDefinition } from "@/lib/call-center/metrics/indicators";
import type { AttentionPayload } from "@/lib/call-center/metrics/attention-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import type { AttentionCaseKind } from "@/lib/call-center/metrics/attention-types";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";
import AttentionCases from "./AttentionCases";
import { DailyCharts, HoursTool, Journey } from "./AttentionCharts";
import { formatMinutes, formatMinutesOrMissing, formatRatio, formatShortDay } from "@/lib/call-center/metrics/format";

const nf = new Intl.NumberFormat("es-AR");
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const cutFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const NO_CONFIG = "No disponible";
const BOT_EXIT_LABELS = {
  PEDIDO_COMPLETO: "Pedido completo en el bot",
  SIN_MENSAJE_FINAL: "Salió sin mensaje final (por tiempo)",
  SIN_REGISTRO: "Sin salida del bot registrada",
} as const;

type Summary = AttentionPayload["total"];
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AttentionPayload };

/** Bloque "Atención y demoras": conversaciones creadas en el período. `today` es el día de Buenos Aires. */
export default function AttentionPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>(defaultPeriod(today));
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (p: Period) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/call-center/metrics/attention?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar las métricas." });
        return;
      }
      setState({ status: "ready", data: body.data as AttentionPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar las métricas. Revisá la conexión." });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  return (
    <section className="mt-4" aria-label="Atención y demoras">
      <PeriodForm today={today} period={period} onChange={setPeriod} />
      <p className="mt-2 text-xs text-gray-600">
        Conversaciones que entraron en el período (por fecha de creación, día de Buenos Aires). Hasta {PERIOD_MAX_DAYS} días.
      </p>

      {state.status === "loading" && <p className="mt-6 text-sm text-gray-600">Cargando…</p>}
      {state.status === "error" && (
        <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}{" "}
          <button type="button" onClick={() => load(period)} className="font-medium underline">Reintentar</button>
        </div>
      )}
      {state.status === "ready" && <Report data={state.data} period={period} />}
    </section>
  );
}

/** Las dos poblaciones del bloque, separadas y rotuladas: no se suman ni se comparan entre sí. */
function Report({ data, period }: { data: AttentionPayload; period: Period }) {
  // Detalle de casos abierto. Se cierra solo al cambiar de período (el informe se vuelve a montar).
  const [cases, setCases] = useState<AttentionCaseKind | null>(null);
  const t = data.total;
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">
        Corte: {cutFmt.format(new Date(data.generatedAt))}. Las conversaciones del período siguen sumando respuestas después de su día de entrada: los números cambian
        hasta que todas estén respondidas.
      </p>
      <SectionTitle title="Por entrada" badge={POPULATION_LABELS.ENTRADA}
        note="Sigue a las conversaciones creadas en el período, hasta su primera respuesta, aunque esa respuesta haya llegado otro día." />
      {data.total.entries === 0
        ? <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">No entró ninguna conversación en el período.</p>
        : (
          <>
            <TopCards total={t} hasConfig={data.hasConfig} cases={cases} onPick={(k) => setCases(cases === k ? null : k)} />
            {cases && <AttentionCases key={cases} kind={cases} period={period} onClose={() => setCases(null)} />}
            <Headline total={data.total} />
            <EntryReport data={data} />
          </>
        )}

      <Fold title="Por actividad del día" hint={POPULATION_LABELS.ACTIVIDAD}>
        <p className="mt-3 text-xs text-gray-600">
          Cuenta lo que pasó cada día, se haya creado cuando se haya creado la conversación. Es otra población: estos números no se comparan con los de entrada.
        </p>
        <ActivityReportView activity={data.activity} />
      </Fold>
    </>
  );
}

/**
 * Las cuatro tarjetas del período: cuánto se cumplió, cuánto se esperó, cuántas siguen
 * esperando y cuántas no tuvieron respuesta el día en que entraron. Cada una abre sus casos.
 */
function TopCards({ total: t, hasConfig, cases, onPick }: { total: Summary; hasConfig: boolean; cases: AttentionCaseKind | null; onPick: (k: AttentionCaseKind) => void }) {
  const goal = t.goal;
  const outside = t.outsidePublicHours.answered;
  const excluded = (goal?.pendingWithin ?? 0) + outside + t.withoutConfig;
  const median = t.firstResponseBusiness;
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TopCard title="Cumplimiento de la meta" active={cases === "goal_missed"} disabled={!goal || goal.compliance === null} onClick={() => onPick("goal_missed")}
          value={goal ? formatRatio(goal.compliance) : hasConfig ? "Sin datos" : NO_CONFIG}
          lines={goal ? [
            `${nf.format(goal.answeredWithin)} de ${nf.format(goal.evaluable)} evaluables · ${nf.format(excluded)} fuera del cálculo`,
            goal.goalMinutes !== null ? `Meta: ${goal.goalMinutes} minutos hábiles desde la salida del bot` : "La meta cambió dentro del período",
          ] : []}
          action="Ver las que no cumplieron" />
        <TopCard title="Primera respuesta: mediana en tiempo hábil" active={cases === "slowest"} disabled={!median || median.n === 0} onClick={() => onPick("slowest")}
          value={median ? formatMinutesOrMissing(median.median) : NO_CONFIG}
          lines={median ? [
            `Entre las ${nf.format(median.n)} respondidas`,
            median.n < 20 ? `Muestra pequeña: ${nf.format(median.n)} ${median.n === 1 ? "caso" : "casos"}` : `El 90% se atendió en ${formatMinutesOrMissing(median.p90)} o menos`,
          ] : []}
          action="Ver las que más esperaron" />
        <TopCard title="Siguen sin primera respuesta" active={cases === "pending"} disabled={t.pending.total === 0} onClick={() => onPick("pending")}
          value={nf.format(t.pending.total)}
          lines={[
            goal ? `${nf.format(goal.pendingOverdue)} con la meta vencida · ${nf.format(goal.pendingWithin)} todavía en plazo` : "Sin configuración no se sabe cuántas tienen la meta vencida",
            `de ${nf.format(t.entries)} que entraron en el período`,
          ]}
          action="Ver los casos" />
        <TopCard title="No recibieron primera respuesta el día de entrada" active={cases === "unanswered_same_day"} disabled={t.unansweredSameDay.total === 0} onClick={() => onPick("unanswered_same_day")}
          value={nf.format(t.unansweredSameDay.total)}
          lines={[
            `${nf.format(t.unansweredSameDay.answeredLater)} se atendieron después`,
            `${nf.format(t.unansweredSameDay.stillPending)} siguen pendientes al corte`,
          ]}
          action="Ver los casos" />
      </div>
      {goal && (
        <details className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
          <summary className="cursor-pointer text-xs font-medium text-[#1E2D5A]">Qué queda fuera del cálculo del cumplimiento ({nf.format(excluded)})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            <li><span className="font-semibold tabular-nums">{nf.format(outside)}</span> respondidas fuera del horario público: la meta pública no aplica.</li>
            <li><span className="font-semibold tabular-nums">{nf.format(goal.pendingWithin)}</span> sin respuesta, todavía dentro del plazo: no se sabe aún si van a cumplir.</li>
            {t.withoutConfig > 0 && <li><span className="font-semibold tabular-nums">{nf.format(t.withoutConfig)}</span> sin configuración vigente el día de entrada.</li>}
          </ul>
          <p className="mt-2 text-xs text-gray-600">
            Evaluables ({nf.format(goal.evaluable)}) más fuera del cálculo ({nf.format(excluded)}) son las {nf.format(t.entries)} entradas del período.
          </p>
          <p className="mt-1 text-xs text-gray-600">
            <span className="mr-1 rounded border border-gray-300 px-1 font-semibold text-gray-700">Estimación</span>
            Sin los posibles agradecimientos el cumplimiento sería {formatRatio(goal.complianceExcludingThanks)}. Se detectan por palabras: no es otro resultado confirmado.
          </p>
        </details>
      )}
      <p className="mt-2 text-xs text-gray-700">Tocá una tarjeta para ver esas conversaciones. Los grupos se superponen: no se suman.</p>
    </>
  );
}

function TopCard({ title, value, lines, action, active, disabled, onClick }: {
  title: string; value: string; lines: string[]; action: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`flex min-h-[132px] flex-col rounded-lg border bg-white p-3 text-left disabled:cursor-default ${active ? "border-[#1E2D5A] ring-2 ring-[#1E2D5A]" : "border-gray-200"}`}>
      <span className="text-xs font-medium leading-tight text-gray-700">{title}</span>
      <span className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</span>
      {lines.map((l) => <span key={l} className="mt-0.5 text-xs leading-snug text-gray-700">{l}</span>)}
      {!disabled && <span className="mt-auto pt-1 text-xs font-medium text-[#1E2D5A]">{action}</span>}
    </button>
  );
}

/**
 * Frase-resumen del período. "Evaluables" son las conversaciones respondidas más las
 * pendientes con la meta ya vencida: las pendientes todavía en plazo no entran.
 */
function Headline({ total }: { total: Summary }) {
  const goal = total.goal;
  const median = total.firstResponseBusiness?.median ?? null;
  if (total.entries === 0) return null;
  const offHours = total.outsidePublicHours.answered > 0 ? (
    <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">
      <span className="font-semibold">Respondidas fuera del horario público: {nf.format(total.outsidePublicHours.answered)}.</span>{" "}
      Salieron del bot con el horario público cerrado (noches, sábados a la tarde, domingos y feriados) y se respondieron antes de que volviera a abrir.
      La meta pública no aplica: no cuentan en el cumplimiento. La mitad esperó <span className="font-semibold">{formatMinutesOrMissing(total.outsidePublicHours.clock.median)}</span> de tiempo real.
    </p>
  ) : null;
  if (!goal || goal.compliance === null) {
    return (
      <>
        {offHours ?? (
          <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-800">
            No se puede decir cuántas conversaciones recibieron respuesta dentro de la meta: en este período no hay configuración vigente o todavía no hay conversaciones evaluables.
          </p>
        )}
        <WindowClosedNote total={total} />
      </>
    );
  }
  return (
    <>
    <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-base text-gray-900">
      El <span className="font-semibold">{formatRatio(goal.compliance)}</span> de las conversaciones evaluables recibió respuesta dentro de la meta
      {goal.goalMinutes !== null ? ` de ${goal.goalMinutes} minutos hábiles` : " vigente cada día (cambió dentro del período)"} desde la salida del bot.
      {median !== null && <> Entre las respondidas, la mitad esperó <span className="font-semibold">{formatMinutes(median)} hábiles</span>.</>}
    </p>
    {offHours}
    <WindowClosedNote total={total} />
    </>
  );
}

/** Ventana de 24 horas de WhatsApp: el hecho histórico (venció alguna vez) separado de la situación actual. */
function WindowClosedNote({ total }: { total: Summary }) {
  const notResumed = total.windowClosed - total.windowClosedAnsweredLater;
  const reopened = notResumed - total.windowClosedNow;
  return (
    <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">
      <span className="font-semibold">En {nf.format(total.windowClosed)} de {nf.format(total.entries)} conversaciones la ventana de WhatsApp venció alguna vez antes de la primera respuesta.</span>{" "}
      Es un hecho del período: en algún momento pasaron 24 horas o más desde un mensaje del cliente sin la primera respuesta de una persona.{" "}
      De esas, <span className="font-semibold">{nf.format(total.windowClosedAnsweredLater)}</span> ya se retomaron y tienen respuesta.{" "}
      <span className="font-semibold">{nf.format(total.windowClosedNow)}</span> siguen sin primera respuesta y tienen la ventana cerrada ahora: para escribirles hace falta una plantilla.
      {reopened > 0 ? <> {nf.format(reopened)} siguen sin respuesta, pero el cliente volvió a escribir y la ventana está abierta de nuevo.</> : null}
      <span className="mt-1 block text-[11px] text-gray-500">{EVIDENCE_LABELS.MEDIDO} · la misma regla de 24 horas que usa &quot;Ahora&quot;</span>
    </p>
  );
}

function SectionTitle({ title, badge, note }: { title: string; badge: string; note: string }) {
  return (
    <div className="mt-8 border-t border-gray-200 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{badge}</span>
      </div>
      <p className="mt-1 text-xs text-gray-600">{note}</p>
    </div>
  );
}

function ActivityReportView({ activity }: { activity: AttentionPayload["activity"] }) {
  const f = activity.followups;
  const followupDef = indicator("followup_response");
  if (activity.days.length === 0) {
    return <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">No hubo mensajes de clientes ni de operadores en el período.</p>;
  }
  const days = [...activity.days].reverse();
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card def={indicator("active_customer")} hasConfig value={nf.format(activity.period.activeCustomer)}
          detail="Conversaciones distintas en el período" extra="No es la suma de los días: una conversación cuenta en cada día en que tuvo actividad" />
        <Card def={indicator("attended")} hasConfig value={nf.format(activity.period.attended)}
          detail="Conversaciones distintas con al menos un mensaje público de operador" />
        <div className="col-span-2 rounded-lg border border-gray-200 bg-white p-3 lg:col-span-1" title={followupDef.definition}>
          <p className="text-xs font-medium text-gray-600">{followupDef.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{formatMinutesOrMissing(f.response.median)}</p>
          <p className="mt-0.5 text-xs text-gray-600">
            Mediana de reloj · 9 de cada 10 en {formatMinutesOrMissing(f.response.p90)} o menos · sobre {nf.format(f.answered)} bloques respondidos
          </p>
          <p className="text-xs text-gray-600">{nf.format(f.unanswered)} bloques sin respuesta, aparte: el último mensaje de una conversación suele no pedir respuesta</p>
          <p className="mt-1 text-[11px] text-gray-500">{EVIDENCE_LABELS[followupDef.evidence]}</p>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="border-b border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-600">Por día de actividad</caption>
          <thead className="border-b border-gray-200 text-xs text-gray-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Día</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Con actividad del cliente</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Atendidas</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Bloques del cliente</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sin respuesta</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Mediana de respuesta posterior</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-b border-gray-100 last:border-0">
                <th scope="row" className="whitespace-nowrap px-3 py-2 font-normal tabular-nums text-gray-700">{formatShortDay(d.day)}</th>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.activeCustomer)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.attended)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.followups.blocks)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.followups.unanswered)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">{formatMinutesOrMissing(d.followups.response.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        Bloque del cliente: mensajes seguidos del cliente después de una respuesta de operador; cuenta en el día en que empezó.
        No se recorren las conversaciones ya resueltas creadas más de {activity.lookbackDays} días antes del período.
      </p>
    </>
  );
}

function EntryReport({ data }: { data: AttentionPayload }) {
  const t = data.total;
  const goal = t.goal;
  return (
    <>
      {!data.hasConfig && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No había una configuración vigente en el período: la meta y el tiempo hábil se muestran como no disponibles.
        </p>
      )}
      {data.hasConfig && t.withoutConfig > 0 && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {nf.format(t.withoutConfig)} {t.withoutConfig === 1 ? "conversación entró" : "conversaciones entraron"} antes de la primera configuración y no {t.withoutConfig === 1 ? "cuenta" : "cuentan"} para la meta ni para el tiempo hábil.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card small def={indicator("entries")} hasConfig={data.hasConfig} value={nf.format(t.entries)}
          detail={`${nf.format(t.answered)} respondidas · ${nf.format(t.pending.total)} sin primera respuesta`} />
        <div className="col-span-2 rounded-lg border border-gray-200 bg-white p-3 lg:col-span-3">
          <p className="text-xs font-medium text-gray-600">De las que siguen sin primera respuesta</p>
          {t.pending.total > 0 ? (
            <p className="mt-1 text-sm text-gray-800">
              {t.pending.oldestClockStart ? <>La más vieja espera desde el {dateTimeFmt.format(new Date(t.pending.oldestClockStart))}. </> : null}
              Mediana de espera: {formatMinutesOrMissing(t.pending.medianAgeMinutes)} · {nf.format(t.pending.completedOrders)} con pedido completo ·{" "}
              {nf.format(t.pending.thanksCandidates)} posibles agradecimientos.
            </p>
          ) : <p className="mt-1 text-sm text-gray-600">Ninguna.</p>}
          <p className="mt-1 text-[11px] text-gray-500">Medido · no entran en las medianas</p>
        </div>
      </div>

      {goal && <GoalGroups goal={goal} outside={t.outsidePublicHours.answered} withoutConfig={t.withoutConfig} entries={t.entries} />}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs font-medium text-gray-600">De las que no tuvieron respuesta el día de entrada</p>
          <p className="mt-1 text-sm text-gray-800">
            {t.unansweredSameDay.enteredInPublicHours !== null ? nf.format(t.unansweredSameDay.enteredInPublicHours) : NO_CONFIG} entraron en horario público ·{" "}
            {nf.format(t.unansweredSameDay.completedOrders)} con pedido completo
          </p>
        </div>
        <Card small def={indicator("late_orders_same_day")} hasConfig={data.hasConfig}
          value={t.lateOrders.total > 0 ? `${nf.format(t.lateOrders.answeredSameDay)} de ${nf.format(t.lateOrders.total)}` : "Sin datos"}
          detail={t.lateOrders.total > 0 ? formatRatio(t.lateOrders.answeredSameDay / t.lateOrders.total) : "No entraron pedidos desde las 17:00"} />
      </div>

      <DailyCharts data={data} />
      <HoursTool groups={data.byHourKind} />
      <Journey data={data} />

      <Fold title="Salida del bot" hint="cómo salieron las conversaciones del bot">
        <BotExitTable summary={t} />
      </Fold>
      <Fold title="Tipo de gestión" hint="pedidos, recetas y otras consultas">
        <ManagementTypeTable summary={t} />
      </Fold>

      <Fold title="Tabla por día de entrada" hint="los números del gráfico diario">
        <DaysTable data={data} />
      </Fold>
    </>
  );
}

/** Detalle plegado: cerrado por defecto, para que la pantalla angosta empiece por lo importante. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="mt-4 rounded-lg border border-gray-200 bg-white">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-gray-800">
        <span>{title}{hint && <span className="ml-2 text-xs font-normal text-gray-600">{hint}</span>}</span>
        <span aria-hidden className="text-xs font-normal text-[#1E2D5A]">Ver</span>
      </summary>
      <div className="border-t border-gray-200 px-3 pb-3">{children}</div>
    </details>
  );
}

function Card({ def, hasConfig, value, detail, extra, small }: {
  def: IndicatorDefinition; hasConfig: boolean; value: string; detail?: string; extra?: string; small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3" title={def.definition}>
      <p className="text-xs font-medium text-gray-600">{def.label}</p>
      <p className={`mt-1 font-semibold tabular-nums text-gray-900 ${small ? "text-xl" : "text-2xl"}`}>{value}</p>
      {detail && <p className="mt-0.5 text-xs text-gray-600">{detail}</p>}
      {extra && <p className="text-xs text-gray-600">{extra}</p>}
      <p className="mt-1 text-[11px] text-gray-500">{EVIDENCE_LABELS[effectiveEvidence(def, hasConfig)]}</p>
    </div>
  );
}

function GoalGroups({ goal, outside, withoutConfig, entries }: { goal: NonNullable<Summary["goal"]>; outside: number; withoutConfig: number; entries: number }) {
  // Las filas suman las entradas del período.
  const rows: Array<[string, number, string]> = [
    ["Respondidas dentro de la meta", goal.answeredWithin, "Cumplen"],
    ["Respondidas fuera de la meta", goal.answeredLate, "No cumplen"],
    ["Sin respuesta, con el plazo vencido", goal.pendingOverdue, "No cumplen"],
    ["Sin respuesta, todavía dentro del plazo", goal.pendingWithin, "No entran en el porcentaje"],
    ["Respondidas fuera del horario público", outside, "No entran en el porcentaje: la meta no aplica"],
    ...(withoutConfig > 0 ? [["Sin configuración vigente el día de entrada", withoutConfig, "No entran en el porcentaje"] as [string, number, string]] : []),
  ];
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white" title={indicator("goal.compliance").definition}>
      <table className="w-full text-left text-sm">
        <caption className="border-b border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-600">Cómo se compone el cumplimiento de la meta</caption>
        <tbody>
          {rows.map(([label, n, note]) => (
            <tr key={label} className="border-b border-gray-100 last:border-0">
              <th scope="row" className="px-3 py-2 font-normal text-gray-700">{label}</th>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">{nf.format(n)}</td>
              <td className="px-3 py-2 text-xs text-gray-600">{note}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-300">
            <th scope="row" className="px-3 py-2 font-semibold text-gray-900">Entradas del período</th>
            <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{nf.format(entries)}</td>
            <td className="px-3 py-2 text-xs text-gray-600">{nf.format(goal.evaluable)} evaluables</td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
        <span className="mr-1 rounded border border-gray-300 px-1 font-semibold text-gray-700">Estimación</span>
        {nf.format(goal.thanksCandidatesOverdue)} de las vencidas son posibles agradecimientos, detectados por palabras
      </p>
    </div>
  );
}

function BotExitTable({ summary }: { summary: Summary }) {
  const def = indicator("bot_time");
  const paths = ["PEDIDO_COMPLETO", "SIN_MENSAJE_FINAL", "SIN_REGISTRO"] as const;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800" title={def.definition}>Salida del bot</h3>
      <p className="mt-1 text-xs text-gray-600">Es una aproximación: indica que la conversación salió del bot, no que una persona la tomó.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Vía</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Conversaciones</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Mediana en el bot</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Respondidas</th>
            </tr>
          </thead>
          <tbody>
            {paths.map((p) => {
              const row = summary.byBotExitPath[p];
              return (
                <tr key={p} className="border-b border-gray-100 last:border-0">
                  <th scope="row" className="px-3 py-2 font-normal text-gray-700">{BOT_EXIT_LABELS[p]}</th>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(row.conversations)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{p === "SIN_REGISTRO" ? "—" : formatMinutesOrMissing(row.botTime.median)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(row.answered)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">{EVIDENCE_LABELS[def.evidence]}</p>
    </div>
  );
}

function ManagementTypeTable({ summary }: { summary: Summary }) {
  const def = indicator("management_type");
  const rows: Array<[string, number]> = [
    ["Pedido por el bot", summary.byManagementType.PEDIDO],
    ["Meducar", summary.byManagementType.MEDUCAR],
    ["Otros", summary.byManagementType.OTROS],
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800" title={def.definition}>{def.label}</h3>
      <p className="mt-1 text-xs text-gray-600">Se detecta por el recorrido del bot y por el primer mensaje del cliente.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map(([label, n]) => (
              <tr key={label} className="border-b border-gray-100 last:border-0">
                <th scope="row" className="px-3 py-2 font-normal text-gray-700">{label}</th>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(n)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-gray-600">{formatRatio(n / summary.entries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">{EVIDENCE_LABELS[def.evidence]}</p>
    </div>
  );
}

function DaysTable({ data }: { data: AttentionPayload }) {
  // Del día más nuevo al más viejo.
  const days = [...data.days].reverse();
  return (
    <>
      <p className="mt-3 text-xs text-gray-600" title={indicator("pending_at_close").definition}>
        Cada conversación cuenta en el día en que se creó. Las medianas son solo de las respondidas. Pendientes al cierre: de las que salieron del bot en horario público, cuántas no tenían respuesta al cerrar.
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Día</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Entradas</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Respondidas</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sin respuesta</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cumplimiento</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Mediana hábil</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Mediana de reloj</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Pendientes al cierre</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-b border-gray-100 last:border-0">
                <th scope="row" className="whitespace-nowrap px-3 py-2 font-normal tabular-nums text-gray-700">
                  {formatShortDay(d.day)}{d.inProgress ? <span className="ml-1 text-xs text-gray-500">parcial</span> : null}
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.entries)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.answered)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.pending.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{d.goal ? formatRatio(d.goal.compliance, "Sin evaluables") : d.kind === "SIN_HORARIO" || d.outsidePublicHours.answered > 0 ? "No aplica: sin horario público" : NO_CONFIG}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">{d.firstResponseBusiness ? formatMinutesOrMissing(d.firstResponseBusiness.median, "Sin respondidas") : d.kind === "SIN_HORARIO" || d.outsidePublicHours.answered > 0 ? "No aplica: sin horario público" : NO_CONFIG}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">{d.firstResponseClock.median !== null ? formatMinutes(d.firstResponseClock.median) : "Sin respondidas"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                  {d.pendingAtClose ? `${nf.format(d.pendingAtClose.pending)} de ${nf.format(d.pendingAtClose.leftBotInHours)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
