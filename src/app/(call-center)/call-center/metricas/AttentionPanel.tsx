"use client";

import { useCallback, useEffect, useState } from "react";
import { EVIDENCE_LABELS, POPULATION_LABELS, effectiveEvidence, indicator, type IndicatorDefinition } from "@/lib/call-center/metrics/indicators";
import type { AttentionPayload } from "@/lib/call-center/metrics/attention-types";
import { PERIOD_MAX_DAYS, addDaysISO, resolvePeriod } from "@/lib/call-center/metrics/period";
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
type Period = { from: string; to: string };
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AttentionPayload };

/** Bloque "Atención y demoras": conversaciones creadas en el período. `today` es el día de Buenos Aires. */
export default function AttentionPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>({ from: addDaysISO(today, -6), to: today });
  const [draft, setDraft] = useState<Period>(period);
  const [formError, setFormError] = useState<string | null>(null);
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

  const apply = (p: Period) => {
    const r = resolvePeriod(p, today);
    if (!r.ok) { setFormError(r.error); return; }
    setFormError(null);
    setDraft({ from: r.from, to: r.to });
    setPeriod({ from: r.from, to: r.to });
  };
  const quick: Array<[string, Period]> = [
    ["Hoy", { from: today, to: today }],
    ["Ayer", { from: addDaysISO(today, -1), to: addDaysISO(today, -1) }],
    ["7 días", { from: addDaysISO(today, -6), to: today }],
    ["30 días", { from: addDaysISO(today, -29), to: today }],
  ];

  return (
    <section className="mt-4" aria-label="Atención y demoras">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); apply(draft); }}
      >
        <label className="text-xs text-gray-600">
          Desde
          <input type="date" value={draft.from} max={today} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="mt-1 block h-11 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900" />
        </label>
        <label className="text-xs text-gray-600">
          Hasta
          <input type="date" value={draft.to} max={today} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="mt-1 block h-11 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900" />
        </label>
        <button type="submit" className="h-11 rounded-md bg-[#1E2D5A] px-4 text-sm font-semibold text-white hover:bg-[#16224a]">Ver</button>
        <div className="flex flex-wrap gap-2">
          {quick.map(([label, p]) => {
            const active = p.from === period.from && p.to === period.to;
            return (
              <button key={label} type="button" onClick={() => apply(p)} aria-pressed={active}
                className={`h-11 rounded-md border px-3 text-xs font-medium ${active ? "border-[#1E2D5A] bg-[#1E2D5A] text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
                {label}
              </button>
            );
          })}
        </div>
      </form>
      {formError && <p role="alert" className="mt-2 text-xs text-red-700">{formError}</p>}
      <p className="mt-2 text-xs text-gray-500">
        Conversaciones que entraron en el período (por fecha de creación, día de Buenos Aires). Hasta {PERIOD_MAX_DAYS} días.
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

/** Las dos poblaciones del bloque, separadas y rotuladas: no se suman ni se comparan entre sí. */
function Report({ data }: { data: AttentionPayload }) {
  return (
    <>
      <p className="mt-4 text-xs text-gray-500">Calculado a las {timeFmt.format(new Date(data.generatedAt))}.</p>

      <SectionTitle title="Por entrada" badge={POPULATION_LABELS.ENTRADA}
        note="Sigue a las conversaciones creadas en el período, hasta su primera respuesta, aunque esa respuesta haya llegado otro día." />
      {data.total.entries === 0
        ? <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">No entró ninguna conversación en el período.</p>
        : <EntryReport data={data} />}

      <SectionTitle title="Por actividad del día" badge={POPULATION_LABELS.ACTIVIDAD}
        note="Cuenta lo que pasó cada día, se haya creado cuando se haya creado la conversación. Es otra población: estos números no se comparan con los de entrada." />
      <ActivityReportView activity={data.activity} />
    </>
  );
}

function SectionTitle({ title, badge, note }: { title: string; badge: string; note: string }) {
  return (
    <div className="mt-8 border-t border-gray-200 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{badge}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </div>
  );
}

function ActivityReportView({ activity }: { activity: AttentionPayload["activity"] }) {
  const f = activity.followups;
  const followupDef = indicator("followup_response");
  if (activity.days.length === 0) {
    return <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">No hubo mensajes de clientes ni de operadores en el período.</p>;
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
          <p className="mt-0.5 text-xs text-gray-500">
            Mediana de reloj · 9 de cada 10 en {formatMinutesOrMissing(f.response.p90)} o menos · sobre {nf.format(f.answered)} bloques respondidos
          </p>
          <p className="text-xs text-gray-500">{nf.format(f.unanswered)} bloques sin respuesta, aparte: el último mensaje de una conversación suele no pedir respuesta</p>
          <p className="mt-1 text-[11px] text-gray-400">{EVIDENCE_LABELS[followupDef.evidence]}</p>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="border-b border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-600">Por día de actividad</caption>
          <thead className="border-b border-gray-200 text-xs text-gray-500">
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
      <p className="mt-1 text-[11px] text-gray-400">
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
            <p className="mt-0.5 text-xs text-gray-500">La más vieja espera desde el {dateTimeFmt.format(new Date(t.pending.oldestClockStart))}</p>
          )}
          {t.pending.total > 0 && (
            <p className="text-xs text-gray-500">
              Mediana de espera: {formatMinutesOrMissing(t.pending.medianAgeMinutes)} · {nf.format(t.pending.thanksCandidates)} candidatos a agradecimiento · {nf.format(t.pending.completedOrders)} con pedido completo
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-400">Medido · no entran en las medianas</p>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BotExitTable summary={t} />
        <ManagementTypeTable summary={t} />
      </div>

      <DaysTable data={data} />

      <h3 className="mt-6 text-sm font-semibold text-gray-800">Entradas por hora</h3>
      <p className="mt-1 text-xs text-gray-500">Hora de Buenos Aires de creación de la conversación, sumando todos los días del período.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-center text-xs tabular-nums">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>{hours.map((_, h) => <th key={h} scope="col" className="px-1.5 py-1.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            <tr>{hours.map((n, h) => <td key={h} className={`px-1.5 py-1.5 ${n === 0 ? "text-gray-300" : "text-gray-900"}`}>{nf.format(n)}</td>)}</tr>
          </tbody>
        </table>
      </div>
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
      {detail && <p className="mt-0.5 text-xs text-gray-500">{detail}</p>}
      {extra && <p className="text-xs text-gray-500">{extra}</p>}
      <p className="mt-1 text-[11px] text-gray-400">{EVIDENCE_LABELS[effectiveEvidence(def, hasConfig)]}</p>
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
              <td className="px-3 py-2 text-xs text-gray-500">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
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
      <p className="mt-1 text-xs text-gray-500">Es una aproximación: indica que la conversación salió del bot, no que una persona la tomó.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-500">
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
      <p className="mt-1 text-[11px] text-gray-400">{EVIDENCE_LABELS[def.evidence]}</p>
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
      <p className="mt-1 text-xs text-gray-500">Se detecta por el recorrido del bot y por el primer mensaje del cliente.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map(([label, n]) => (
              <tr key={label} className="border-b border-gray-100 last:border-0">
                <th scope="row" className="px-3 py-2 font-normal text-gray-700">{label}</th>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{nf.format(n)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-gray-500">{formatRatio(n / summary.entries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">{EVIDENCE_LABELS[def.evidence]}</p>
    </div>
  );
}

function DaysTable({ data }: { data: AttentionPayload }) {
  // Del día más nuevo al más viejo.
  const days = [...data.days].reverse();
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold text-gray-800">Por día de entrada</h3>
      <p className="mt-1 text-xs text-gray-500" title={indicator("pending_at_close").definition}>
        Cada conversación cuenta en el día en que se creó. Las medianas son solo de las respondidas. Pendientes al cierre: de las que salieron del bot en horario público, cuántas no tenían respuesta al cerrar.
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-500">
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
                  {formatShortDay(d.day)}{d.inProgress ? <span className="ml-1 text-xs text-gray-400">en curso</span> : null}
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
