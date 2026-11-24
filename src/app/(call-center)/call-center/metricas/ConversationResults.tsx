"use client";

import { fetchWithTimeout } from "./fetch-with-timeout";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_LABELS } from "@/lib/call-center/metrics/indicators";
import {
  CLOSURE_OUTCOME_LIST, LOST_KINDS, MAIN_KINDS, NO_TAKE_KINDS, ORDER_KINDS,
  type ClosureOutcome, type KindsPayload, type LostKind, type MainKind, type NoTakeKind, type OrderKind,
} from "@/lib/call-center/metrics/kinds-types";
import type { Period } from "./PeriodForm";

const nf = new Intl.NumberFormat("es-AR");

const ORDER_LABELS: Record<OrderKind, string> = { DOMICILIO: "A domicilio", RETIRO: "Retiro en sucursal", RECETA: "Con receta digital, sin modalidad elegida", SIN_MODALIDAD: "Sin modalidad" };
const NO_TAKE_LABELS: Record<NoTakeKind, string> = {
  SIN_STOCK: "Sin stock o falta del laboratorio", DERIVADO_PRESENCIAL: "Derivado a compra presencial", DERIVADO_EN_HORARIO: "Derivado dentro del horario",
  DERIVADO_MEDICAMENTO: "Derivado a compra presencial por tipo de medicamento",
};
const LOST_LABELS: Record<LostKind, string> = { OTRO_LADO: "Compró en otro lado o canceló", PROBABLE: "Probable: va a buscar en otra farmacia", NO_DICE_DONDE: "No dice dónde compró" };
const OUTCOME_LABELS: Record<ClosureOutcome, string> = {
  VENTA: "Venta", CONSULTA: "Consulta resuelta", PEDIDO_NO_CONCRETADO: "Pedido no concretado", NO_LO_TRABAJAMOS: "No se pudo vender · no lo trabajamos", SIN_STOCK: "No se pudo vender · sin stock o discontinuado",
  SOLO_BOT: "Solo bot, sin atención de una persona", OTRO: "Otro",
};
const SHORT: Record<MainKind, string> = {
  RECLAMO: "Reclamos", PEDIDO: "Venta concretada", CONSULTA: "Consultas", COMPRO_TKL: "Compró en TKL", VENTA_PERDIDA: "Venta perdida", NO_SE_PUDO_TOMAR: "No se pudo vender",
  PEDIDO_SIN_CONFIRMAR: "Sin confirmar", SEGUIMIENTO: "Seguimiento", SALUDO: "Saludo", SIN_MOTIVO: "Sin motivo claro",
};

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: KindsPayload };

const pct = (n: number, den: number) => (den > 0 ? `${Math.round((n / den) * 100)} %` : "Sin datos");

/**
 * "Resultado de las conversaciones": cómo terminaron las gestiones del período (venta
 * concretada, perdida, no se pudo vender, compró en TKL) y lo que confirmó el operador al
 * cerrar. El motivo por el que escribió el cliente está en "Motivos de contacto".
 */
