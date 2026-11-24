"use client";

import { useState } from "react";
import type { AttentionPayload } from "@/lib/call-center/metrics/attention-types";
import { COMPARISON_MIN_ANSWERED } from "@/lib/call-center/metrics/comparison";
import { formatMinutes, formatMinutesOrMissing, formatRatio, formatShortDay } from "@/lib/call-center/metrics/format";

const nf = new Intl.NumberFormat("es-AR");
const weekdayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" });

type Day = AttentionPayload["days"][number];
type Kind = AttentionPayload["calendar"][number]["kind"];

const KIND_LABELS: Record<Kind, string> = {
  LABORABLE: "Días laborables",
  SABADO: "Sábados",
  SIN_HORARIO: "Días sin horario público",
  SIN_CONFIG: "Días sin configuración",
};

const dayLabel = (day: string) => `${weekdayFmt.format(new Date(`${day}T12:00:00.000Z`))} ${formatShortDay(day)}`;
const cases = (n: number) => `${nf.format(n)} ${n === 1 ? "caso" : "casos"}`;

/** Escala vertical: el valor de arriba, la mitad y cero. */
function Scale({ top, format }: { top: number; format: (v: number) => string }) {
  return (
    <div className="flex w-14 shrink-0 flex-col justify-between pr-1 text-right text-[10px] tabular-nums leading-none text-gray-600" aria-hidden>
      <span>{format(top)}</span>
      <span>{format(top / 2)}</span>
      <span>0</span>
    </div>
  );
}

/** Rótulos del eje de días: pocos, para que entren en una pantalla angosta. */
function DayAxis({ days }: { days: string[] }) {
  const step = Math.max(1, Math.ceil(days.length / 6));
  return (
    <div className="ml-14 mt-1 flex gap-[2px] text-[10px] tabular-nums text-gray-600" aria-hidden>
      {days.map((d, i) => (
        <span key={d} className="relative min-w-0 flex-1">
          {i % step === 0 ? <span className="absolute left-0 whitespace-nowrap">{formatShortDay(d)}</span> : null}
        </span>
      ))}
    </div>
  );
}

/**
 * Evolución diaria, por día de entrada. Dos gráficos con el mismo eje de días y escalas
 * separadas: tiempos (minutos hábiles) y cumplimiento (porcentaje). No se mezclan en una escala.
 */
