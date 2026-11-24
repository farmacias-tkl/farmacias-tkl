"use client";

import { fetchWithTimeout } from "./fetch-with-timeout";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CONSULT_KINDS, MAIN_KINDS, type ConsultKind, type KindsPayload, type MainKind } from "@/lib/call-center/metrics/kinds-types";
import {
  MOTIVES, MOTIVE_LABELS, ORDER_SIGNALS, UNKNOWN_REASONS,
  type Motive, type MotiveCase, type MotiveCasesPayload, type MotiveCounts, type MotivesPayload, type OrderSignal, type UnknownReason,
} from "@/lib/call-center/metrics/motives-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import { formatShortDay } from "@/lib/call-center/metrics/format";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const cutFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

/**
 * Un color por motivo, solo para distinguirlos: no es un semáforo. Muchos pedidos o muchas
 * consultas no es bueno ni malo. "No identificado" va en gris. Cada color lleva siempre su
 * nombre y su número al lado, y hay tabla.
 */
const COLORS: Record<Motive, string> = {
  PEDIDO: "#2a78d6", CONSULTA: "#eb6834", SEGUIMIENTO: "#1baf7a", RECLAMO: "#eda100", SALUDO: "#e87ba4", NO_IDENTIFICADO: "#8b8b86",
};
const SHORT: Record<Motive, string> = {
  PEDIDO: "Pedido", CONSULTA: "Consulta", SEGUIMIENTO: "Pedido o pago existente", RECLAMO: "Reclamo", SALUDO: "Saludo", NO_IDENTIFICADO: "No identificado",
};
/** Cómo se nombra cada motivo dentro de la frase del resumen. */
const PHRASE: Record<Motive, string> = {
  PEDIDO: "solicitar un pedido", CONSULTA: "hacer una consulta", SEGUIMIENTO: "consultar un pedido o pago existente", RECLAMO: "hacer un reclamo",
  SALUDO: "solo saludar o agradecer", NO_IDENTIFICADO: "uno que no se pudo identificar",
};
const MOTIVE_NOTES: Record<Motive, string> = {
  PEDIDO: "Pide medicamentos o productos, compre o no al final.",
  CONSULTA: "Precio, disponibilidad, cobertura, horarios, sucursales, pagos o servicios.",
  SEGUIMIENTO: "Pregunta por una entrega, un retiro, un pago o una gestión que ya inició.",
  RECLAMO: "Expresa un problema con un pedido, un cobro, una entrega o la atención.",
  SALUDO: "No hay otra solicitud.",
  NO_IDENTIFICADO: "La información no alcanza para clasificarlo.",
};
const CONSULT_LABELS: Record<ConsultKind, string> = {
  SERVICIOS: "Vacunas y servicios", PRECIO: "Precio", STOCK: "Stock o disponibilidad", HORARIOS: "Horarios y sucursales", COBERTURA: "Obra social o cobertura",
  PAGO: "Modalidad de pago", TIENDA_ONLINE: "Tienda online", OTRAS: "Otras",
};
const SIGNAL_LABELS: Record<OrderSignal, string> = {
  RECETA: "Receta digital", DATOS_COMPLETOS: "Datos completos en el bot", TEXTO: "Pedido en texto libre", BOTON_Y_CONTENIDO: "Botón de pedido con adjunto o texto propio",
};
const REASON_LABELS: Record<UnknownReason, string> = {
  BOTON_PEDIDO: "Tocó \"Pedir medicamentos\" y no siguió", ADJUNTO: "Solo un adjunto", ASESOR: "Pidió un asesor, sin decir para qué",
  SOLO_BOTONES: "Solo botones del bot", SIN_MENSAJES: "Sin mensajes del cliente", TEXTO: "Texto que no se reconoce",
};
const KIND_LABELS: Record<MainKind, string> = {
  RECLAMO: "Reclamo", PEDIDO: "Pedido confirmado", COMPRO_TKL: "Compró en TKL", VENTA_PERDIDA: "Venta perdida", NO_SE_PUDO_TOMAR: "No se pudo tomar",
  PEDIDO_SIN_CONFIRMAR: "Pedido sin confirmar", CONSULTA: "Consulta", SEGUIMIENTO: "Seguimiento", SALUDO: "Saludo", SIN_MOTIVO: "Sin motivo claro",
};

