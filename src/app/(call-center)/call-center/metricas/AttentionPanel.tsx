"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_LABELS, POPULATION_LABELS, effectiveEvidence, indicator, type IndicatorDefinition } from "@/lib/call-center/metrics/indicators";
import type { AttentionPayload } from "@/lib/call-center/metrics/attention-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";
import { formatMinutes, formatMinutesOrMissing, formatRatio, formatShortDay } from "@/lib/call-center/metrics/format";

const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

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
      {state.status === "ready" && <Report data={state.data} />}
    </section>
  );
}

/** Las dos poblaciones del bloque, separadas y rotuladas: no se suman ni se comparan entre sí. */
function Report({ data }: { data: AttentionPayload }) {
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">Calculado a las {timeFmt.format(new Date(data.generatedAt))}.</p>
      <Headline total={data.total} />

      <SectionTitle title="Por entrada" badge={POPULATION_LABELS.ENTRADA}
        note="Sigue a las conversaciones creadas en el período, hasta su primera respuesta, aunque esa respuesta haya llegado otro día." />
      {data.total.entries === 0
        ? <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">No entró ninguna conversación en el período.</p>
        : <EntryReport data={data} />}

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
 * Frase-resumen del período. "Evaluables" son las conversaciones respondidas más las
 * pendientes con la meta ya vencida: las pendientes todavía en plazo no entran.
 */
function Headline({ total }: { total: Summary }) {
  const goal = total.goal;
  const median = total.firstResponseBusiness?.median ?? null;
  if (total.entries === 0) return null;
  if (!goal || goal.compliance === null) {
    return (
      <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-800">
        No se puede decir cuántas conversaciones recibieron respuesta dentro de la meta: en este período no hay configuración vigente o todavía no hay conversaciones evaluables.
      </p>
    );
  }
  return (
    <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-base text-gray-900">
      El <span className="font-semibold">{formatRatio(goal.compliance)}</span> de las conversaciones evaluables recibió respuesta dentro de la meta
      {goal.goalMinutes !== null ? ` de ${goal.goalMinutes} minutos hábiles` : " vigente cada día (cambió dentro del período)"} desde la salida del bot.
      {median !== null && <> Entre las respondidas, la mitad esperó <span className="font-semibold">{formatMinutes(median)} hábiles</span>.</>}
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
  const hours = new Array<number>(24).fill(0);
  for (const d of data.days) d.byHour.forEach((n, h) => { hours[h] += n; });

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
        <Card def={indicator("entries")} hasConfig={data.hasConfig} value={nf.format(t.entries)}
          detail={`${nf.format(t.answered)} respondidas · ${nf.format(t.pending.total)} sin primera respuesta`} />
        <Card def={indicator("goal.compliance")} hasConfig={data.hasConfig} value={goal ? formatRatio(goal.compliance) : NO_CONFIG}
          detail={goal ? (goal.goalMinutes !== null ? `Meta: ${goal.goalMinutes} minutos hábiles desde la salida del bot` : "La meta cambió dentro del período") : undefined}
          extra={goal ? `Sin los candidatos a agradecimiento: ${formatRatio(goal.complianceExcludingThanks)}` : undefined} />
        <Card def={indicator("first_response.business")} hasConfig={data.hasConfig}
          value={t.firstResponseBusiness ? formatMinutesOrMissing(t.firstResponseBusiness.median) : NO_CONFIG}
          detail={t.firstResponseBusiness ? `Mediana · 9 de cada 10 en ${formatMinutesOrMissing(t.firstResponseBusiness.p90)} o menos` : undefined}
          extra={t.firstResponseBusiness ? `Sobre ${nf.format(t.firstResponseBusiness.n)} respondidas` : undefined} />
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs font-medium text-gray-600">Sin primera respuesta</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{nf.format(t.pending.total)}</p>
          {t.pending.oldestClockStart && (
            <p className="mt-0.5 text-xs text-gray-600">La más vieja espera desde el {dateTimeFmt.format(new Date(t.pending.oldestClockStart))}</p>
          )}
          {t.pending.total > 0 && (
            <p className="text-xs text-gray-600">
              Mediana de espera: {formatMinutesOrMissing(t.pending.medianAgeMinutes)} · {nf.format(t.pending.thanksCandidates)} candidatos a agradecimiento · {nf.format(t.pending.completedOrders)} con pedido completo
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-500">Medido · no entran en las medianas</p>
        </div>
      </div>

      {goal && <GoalGroups goal={goal} />}

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card small def={indicator("first_response.clock")} hasConfig={data.hasConfig} value={formatMinutesOrMissing(t.firstResponseClock.median)}
          detail={`Mediana · 9 de cada 10 en ${formatMinutesOrMissing(t.firstResponseClock.p90)} o menos`}
          extra={`Sobre ${nf.format(t.firstResponseClock.n)} respondidas`} />
        <Card small def={indicator("first_response.from_first_message")} hasConfig={data.hasConfig} value={formatMinutesOrMissing(t.fromFirstMessage.median)}
          detail={`Mediana · 9 de cada 10 en ${formatMinutesOrMissing(t.fromFirstMessage.p90)} o menos`}
          extra="Incluye el tiempo en el bot" />
        <Card small def={indicator("unanswered_same_day")} hasConfig={data.hasConfig} value={nf.format(t.unansweredSameDay.total)}
          detail={`${t.unansweredSameDay.enteredInPublicHours !== null ? nf.format(t.unansweredSameDay.enteredInPublicHours) : NO_CONFIG} entraron en horario público`}
          extra={`${nf.format(t.unansweredSameDay.completedOrders)} con pedido completo`} />
        <Card small def={indicator("late_orders_same_day")} hasConfig={data.hasConfig}
          value={t.lateOrders.total > 0 ? `${nf.format(t.lateOrders.answeredSameDay)} de ${nf.format(t.lateOrders.total)}` : "Sin datos"}
          detail={t.lateOrders.total > 0 ? formatRatio(t.lateOrders.answeredSameDay / t.lateOrders.total) : "No entraron pedidos desde las 17:00"} />
      </div>

      <Fold title="Salida del bot" hint="cómo salieron las conversaciones del bot">
        <BotExitTable summary={t} />
      </Fold>
      <Fold title="Tipo de gestión" hint="pedidos, recetas y otras consultas">
        <ManagementTypeTable summary={t} />
      </Fold>

      <DaysTable data={data} />

      <HoursChart hours={hours} />
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

/**
 * Entradas por hora: una sola serie, barras verticales. Alto fijo y ancho repartido entre
 * las 24 horas, así entra en una pantalla angosta sin desplazamiento. Se rotula solo la
 * hora pico; el resto se lee al tocar la barra o en la tabla plegada.
 */
function HoursChart({ hours }: { hours: number[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(...hours);
  const peak = hours.indexOf(max);
  const shown = picked ?? peak;
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold text-gray-800">Entradas por hora</h3>
      <p className="mt-1 text-xs text-gray-600">Hora de Buenos Aires en que entró la conversación, sumando todos los días del período.</p>
      {max === 0 ? (
        <p className="mt-2 text-sm text-gray-600">Sin entradas en el período.</p>
      ) : (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-sm text-gray-900" aria-live="polite">
            <span className="font-semibold tabular-nums">{nf.format(hours[shown])}</span> entre las {shown} y las {shown + 1} h
            {shown === peak ? <span className="text-gray-600"> · la hora con más entradas</span> : null}
          </p>
          <div className="mt-2 flex h-32 items-end gap-[2px] border-b border-gray-300" role="group" aria-label="Entradas por hora">
            {hours.map((n, h) => (
              <button key={h} type="button" title={`${h} a ${h + 1} h: ${nf.format(n)}`} aria-label={`${h} a ${h + 1} horas: ${nf.format(n)} entradas`}
                onClick={() => setPicked(h)} onMouseEnter={() => setPicked(h)} onFocus={() => setPicked(h)}
                className="flex h-full min-w-0 flex-1 items-end">
                <span className={`block w-full rounded-t-[4px] ${h === shown ? "bg-[#1E2D5A]" : "bg-[#8E9BC4]"}`}
                  style={{ height: n === 0 ? "0" : `${Math.max(3, (n / max) * 100)}%` }} />
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] text-[10px] tabular-nums text-gray-600" aria-hidden>
            {hours.map((_, h) => <span key={h} className="min-w-0 flex-1 text-center">{h % 3 === 0 ? h : ""}</span>)}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver los números</summary>
            <ul className="mt-1 grid grid-cols-3 gap-x-4 text-xs tabular-nums text-gray-800 sm:grid-cols-6">
              {hours.map((n, h) => <li key={h} className="flex justify-between gap-2"><span className="text-gray-600">{h} h</span><span>{nf.format(n)}</span></li>)}
            </ul>
          </details>
        </div>
      )}
    </>
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

function GoalGroups({ goal }: { goal: NonNullable<Summary["goal"]> }) {
  const rows: Array<[string, number, string]> = [
    ["Respondidas dentro de la meta", goal.answeredWithin, "Cumplen"],
    ["Respondidas fuera de la meta", goal.answeredLate, "No cumplen"],
    ["Sin respuesta, con el plazo vencido", goal.pendingOverdue, "No cumplen"],
    ["Sin respuesta, todavía dentro del plazo", goal.pendingWithin, "No entran en el porcentaje"],
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
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
        {nf.format(goal.thanksCandidatesOverdue)} de las vencidas son candidatos a agradecimiento · {nf.format(goal.answeredBeforeOpening)} se respondieron antes de abrir o sin consumir tiempo hábil
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
      <h3 className="mt-6 text-sm font-semibold text-gray-800">Por día de entrada</h3>
      <p className="mt-1 text-xs text-gray-600" title={indicator("pending_at_close").definition}>
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
                  {formatShortDay(d.day)}{d.inProgress ? <span className="ml-1 text-xs text-gray-500">en curso</span> : null}
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.entries)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.answered)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(d.pending.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{d.goal ? formatRatio(d.goal.compliance) : NO_CONFIG}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">{d.firstResponseBusiness ? formatMinutesOrMissing(d.firstResponseBusiness.median) : NO_CONFIG}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">{d.firstResponseClock.median !== null ? formatMinutes(d.firstResponseClock.median) : "Sin datos"}</td>
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
