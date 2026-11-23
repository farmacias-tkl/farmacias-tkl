"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_LABELS } from "@/lib/call-center/metrics/indicators";
import {
  CLOSURE_OUTCOME_LIST, CONSULT_KINDS, LOST_KINDS, MAIN_KINDS, NO_TAKE_KINDS, ORDER_KINDS,
  type ClosureOutcome, type ConsultKind, type KindCounts, type KindsPayload, type LostKind, type MainKind, type NoTakeKind, type OrderKind,
} from "@/lib/call-center/metrics/kinds-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import { formatShortDay } from "@/lib/call-center/metrics/format";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";

const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const ORDER_LABELS: Record<OrderKind, string> = { DOMICILIO: "A domicilio", RETIRO: "Retiro en sucursal", RECETA: "Receta digital", SIN_MODALIDAD: "Sin modalidad" };
const NO_TAKE_LABELS: Record<NoTakeKind, string> = {
  SIN_STOCK: "Sin stock o falta del laboratorio", DERIVADO_PRESENCIAL: "Derivado a compra presencial", DERIVADO_EN_HORARIO: "Derivado dentro del horario",
  DERIVADO_MEDICAMENTO: "Derivado a compra presencial por tipo de medicamento",
};
const LOST_LABELS: Record<LostKind, string> = { OTRO_LADO: "Compró en otro lado o canceló", PROBABLE: "Probable: va a buscar en otra farmacia", NO_DICE_DONDE: "No dice dónde compró" };
const CONSULT_LABELS: Record<ConsultKind, string> = {
  SERVICIOS: "Vacunas y servicios", PRECIO: "Precio", STOCK: "Stock o disponibilidad", HORARIOS: "Horarios y sucursales", COBERTURA: "Obra social o cobertura",
  PAGO: "Modalidad de pago", TIENDA_ONLINE: "Tienda online", OTRAS: "Otras",
};

const OUTCOME_LABELS: Record<ClosureOutcome, string> = {
  VENTA: "Venta", CONSULTA: "Consulta resuelta", PEDIDO_NO_CONCRETADO: "Pedido no concretado", NO_SE_PUDO_VENDER: "No se pudo vender",
  SOLO_BOT: "Solo bot, sin atención de una persona", OTRO: "Otro",
};

/** Franjas del día, por hora de entrada en Buenos Aires. */
const BANDS: Array<{ label: string; hours: number[] }> = [
  { label: "Mañana, 8 a 13", hours: [8, 9, 10, 11, 12] },
  { label: "Tarde, 13 a 19", hours: [13, 14, 15, 16, 17, 18] },
  { label: "Noche, 19 a 8", hours: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7] },
];

/** Los tres tipos que se comparan entre sí. El resto va aparte. */
const COMPARED: MainKind[] = ["RECLAMO", "PEDIDO", "CONSULTA"];
const SHORT: Record<MainKind, string> = {
  RECLAMO: "Reclamos", PEDIDO: "Pedidos", CONSULTA: "Consultas", COMPRO_TKL: "Compró en TKL", VENTA_PERDIDA: "Venta perdida", NO_SE_PUDO_TOMAR: "No se pudo tomar",
  PEDIDO_SIN_CONFIRMAR: "Sin confirmar", SEGUIMIENTO: "Seguimiento", SALUDO: "Saludo", SIN_MOTIVO: "Sin motivo claro",
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: KindsPayload };

const pct = (n: number, den: number) => (den > 0 ? `${Math.round((n / den) * 100)} %` : "Sin datos");