/** Franjas del día, por hora de entrada en Buenos Aires. */
const BANDS: Array<{ label: string; hours: number[] }> = [
  { label: "Mañana, 8 a 13", hours: [8, 9, 10, 11, 12] },
  { label: "Tarde, 13 a 19", hours: [13, 14, 15, 16, 17, 18] },
  { label: "Noche, 19 a 8", hours: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7] },
];

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: KindsPayload };

const pct = (n: number, den: number) => (den > 0 ? `${Math.round((n / den) * 100)} %` : "Sin datos");
const sumOf = (c: MotiveCounts) => MOTIVES.reduce((n, m) => n + c[m], 0);

/** Pestaña "Motivos de contacto": ¿para qué nos escriben los clientes? `today` es el día de Buenos Aires. */
export default function MotivesPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>(defaultPeriod(today));
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (p: Period) => {
    setState({ status: "loading" });
    try {
      const res = await fetchWithTimeout(`/api/call-center/metrics/kinds?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los motivos." });
        return;
      }
      setState({ status: "ready", data: body.data as KindsPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los motivos. Revisá la conexión." });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  return (
    <section className="mt-4" aria-label="Motivos de contacto">
      <h2 className="text-base font-semibold text-gray-900">¿Para qué nos escriben nuestros clientes?</h2>
      <div className="mt-2"><PeriodForm today={today} period={period} onChange={setPeriod} /></div>
      <p className="mt-2 text-xs text-gray-600">Conversaciones que entraron en el período, con un motivo principal cada una. Hasta {PERIOD_MAX_DAYS} días.</p>

      {state.status === "loading" && <p className="mt-6 text-sm text-gray-600">Cargando…</p>}
      {state.status === "error" && (
        <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}{" "}
          <button type="button" onClick={() => load(period)} className="font-medium underline">Reintentar</button>
        </div>
      )}
      {state.status === "ready" && (state.data.motives
        ? <Report key={`${period.from}|${period.to}`} m={state.data.motives} generatedAt={state.data.generatedAt} period={period} />
        : <p className="mt-6 text-sm text-gray-600">No disponible</p>)}
    </section>
  );
}

function Report({ m, generatedAt, period }: { m: MotivesPayload; generatedAt: string; period: Period }) {
  // Motivo con el detalle de casos abierto. Se cierra solo al cambiar de período.
  const [picked, setPicked] = useState<Motive | null>(null);
  if (m.conversations === 0) {
    return <p className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">No entró ninguna conversación en el período.</p>;
  }
  const ordered = [...MOTIVES].sort((a, b) => m.total[b] - m.total[a]);
  const top = ordered[0];
  const max = m.total[top];
  // El más frecuente entre los que dicen algo: un saludo o un "no identificado" no es una respuesta a la pregunta.
  const meaningful = ordered.find((x) => x !== "SALUDO" && x !== "NO_IDENTIFICADO" && m.total[x] > 0) ?? null;
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">Corte: {cutFmt.format(new Date(generatedAt))}.</p>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-700">Conversaciones del período</p>
        <p className="text-3xl font-semibold tabular-nums text-gray-900">{nf.format(m.conversations)}</p>
        {meaningful && (
          <p className="mt-1 text-base text-gray-900">
            El motivo más frecuente fue <span className="font-semibold">{PHRASE[meaningful]}</span>: {nf.format(m.total[meaningful])} de {nf.format(m.conversations)} ({pct(m.total[meaningful], m.conversations)}).
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {ordered.map((k) => (
            <li key={k}>
              <button type="button" onClick={() => setPicked(picked === k ? null : k)} aria-pressed={picked === k} disabled={m.total[k] === 0}
                className={`block w-full rounded-md px-2 py-1 text-left disabled:cursor-default ${picked === k ? "ring-2 ring-[#1E2D5A]" : ""}`}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900">{MOTIVE_LABELS[k]}</span>
                  <span className="shrink-0 text-sm tabular-nums text-gray-900"><span className="font-semibold">{nf.format(m.total[k])}</span> · {pct(m.total[k], m.conversations)}</span>
                </span>
                <span className="mt-1 block h-3 w-full rounded-[4px] bg-gray-100">
                  <span className="block h-3 rounded-[4px]" style={{ width: `${max > 0 ? Math.max(m.total[k] > 0 ? 1 : 0, (m.total[k] / max) * 100) : 0}%`, backgroundColor: COLORS[k] }} />
                </span>
                <span className="mt-0.5 block text-xs text-gray-600">{MOTIVE_NOTES[k]}{m.total[k] > 0 ? <span className="ml-1 font-medium text-[#1E2D5A]">Ver los casos</span> : null}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-700">
          Los porcentajes son sobre el total de conversaciones, incluidos &quot;Solo saludo&quot; y &quot;Motivo no identificado&quot;: los seis motivos suman el total.
          Cada conversación tiene un solo motivo principal: la necesidad que originó el contacto. Un reclamo o una cancelación posterior no lo cambia.
        </p>
        <p className="mt-2 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-800">
          Motivos detectados a partir del recorrido del bot y del contenido disponible. Pueden requerir revisión. No son ventas confirmadas ni una evaluación de la atención.
        </p>
      </div>

      {picked && <MotiveCases key={picked} motive={picked} period={period} onClose={() => setPicked(null)} />}

      <Fold title="Solicitudes de pedido" hint={`${nf.format(m.total.PEDIDO)} · cómo se reconocieron y cuántas traen receta`}>
        {ORDER_SIGNALS.map((s) => <Line key={s} label={SIGNAL_LABELS[s]} value={`${nf.format(m.orderSignals[s])} · ${pct(m.orderSignals[s], m.total.PEDIDO)}`} />)}
        <p className="text-xs text-gray-600">
          Cuenta la solicitud, aunque nadie haya respondido todavía: confirmación, pago y envío miden el avance de la gestión, no el motivo. Tocar &quot;Pedir medicamentos&quot; no alcanza solo.
          El resultado de estos pedidos está en &quot;Reclamos y pérdidas&quot;.
        </p>
        <h4 className="pt-2 text-xs font-semibold text-gray-700">Receta digital: una característica del contacto, no un motivo</h4>
        <Line label="Conversaciones con receta digital" value={`${nf.format(m.prescription.has)} · ${pct(m.prescription.has, m.conversations)}`} />
        {m.prescription.byPlatform.map((p) => <Line key={p.platform} label={`· ${p.platform === "otra" ? "Otra plataforma o sin enlace reconocido" : p.platform}`} value={nf.format(p.count)} />)}
        <p className="text-xs text-gray-600">La plataforma sale del dominio del enlace. El enlace no se abre.</p>
      </Fold>

      <Fold title="Temas de consulta" hint={`${nf.format(m.total.CONSULTA)} consultas`}>
        {CONSULT_KINDS.map((k) => <Line key={k} label={CONSULT_LABELS[k]} value={`${nf.format(m.consults[k])} · ${pct(m.consults[k], m.total.CONSULTA)}`} />)}
        <p className="text-xs text-gray-600">Un tema por consulta, por las palabras del cliente o por la opción informativa del bot que eligió.</p>
      </Fold>

      <Fold title="Temas adicionales" hint="lo demás que se trató en la conversación">
        {MOTIVES.filter((k) => k !== "SALUDO" && k !== "NO_IDENTIFICADO").map((k) => (
          <Line key={k} label={`También: ${SHORT[k].toLowerCase()}`} value={nf.format(m.extra[k])} />
        ))}
        <p className="text-xs text-gray-600">
          Conversaciones en las que ese tema aparece sin ser el motivo principal. Por ejemplo, alguien que pidió y después reclamó cuenta como &quot;Solicitar un pedido&quot;, con el reclamo acá.
          Los reclamos, cualquiera sea el motivo principal, están en &quot;Reclamos y pérdidas&quot;.
        </p>
      </Fold>

      {m.total.NO_IDENTIFICADO > 0 && (
        <Fold title="Motivo no identificado" hint={`${nf.format(m.total.NO_IDENTIFICADO)} · por qué no se pudo clasificar`}>
          {UNKNOWN_REASONS.filter((r) => m.unknownReasons[r] > 0).map((r) => <Line key={r} label={REASON_LABELS[r]} value={nf.format(m.unknownReasons[r])} />)}
        </Fold>
      )}

      <Fold title="Evolución por día" hint="por día de entrada">
        <DayBars days={m.byDay} />
      </Fold>

      <Fold title="Por franja horaria" hint="todas las categorías y el total de cada franja">
        <p className="mt-2 text-xs text-gray-600">Hora de Buenos Aires en que entró la conversación.</p>
        <Table head={[...MOTIVES.map((k) => SHORT[k]), "Total"]}
          rows={BANDS.map((b) => {
            const counts = MOTIVES.map((k) => b.hours.reduce((n, h) => n + m.byHour[h][k], 0));
            const total = counts.reduce((a, c) => a + c, 0);
            return { label: b.label, cells: [...counts.map((c) => `${nf.format(c)} · ${pct(c, total)}`), nf.format(total)] };
          })} />
      </Fold>

      <Fold title="Cambio respecto de la clasificación anterior" hint="para validar">
        <p className="mt-2 text-xs text-gray-600">Por cada tipo de la clasificación anterior (&quot;Tipos&quot;), en qué motivo quedaron sus conversaciones.</p>
        <Table head={MOTIVES.map((k) => SHORT[k])}
          rows={MAIN_KINDS.filter((k) => sumOf(m.fromKind[k]) > 0).map((k) => ({
            label: `${KIND_LABELS[k]} (${nf.format(sumOf(m.fromKind[k]))})`, cells: MOTIVES.map((x) => nf.format(m.fromKind[k][x])),
          }))} />
      </Fold>
    </>
  );
}

/** Barras apiladas por día: un color por motivo, con leyenda, detalle al tocar y tabla. */
function DayBars({ days }: { days: MotivesPayload["byDay"] }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (days.length === 0) return <p className="mt-2 text-sm text-gray-600">Sin datos.</p>;
  const shown = days.find((d) => d.day === picked) ?? days[days.length - 1];
  const max = Math.max(1, ...days.map(sumOf));
  const step = Math.max(1, Math.ceil(days.length / 6));
  return (
    <>
      <p className="mt-2 min-h-[40px] text-sm text-gray-900" aria-live="polite">
        <span className="font-semibold">{formatShortDay(shown.day)}:</span> {nf.format(sumOf(shown))} conversaciones ·{" "}
        {MOTIVES.filter((k) => shown[k] > 0).map((k) => `${SHORT[k]} ${nf.format(shown[k])}`).join(" · ")}
      </p>
      <div className="mt-1 flex h-36">
        <div className="flex w-10 shrink-0 flex-col justify-between pr-1 text-right text-[10px] tabular-nums leading-none text-gray-600" aria-hidden>
          <span>{nf.format(max)}</span><span>{nf.format(Math.round(max / 2))}</span><span>0</span>
        </div>
        <div className="flex flex-1 items-end gap-[2px] border-b border-l border-gray-300" role="group" aria-label="Conversaciones por día y motivo">
          {days.map((d) => {
            const label = `${formatShortDay(d.day)}: ${nf.format(sumOf(d))} conversaciones`;
            return (
              <button key={d.day} type="button" title={label} aria-label={label} onClick={() => setPicked(d.day)} onMouseEnter={() => setPicked(d.day)} onFocus={() => setPicked(d.day)}
                className={`flex h-full min-w-0 flex-1 flex-col-reverse gap-[1px] ${d.day === shown.day ? "bg-gray-100" : ""}`}>
                {MOTIVES.filter((k) => d[k] > 0).map((k) => <span key={k} className="block w-full" style={{ height: `${(d[k] / max) * 100}%`, backgroundColor: COLORS[k] }} />)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ml-10 mt-1 flex gap-[2px] text-[10px] tabular-nums text-gray-600" aria-hidden>
        {days.map((d, i) => <span key={d.day} className="relative min-w-0 flex-1">{i % step === 0 ? <span className="absolute left-0 whitespace-nowrap">{formatShortDay(d.day)}</span> : null}</span>)}
      </div>
      <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-800">
        {MOTIVES.map((k) => <li key={k}><span className="mr-1 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ backgroundColor: COLORS[k] }} aria-hidden />{SHORT[k]}</li>)}
      </ul>
      <p className="mt-1 text-[11px] text-gray-600">Los colores solo distinguen motivos: no indican que algo esté bien o mal.</p>
      <details className="mt-2">
        <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">Ver la tabla</summary>
        <Table head={[...MOTIVES.map((k) => SHORT[k]), "Total"]}
          rows={[...days].reverse().map((d) => ({ label: formatShortDay(d.day), cells: [...MOTIVES.map((k) => nf.format(d[k])), nf.format(sumOf(d))] }))} />
      </details>
    </>
  );
}

type CasesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: MotiveCasesPayload };

/** Conversaciones de un motivo, para revisar si están bien clasificadas. Se pide al abrirla. */
function MotiveCases({ motive, period, onClose }: { motive: Motive; period: Period; onClose: () => void }) {
  const [state, setState] = useState<CasesState>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetchWithTimeout(`/api/call-center/metrics/kinds/cases?motive=${motive}&from=${period.from}&to=${period.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los casos." });
        return;
      }
      setState({ status: "ready", data: body.data as MotiveCasesPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los casos. Revisá la conexión." });
    }
  }, [motive, period.from, period.to]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-3 rounded-lg border border-[#1E2D5A] bg-white p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Casos: {MOTIVE_LABELS[motive]}{state.status === "ready" ? ` (${nf.format(state.data.total)})` : ""}</h3>
        <button type="button" onClick={onClose} className="shrink-0 text-xs font-medium text-[#1E2D5A] underline">Cerrar</button>
      </div>
      <p className="mt-1 text-xs text-gray-700">Para revisar si están bien clasificados.</p>
      {state.status === "loading" && <p className="mt-2 text-sm text-gray-600">Cargando…</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-800">{state.message} <button type="button" onClick={load} className="font-medium underline">Reintentar</button></p>
      )}
      {state.status === "ready" && (state.data.cases.length === 0 ? <p className="mt-2 text-sm text-gray-600">No hay casos en el período.</p> : (
        <>
          {state.data.total > state.data.cases.length && <p className="mt-1 text-xs text-gray-700">Se muestran los {nf.format(state.data.cases.length)} más recientes.</p>}
          <ul className="mt-2 grid gap-2 lg:grid-cols-2">{state.data.cases.map((c) => <CaseRow key={c.conversationId} c={c} />)}</ul>
        </>
      ))}
    </div>
  );
}

function CaseRow({ c }: { c: MotiveCase }) {
  const tag = "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800";
  const detail = c.orderSignal ? SIGNAL_LABELS[c.orderSignal] : c.unknownReason ? REASON_LABELS[c.unknownReason] : c.consult ? CONSULT_LABELS[c.consult] : null;
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Entró el {dateTimeFmt.format(new Date(c.createdAt))}</p>
        <Link href={`/call-center/${c.conversationId}`} className="inline-flex min-h-[36px] shrink-0 items-center text-xs font-medium text-[#1E2D5A] hover:underline">Ver conversación →</Link>
      </div>
      <p className="mt-1 flex flex-wrap gap-1.5">
        {detail && <span className={tag}>{detail}</span>}
        {c.prescription && !c.orderSignal && <span className={tag}>Con receta digital</span>}
        {c.extra.map((e) => <span key={e} className={tag}>También: {SHORT[e].toLowerCase()}</span>)}
      </p>
    </li>
  );
}

function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="mt-4 rounded-lg border border-gray-200 bg-white">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-gray-800">
        <span>{title}{hint && <span className="ml-2 text-xs font-normal text-gray-600">{hint}</span>}</span>
        <span aria-hidden className="text-xs font-normal text-[#1E2D5A]">Ver</span>
      </summary>
      <div className="space-y-1 border-t border-gray-200 px-3 pb-3 pt-2">{children}</div>
    </details>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-800">{label}</span>
      <span className="shrink-0 font-medium tabular-nums text-gray-900">{value}</span>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: Array<{ label: string; cells: string[] }> }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-gray-600">
          <tr><th scope="col" className="py-1 font-medium"></th>{head.map((h) => <th key={h} scope="col" className="px-1 py-1 text-right font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-gray-100">
              <th scope="row" className="whitespace-nowrap py-1.5 pr-2 font-medium text-gray-800">{r.label}</th>
              {r.cells.map((c, i) => <td key={i} className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums text-gray-900">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