export function DailyCharts({ data }: { data: AttentionPayload }) {
  const byDay = new Map<string, Day>(data.days.map((d) => [d.day, d]));
  const calendar = data.calendar;
  const lastWithData = [...calendar].reverse().find((c) => byDay.has(c.day))?.day ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  if (calendar.length === 0) return null;
  const shown = picked ?? lastWithData ?? calendar[calendar.length - 1].day;

  // Con menos respondidas que el umbral, el 90% no se dibuja: describe muy pocos casos.
  const p90Of = (d: Day | undefined) => (d?.firstResponseBusiness && d.firstResponseBusiness.n >= COMPARISON_MIN_ANSWERED ? d.firstResponseBusiness.p90 : null);
  const medianOf = (d: Day | undefined) => (d?.firstResponseBusiness && d.firstResponseBusiness.n > 0 ? d.firstResponseBusiness.median : null);
  const top = Math.max(1, ...calendar.map((c) => Math.max(medianOf(byDay.get(c.day)) ?? 0, p90Of(byDay.get(c.day)) ?? 0)));
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;

  const s = byDay.get(shown);
  const kind = calendar.find((c) => c.day === shown)?.kind ?? "SIN_CONFIG";
  const pick = (day: string) => ({ onClick: () => setPicked(day), onMouseEnter: () => setPicked(day), onFocus: () => setPicked(day) });

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-800">Evolución por día de entrada</h3>
      <p className="mt-1 text-xs text-gray-600">
        Cada conversación cuenta en el día en que entró. Los tiempos son de las respondidas; las pendientes van aparte. Tocá un día para ver sus números.
      </p>
      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
        <p className="min-h-[60px] text-sm text-gray-900" aria-live="polite">
          <span className="font-semibold capitalize">{dayLabel(shown)}</span>
          {s?.inProgress ? <span className="ml-1 rounded border border-gray-300 px-1 text-[11px] font-medium text-gray-700">Parcial: el día sigue en curso</span> : null}
          <span className="block text-gray-800">
            {!s ? "Sin entradas."
              : kind === "SIN_HORARIO" ? <>No aplica: sin horario público. {nf.format(s.entries)} entradas · {nf.format(s.answered)} respondidas{s.firstResponseClock.median !== null ? <> (mitad en {formatMinutes(s.firstResponseClock.median)} de espera real)</> : null} · {nf.format(s.pending.total)} siguen sin primera respuesta.</>
              : kind === "SIN_CONFIG" ? <>No disponible: sin configuración vigente ese día. {nf.format(s.entries)} entradas · {nf.format(s.answered)} respondidas · {nf.format(s.pending.total)} siguen sin primera respuesta.</>
              : <>
                  Mediana hábil: <span className="font-semibold">{formatMinutesOrMissing(medianOf(s))}</span>
                  {s.firstResponseBusiness && s.firstResponseBusiness.n > 0
                    ? s.firstResponseBusiness.n < COMPARISON_MIN_ANSWERED ? <> · Muestra pequeña: {cases(s.firstResponseBusiness.n)}</> : <> · el 90% en {formatMinutesOrMissing(s.firstResponseBusiness.p90)} o menos</>
                    : null}
                  {" "}· {nf.format(s.answered)} respondidas · {nf.format(s.pending.total)} siguen sin primera respuesta.
                  <span className="block">Cumplimiento: {s.goal && s.goal.compliance !== null ? <><span className="font-semibold">{formatRatio(s.goal.compliance)}</span> sobre {nf.format(s.goal.evaluable)} evaluables</> : "sin conversaciones evaluables"}.</span>
                </>}
          </span>
        </p>

        <p className="mt-2 text-xs font-medium text-gray-700">Primera respuesta, en tiempo hábil</p>
        <div className="mt-1 flex h-36">
          <Scale top={top} format={formatMinutes} />
          <div className="relative flex flex-1 gap-[2px] border-b border-l border-gray-300" role="group" aria-label="Primera respuesta por día de entrada">
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-gray-200" aria-hidden />
            {calendar.map((c) => {
              const d = byDay.get(c.day);
              const median = medianOf(d);
              const p90 = p90Of(d);
              const na = c.kind === "SIN_HORARIO";
              const label = `${dayLabel(c.day)}: ${na ? "no aplica, sin horario público" : median === null ? "sin respondidas" : `mediana ${formatMinutes(median)}`}`;
              return (
                <button key={c.day} type="button" title={label} aria-label={label} {...pick(c.day)}
                  className={`relative h-full min-w-0 flex-1 ${c.day === shown ? "bg-gray-100" : ""}`}>
                  {na && <span className="absolute inset-x-0 bottom-0 mx-auto h-1 max-w-[10px] bg-gray-300" />}
                  {!na && median !== null && p90 !== null && p90 > median && (
                    <span className="absolute left-1/2 w-[2px] -translate-x-1/2 bg-[#8E9BC4]" style={{ bottom: pct(median), height: `calc(${pct(p90)} - ${pct(median)})` }} />
                  )}
                  {!na && p90 !== null && <span className="absolute inset-x-0 mx-auto h-[2px] max-w-[10px] bg-[#8E9BC4]" style={{ bottom: pct(p90) }} />}
                  {!na && median !== null && (
                    <span className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-[#1E2D5A] ${d?.inProgress ? "bg-white" : "bg-[#1E2D5A]"}`} style={{ bottom: pct(median) }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <DayAxis days={calendar.map((c) => c.day)} />
        <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-700">
          <li><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1E2D5A] align-middle" aria-hidden />Mediana</li>
          <li><span className="mr-1 inline-block h-[2px] w-3 bg-[#8E9BC4] align-middle" aria-hidden />Tiempo por debajo del cual se atendió el 90% (con {COMPARISON_MIN_ANSWERED} respondidas o más)</li>
          <li><span className="mr-1 inline-block h-2 w-2 rounded-full border-2 border-[#1E2D5A] bg-white align-middle" aria-hidden />Día parcial</li>
          <li><span className="mr-1 inline-block h-1 w-2 bg-gray-300 align-middle" aria-hidden />No aplica: sin horario público</li>
        </ul>

        <p className="mt-4 text-xs font-medium text-gray-700">Cumplimiento de la meta</p>
        <div className="mt-1 flex h-16">
          <Scale top={100} format={(v) => `${Math.round(v)} %`} />
          <div className="flex flex-1 items-end gap-[2px] border-b border-l border-gray-300" role="group" aria-label="Cumplimiento de la meta por día de entrada">
            {calendar.map((c) => {
              const g = byDay.get(c.day)?.goal;
              const v = g && g.compliance !== null ? g.compliance : null;
              const label = `${dayLabel(c.day)}: ${v === null ? "sin conversaciones evaluables" : `${formatRatio(v)} sobre ${g!.evaluable} evaluables`}`;
              return (
                <button key={c.day} type="button" title={label} aria-label={label} {...pick(c.day)}
                  className={`flex h-full min-w-0 flex-1 items-end ${c.day === shown ? "bg-gray-100" : ""}`}>
                  {v !== null && <span className={`block w-full rounded-t-[3px] ${c.day === shown ? "bg-[#1E2D5A]" : "bg-[#8E9BC4]"}`} style={{ height: `${Math.max(2, v * 100)}%` }} />}
                </button>
              );
            })}
          </div>
        </div>
        <DayAxis days={calendar.map((c) => c.day)} />
        <p className="mt-5 text-[11px] text-gray-600">
          Los días sin barra no tienen conversaciones evaluables: sin horario público, sin configuración o sin entradas. Un día reciente puede cambiar: sus pendientes todavía pueden responderse.
        </p>
      </div>
    </div>
  );
}

type HourMode = "entries" | "delay" | "unanswered";
const HOUR_MODES: Array<[HourMode, string]> = [
  ["entries", "Cantidad de entradas"],
  ["delay", "Demora de la primera respuesta"],
  ["unanswered", "Sin respuesta ese día"],
];
/** Con menos respondidas en una hora, la mediana describe muy pocos casos. */
const HOUR_MIN_ANSWERED = 5;

/**
 * Entradas por hora, para organizar el equipo: cuántas entran, cuánto esperan según la hora en
 * que entraron y qué parte queda sin respuesta ese día. Separado por tipo de día.
 */
export function HoursTool({ groups }: { groups: AttentionPayload["byHourKind"] }) {
  const [mode, setMode] = useState<HourMode>("entries");
  const [kind, setKind] = useState<Kind | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const withEntries = groups.filter((g) => g.entries > 0);
  if (withEntries.length === 0) return null;
  const group = withEntries.find((g) => g.kind === kind) ?? withEntries[0];

  const value = (h: (typeof group.hours)[number]): number | null =>
    mode === "entries" ? h.entries
      : mode === "delay" ? h.medianClockMinutes
      : h.entries > 0 ? (h.unansweredSameDay / h.entries) * 100 : null;
  const values = group.hours.map(value);
  const top = mode === "unanswered" ? 100 : Math.max(1, ...values.map((v) => v ?? 0));
  const peak = values.reduce<number>((best, v, h) => ((v ?? -1) > (values[best] ?? -1) ? h : best), 0);
  const shown = picked ?? peak;
  const h = group.hours[shown];
  const format = mode === "entries" ? (v: number) => nf.format(Math.round(v)) : mode === "delay" ? formatMinutes : (v: number) => `${Math.round(v)} %`;
  const btn = (active: boolean) => `min-h-[36px] rounded-md border px-2 py-1 text-xs font-medium ${active ? "border-[#1E2D5A] bg-[#1E2D5A] text-white" : "border-gray-300 bg-white text-gray-800"}`;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-800">Entradas por hora, sumadas en el período</h3>
      <p className="mt-1 text-xs text-gray-600">
        Hora de Buenos Aires en que entró la conversación. Son las entradas de todos los días del período sumadas, no las de un día típico.
      </p>
      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Qué mostrar">
          {HOUR_MODES.map(([m, label]) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setPicked(null); }} className={btn(mode === m)}>{label}</button>)}
        </div>
        {withEntries.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tipo de día">
            {withEntries.map((g) => <button key={g.kind} type="button" aria-pressed={group.kind === g.kind} onClick={() => { setKind(g.kind); setPicked(null); }} className={btn(group.kind === g.kind)}>{KIND_LABELS[g.kind]}</button>)}
          </div>
        )}
        <p className="mt-2 text-xs text-gray-700">
          {KIND_LABELS[group.kind]}: {nf.format(group.days)} {group.days === 1 ? "día" : "días"} del período, {nf.format(group.entries)} entradas.
        </p>
        <p className="mt-2 min-h-[40px] text-sm text-gray-900" aria-live="polite">
          <span className="font-semibold">Entre las {shown} y las {shown + 1} h:</span>{" "}
          {mode === "entries" && <>{nf.format(h.entries)} entradas{shown === peak ? <span className="text-gray-600"> · la hora con más entradas</span> : null}</>}
          {mode === "delay" && (h.answered === 0
            ? <>sin respondidas ({nf.format(h.entries)} entradas)</>
            : <>la mitad esperó {formatMinutes(h.medianClockMinutes ?? 0)} de tiempo real · sobre {nf.format(h.answered)} respondidas de {nf.format(h.entries)}{h.answered < HOUR_MIN_ANSWERED ? <> · Muestra pequeña: {cases(h.answered)}</> : null}</>)}
          {mode === "unanswered" && (h.entries === 0
            ? <>sin entradas</>
            : <>{nf.format(h.unansweredSameDay)} de {nf.format(h.entries)} no recibieron la primera respuesta el día de entrada ({formatRatio(h.unansweredSameDay / h.entries)})</>)}
        </p>
        <div className="mt-2 flex h-36">
          <Scale top={top} format={format} />
          <div className="relative flex flex-1 items-end gap-[2px] border-b border-l border-gray-300" role="group" aria-label={`${HOUR_MODES.find(([m]) => m === mode)![1]} por hora`}>
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-gray-200" aria-hidden />
            {group.hours.map((cell, hour) => {
              const v = values[hour];
              const small = mode === "delay" && cell.answered < HOUR_MIN_ANSWERED;
              const label = `${hour} a ${hour + 1} horas: ${v === null ? "sin datos" : format(v)}`;
              return (
                <button key={hour} type="button" title={label} aria-label={label}
                  onClick={() => setPicked(hour)} onMouseEnter={() => setPicked(hour)} onFocus={() => setPicked(hour)}
                  className="flex h-full min-w-0 flex-1 items-end">
                  {v !== null && v > 0 && (
                    <span className={`block w-full rounded-t-[4px] ${small ? "border border-[#8E9BC4] bg-white" : hour === shown ? "bg-[#1E2D5A]" : "bg-[#8E9BC4]"}`}
                      style={{ height: `${Math.max(3, Math.min(100, (v / top) * 100))}%` }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="ml-14 mt-1 flex gap-[2px] text-[10px] tabular-nums text-gray-600" aria-hidden>
          {group.hours.map((_, hour) => <span key={hour} className="min-w-0 flex-1 text-center">{hour % 3 === 0 ? hour : ""}</span>)}
        </div>
        {mode === "delay" && (
          <p className="mt-2 text-[11px] text-gray-600">
            Espera real (de reloj) desde la salida del bot hasta la primera respuesta, según la hora en que entró la conversación. Solo entre las respondidas.
            Las barras sin relleno tienen menos de {HOUR_MIN_ANSWERED} respondidas.
          </p>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver los números</summary>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums text-gray-800">
              <thead className="text-gray-600">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Hora</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Entradas</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Respondidas</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Mediana de espera real</th>
                  <th scope="col" className="py-1 text-right font-medium">Sin respuesta ese día</th>
                </tr>
              </thead>
              <tbody>
                {group.hours.map((cell, hour) => cell.entries === 0 ? null : (
                  <tr key={hour} className="border-t border-gray-100">
                    <th scope="row" className="py-1 pr-3 font-normal text-gray-600">{hour} h</th>
                    <td className="py-1 pr-3 text-right">{nf.format(cell.entries)}</td>
                    <td className="py-1 pr-3 text-right">{nf.format(cell.answered)}</td>
                    <td className="whitespace-nowrap py-1 pr-3 text-right">{formatMinutesOrMissing(cell.medianClockMinutes)}</td>
                    <td className="py-1 text-right">{nf.format(cell.unansweredSameDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * Dónde se acumula la demora, como recorrido. Cada paso se mide sobre SU población: las
 * medianas no se suman ni se restan entre sí.
 */
export function Journey({ data }: { data: AttentionPayload }) {
  const t = data.total;
  const f = data.activity.followups;
  const steps: Array<{ title: string; value: string; lines: string[] }> = [
    {
      title: "1. El cliente escribe y pasa por el bot",
      value: formatMinutesOrMissing(t.botTime.median),
      lines: [
        `Mediana desde la creación hasta la salida del bot · sobre ${nf.format(t.botTime.n)} conversaciones con la salida registrada`,
        `${nf.format(t.entries - t.botTime.n)} de las ${nf.format(t.entries)} entradas no tienen la salida registrada y no entran acá`,
      ],
    },
    {
      title: "2. Sale del bot y espera la primera respuesta de una persona",
      value: formatMinutesOrMissing(t.firstResponseClock.median),
      lines: [
        `Mediana de espera real · el 90% en ${formatMinutesOrMissing(t.firstResponseClock.p90)} o menos · sobre ${nf.format(t.firstResponseClock.n)} respondidas`,
        t.firstResponseBusiness ? `En tiempo hábil: mediana ${formatMinutesOrMissing(t.firstResponseBusiness.median)} · sobre ${nf.format(t.firstResponseBusiness.n)} con la meta aplicable` : "Tiempo hábil no disponible: sin configuración vigente",
        `${nf.format(t.pending.total)} siguen sin primera respuesta y no entran en estas medianas`,
      ],
    },
    {
      title: "3. Respuestas siguientes, con la conversación ya atendida",
      value: formatMinutesOrMissing(f.response.median),
      lines: [
        `Mediana de espera real · el 90% en ${formatMinutesOrMissing(f.response.p90)} o menos · sobre ${nf.format(f.answered)} bloques del cliente respondidos`,
        `Es por actividad del período, no por entrada: incluye conversaciones que entraron antes. ${nf.format(f.unanswered)} bloques sin respuesta van aparte`,
      ],
    },
  ];
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-800">Dónde se acumula la demora</h3>
      <ol className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-gray-800">{s.title}</span>
              <span className="shrink-0 text-lg font-semibold tabular-nums text-gray-900">{s.value}</span>
            </div>
            {s.lines.map((l) => <p key={l} className="mt-0.5 text-xs text-gray-700">{l}</p>)}
            {i < steps.length - 1 && <span className="sr-only">Sigue el paso siguiente.</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800">
        <span className="font-semibold">Cada paso usa una población distinta: sus medianas no se suman ni se restan.</span>{" "}
        Por ejemplo, de la espera desde el primer mensaje del cliente ({formatMinutesOrMissing(t.fromFirstMessage.median)}, que incluye el bot) menos la espera desde la salida del bot
        ({formatMinutesOrMissing(t.firstResponseClock.median)}) no se puede concluir cuánto tarda el bot.
      </p>
      <p className="mt-2 text-xs text-gray-700">
        Cómo leerlo: la espera se acumula antes de la primera respuesta, mientras nadie tomó la conversación; ese tiempo real incluye noches y días sin atención.
        Una vez que una persona la atiende, las respuestas siguientes son mucho más rápidas.
      </p>
    </div>
  );
}