export default function ConversationResults({ period }: { period: Period }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetchWithTimeout(`/api/call-center/metrics/kinds?from=${period.from}&to=${period.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      setState(res.ok && body?.data ? { status: "ready", data: body.data as KindsPayload } : { status: "error" });
    } catch {
      setState({ status: "error" });
    }
  }, [period.from, period.to]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Resultado de las conversaciones</h2>
      <p className="mt-1 text-xs text-gray-600">
        Cómo terminaron las conversaciones que entraron en el período. Una conversación cuenta acá por su resultado y en &quot;Motivos de contacto&quot; por el motivo que la originó.
      </p>
      {state.status === "loading" && <p className="mt-3 text-sm text-gray-600">Cargando…</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-800">No se pudo cargar el resultado de las conversaciones. <button type="button" onClick={load} className="font-medium underline">Reintentar</button></p>
      )}
      {state.status === "ready" && <Results data={state.data} />}
    </div>
  );
}

function Results({ data }: { data: KindsPayload }) {
  const t = data.total;
  const n = data.conversations;
  if (n === 0) return <p className="mt-3 text-sm text-gray-600">No entró ninguna conversación en el período.</p>;
  const notCompleted = t.VENTA_PERDIDA + t.NO_SE_PUDO_TOMAR + t.PEDIDO_SIN_CONFIRMAR;
  return (
    <>
      <p className="mt-2 text-[11px] text-gray-500">{EVIDENCE_LABELS.DETECTADO}: recorrido del bot y palabras · sobre {nf.format(n)} conversaciones</p>

      <Group title="Venta concretada" value={`${nf.format(t.PEDIDO)} · ${pct(t.PEDIDO, n)}`}
        note="El operador confirma el pedido (número de control, aviso de retiro, salida del envío), hay evidencia de pago, o el cliente mandó una receta digital para pedir y no avisó que desistía.">
        {ORDER_KINDS.map((k) => <Line key={k} label={`· ${ORDER_LABELS[k]}`} value={nf.format(data.orders[k])} />)}
      </Group>

      <Group title="Pedidos no concretados" value={`${nf.format(notCompleted)} · ${pct(notCompleted, n)}`}
        note="El cliente quería pedir y la venta no quedó confirmada. Los tres grupos son cosas distintas: no se suman como ventas perdidas.">
        <Line label="Venta perdida" value={nf.format(t.VENTA_PERDIDA)} note="El cliente dice que ya lo compró, que ya fue o que cancela, sin nombrar a TKL." />
        {LOST_KINDS.map((k) => <Line key={k} label={`· ${LOST_LABELS[k]}`} value={nf.format(data.lost[k])} />)}
        <Line label="No se pudo vender" value={nf.format(t.NO_SE_PUDO_TOMAR)} />
        {NO_TAKE_KINDS.map((k) => (
          <Line key={k} label={`· ${NO_TAKE_LABELS[k]}`} value={nf.format(data.noTake[k])}
            note={k === "DERIVADO_PRESENCIAL" ? `El operador avisa que no hay personal de pedidos, o que desde esa sucursal no se hacen envíos ni retiros. Fuera del horario de pedidos de la sucursal es lo correcto.${data.derivedWithoutBranch > 0 ? ` En ${nf.format(data.derivedWithoutBranch)} no se pudo identificar la sucursal.` : ""}`
              : k === "DERIVADO_EN_HORARIO" ? "El aviso se mandó dentro del horario de pedidos cargado para esa sucursal: posible venta perdida."
              : k === "DERIVADO_MEDICAMENTO" ? "El medicamento solo se vende en forma presencial en una sucursal." : undefined} />
        ))}
        <Line label="El cliente no respondió o quedó en volver" value={nf.format(t.PEDIDO_SIN_CONFIRMAR)}
          note="Completó el recorrido del bot, o mandó una receta o un adjunto sin texto, y la conversación terminó sin confirmación, sin aviso de falta y sin que diga que compró en otro lado." />
      </Group>

      <Group title="Compró en forma presencial en TKL" value={`${nf.format(t.COMPRO_TKL)} · ${pct(t.COMPRO_TKL, n)}`}
        note="El cliente dice que lo compró en una sucursal TKL, o avisa que pasa a pagar después de que le ofrecieron stock. Es una venta de TKL, no una venta perdida." />

      <p className="mt-3 text-xs text-gray-600">
        El resto de las conversaciones ({nf.format(n - t.PEDIDO - notCompleted - t.COMPRO_TKL)}) no tiene un resultado comercial detectado: consultas, seguimientos, reclamos, saludos y casos sin motivo claro.
        Una conversación con reclamo cuenta como reclamo, más abajo, y no acá.
      </p>
      {data.motives && (
        <p className="mt-2 text-sm text-gray-800">
          Reclamos como motivo principal: <span className="font-semibold tabular-nums">{nf.format(data.motives.total.RECLAMO)}</span>
          {" · "}con un reclamo durante la conversación: <span className="font-semibold tabular-nums">{nf.format(data.motives.extra.RECLAMO)}</span>
          <span className="block text-xs text-gray-600">
            Es la misma regla en todo el tablero: el cliente habla de un problema propio con un pedido, un pago, una entrega o la atención.
            Los primeros escribieron por el reclamo; los segundos escribieron por otra cosa (un pedido, una consulta) y el reclamo apareció después.
          </span>
        </p>
      )}

      {data.operator && (
        <Group title="Resultado de cierre registrado por el operador" value={`${nf.format(data.operator.confirmed)} de ${nf.format(n)}`}
          note="Lo que el operador eligió al resolver, tomado de la etiqueta de cierre de Emozion. Es un dato confirmado; lo de arriba es detectado por palabras.">
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
                Coincidencia entre lo detectado y lo confirmado: <span className="font-semibold">{pct(data.operator.agree, data.operator.compared)}</span>{" "}
                ({nf.format(data.operator.agree)} de {nf.format(data.operator.compared)}). Sirve para validar la detección, no para reemplazarla.
              </p>
            </>
          )}
        </Group>
      )}
    </>
  );
}

function Group({ title, value, note, children }: { title: string; value: string; note?: string; children?: ReactNode }) {
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{value}</span>
      </div>
      {note && <p className="mt-1 text-xs text-gray-600">{note}</p>}
      {children && <div className="mt-2 space-y-1">{children}</div>}
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