/** Bloque "Tipos": qué vienen a hacer las conversaciones que entran. `today` es el día de Buenos Aires. */
export default function KindsPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>(defaultPeriod(today));
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (p: Period) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/call-center/metrics/kinds?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los tipos." });
        return;
      }
      setState({ status: "ready", data: body.data as KindsPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los tipos. Revisá la conexión." });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  return (
    <section className="mt-4" aria-label="Tipos">
      <PeriodForm today={today} period={period} onChange={setPeriod} />
      <p className="mt-2 text-xs text-gray-600">Conversaciones que entraron en el período, con un tipo cada una. Hasta {PERIOD_MAX_DAYS} días.</p>

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

function Report({ data }: { data: KindsPayload }) {
  const t = data.total;
  // Los porcentajes no cuentan los saludos y agradecimientos solos.
  const base = data.conversations - t.SALUDO;
  const notCompleted = t.VENTA_PERDIDA + t.NO_SE_PUDO_TOMAR + t.PEDIDO_SIN_CONFIRMAR;
  const sum = (counts: KindCounts[]) => (k: MainKind) => counts.reduce((n, c) => n + c[k], 0);

  if (data.conversations === 0) {
    return <p className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">No entró ninguna conversación en el período.</p>;
  }
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">
        Calculado a las {timeFmt.format(new Date(data.generatedAt))} · {nf.format(data.conversations)} conversaciones ·{" "}
        {data.source === "MEDIDO" ? "Medido: tipo de cierre de Emozion" : `${EVIDENCE_LABELS.DETECTADO}: recorrido del bot y palabras`}
      </p>

      {data.operator && (
        <Box title={`Confirmado por el operador (${nf.format(data.operator.confirmed)} de ${nf.format(data.conversations)})`}
          note="Resultado que el operador eligió al resolver, tomado de la etiqueta de cierre de Emozion. Es un dato confirmado; todo lo demás de esta pestaña es detectado por palabras.">
          {data.operator.confirmed === 0 ? (
            <p className="text-sm text-gray-700">Ninguna conversación del período tiene etiqueta de cierre todavía.</p>
          ) : (
            <>
              {CLOSURE_OUTCOME_LIST.filter((o) => data.operator!.byOutcome[o] > 0).map((o) => {
                const row = data.operator!.matrix[o];
                const detected = MAIN_KINDS.filter((k) => row[k] > 0).sort((a, b) => row[b] - row[a]).map((k) => `${SHORT[k]} ${nf.format(row[k])}`).join(" · ");
                return <Line key={o} label={OUTCOME_LABELS[o]} value={`${nf.format(data.operator!.byOutcome[o])} · ${pct(data.operator!.byOutcome[o], data.operator!.confirmed)}`} note={`Detectado: ${detected}`} />;
              })}
              <p className="border-t border-gray-100 pt-2 text-sm text-gray-800">
                Coincidencia con lo detectado: <span className="font-semibold">{pct(data.operator.agree, data.operator.compared)}</span>{" "}
                ({nf.format(data.operator.agree)} de {nf.format(data.operator.compared)}). Sirve para validar la clasificación detectada, no para reemplazarla.
              </p>
            </>
          )}
        </Box>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Pedidos" value={t.PEDIDO} share={pct(t.PEDIDO, base)} />
        <Stat label="Consultas" value={t.CONSULTA} share={pct(t.CONSULTA, base)} />
        <Stat label="Reclamos" value={t.RECLAMO} share={pct(t.RECLAMO, base)} />
      </div>
      <p className="mt-1 text-xs text-gray-700">
        Porcentajes sobre {nf.format(base)} conversaciones, sin los saludos y agradecimientos solos. Cada conversación tiene un solo tipo: si es reclamo y pedido a la vez, cuenta como reclamo.
      </p>

      <Box title={`Pedidos no concretados (${nf.format(notCompleted)} · ${pct(notCompleted, base)})`} note="El cliente quería pedir y la venta no quedó confirmada. No suman como pedidos.">
        <Line label="Venta perdida" value={`${nf.format(t.VENTA_PERDIDA)} · ${pct(t.VENTA_PERDIDA, base)}`}
          note="El cliente dice que ya lo compró, que ya fue o que cancela, sin nombrar a TKL." />
        {LOST_KINDS.map((k) => <Line key={k} label={`· ${LOST_LABELS[k]}`} value={nf.format(data.lost[k])} />)}
        <Line label="No se pudo tomar" value={`${nf.format(t.NO_SE_PUDO_TOMAR)} · ${pct(t.NO_SE_PUDO_TOMAR, base)}`} />
        {NO_TAKE_KINDS.map((k) => (
          <Line key={k} label={`· ${NO_TAKE_LABELS[k]}`} value={nf.format(data.noTake[k])}
            note={k === "DERIVADO_PRESENCIAL" ? `El operador avisa que no hay personal de pedidos, o que desde esa sucursal no se hacen envíos ni retiros. Fuera del horario de pedidos de la sucursal es lo correcto.${data.derivedWithoutBranch > 0 ? ` En ${nf.format(data.derivedWithoutBranch)} no se pudo identificar la sucursal.` : ""}`
              : k === "DERIVADO_EN_HORARIO" ? "El aviso se mandó dentro del horario de pedidos cargado para esa sucursal: posible venta perdida."
              : k === "DERIVADO_MEDICAMENTO" ? "El medicamento solo se vende en forma presencial en una sucursal." : undefined} />
        ))}
        <Line label="El cliente no respondió o quedó en volver" value={`${nf.format(t.PEDIDO_SIN_CONFIRMAR)} · ${pct(t.PEDIDO_SIN_CONFIRMAR, base)}`}
          note="Completó el recorrido del bot, o mandó una receta o un adjunto sin texto, y la conversación terminó sin confirmación, sin aviso de falta y sin que diga que compró en otro lado." />
      </Box>

      <Box title="Aparte">
        <Line label="Compró presencial en TKL" value={`${nf.format(t.COMPRO_TKL)} · ${pct(t.COMPRO_TKL, base)}`}
          note="El cliente dice que lo compró en una sucursal TKL, o avisa que pasa a pagar después de que le ofrecieron stock. Es una venta de TKL, no una venta perdida." />
        <Line label="Seguimiento / postventa" value={`${nf.format(t.SEGUIMIENTO)} · ${pct(t.SEGUIMIENTO, base)}`}
          note="Pregunta por un pago o un pedido ya hecho, o avisa que espera algo para seguir." />
        <Line label="Sin motivo claro" value={`${nf.format(t.SIN_MOTIVO)} · ${pct(t.SIN_MOTIVO, base)}`}
          note="No hay evidencia de qué quería el cliente. Que un operador haya respondido no alcanza para contarla como consulta." />
        <Line label="Saludo / agradecimiento" value={nf.format(t.SALUDO)} note="Solo saludos, agradecimientos o botones. No entra en los porcentajes." />
      </Box>

      <Box title={`Pedidos (${nf.format(t.PEDIDO)})`} note={<>Es pedido si el operador lo confirma (número de control, aviso de retiro, salida del envío), si hay evidencia de pago o si el cliente mandó una receta digital para pedir. Elegir &quot;Pedir medicamentos&quot; en el bot no alcanza, y que el operador informe un precio tampoco.</>}>
        {ORDER_KINDS.map((k) => <Line key={k} label={ORDER_LABELS[k]} value={`${nf.format(data.orders[k])} · ${pct(data.orders[k], t.PEDIDO)}`} />)}
      </Box>

      <Box title={`Consultas (${nf.format(t.CONSULTA)})`} note={`El cliente pregunta por un tema; el subtipo sale de sus palabras. Los botones del bot sin texto no alcanzan. ${nf.format(data.consultsAnswered)} de ${nf.format(t.CONSULTA)} tuvieron respuesta de un operador.`}>
        {CONSULT_KINDS.map((k) => <Line key={k} label={CONSULT_LABELS[k]} value={`${nf.format(data.consults[k])} · ${pct(data.consults[k], t.CONSULTA)}`} />)}
      </Box>

      <Box title="Por franja horaria" note="Hora de Buenos Aires en que entró la conversación. El porcentaje es la parte de cada tipo dentro de la franja.">
        <Grid head={COMPARED.map((k) => SHORT[k])}
          rows={BANDS.map((b) => {
            const of = sum(b.hours.map((h) => data.byHour[h]));
            const den = COMPARED.reduce((n, k) => n + of(k), 0);
            return { label: b.label, cells: COMPARED.map((k) => `${nf.format(of(k))} · ${pct(of(k), den)}`) };
          })} />
      </Box>

      <Box title="Por día" note="Día de Buenos Aires en que entró la conversación.">
        <Grid head={COMPARED.map((k) => SHORT[k])}
          rows={[...data.byDay].reverse().map((d) => ({ label: formatShortDay(d.day), cells: COMPARED.map((k) => nf.format(d[k])) }))} />
      </Box>
    </>
  );
}

function Stat({ label, value, share }: { label: string; value: number; share: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-2xl font-semibold tabular-nums text-gray-900">{nf.format(value)}</p>
      <p className="text-xs text-gray-700">{label} · {share}</p>
    </div>
  );
}

function Box({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {note && <p className="mt-1 text-xs text-gray-700">{note}</p>}
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-800">{label}{note && <span className="block text-xs text-gray-600">{note}</span>}</span>
      <span className="shrink-0 font-medium tabular-nums text-gray-900">{value}</span>
    </div>
  );
}

/** Tabla angosta: una etiqueta y tres columnas, entra en el celular sin desplazamiento. */
function Grid({ head, rows }: { head: string[]; rows: Array<{ label: string; cells: string[] }> }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-gray-600">
        <tr><th scope="col" className="py-1 font-medium"></th>{head.map((h) => <th key={h} scope="col" className="py-1 text-right font-medium">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-gray-100">
            <th scope="row" className="py-1.5 pr-2 font-medium text-gray-800">{r.label}</th>
            {r.cells.map((c, i) => <td key={i} className="py-1.5 text-right tabular-nums text-gray-900">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
