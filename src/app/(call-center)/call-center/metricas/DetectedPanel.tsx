"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EVIDENCE_LABELS } from "@/lib/call-center/metrics/indicators";
import type { ClaimMotive, DetectedPayload, DetectedSection, SaleKind } from "@/lib/call-center/metrics/detected-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

const SALE_LABELS: Record<SaleKind, string> = {
  ELSEWHERE: "Pérdida confirmada",
  UNKNOWN_PLACE: "Compró por su cuenta, no dice dónde",
  AT_TKL: "Compró en TKL",
  DERIVED_IN_HOURS: "Derivado dentro del horario de pedidos",
};

const SALE_NOTES: Record<SaleKind, string> = {
  ELSEWHERE: "Dice que compró en otra farmacia o en otro lado, o cancela el pedido.",
  UNKNOWN_PLACE: "Dice que ya compró o ya fue, sin decir dónde. No se cuenta como pérdida.",
  AT_TKL: "Menciona TKL o una sucursal, o ya retiró el pedido. No es una pérdida.",
  DERIVED_IN_HOURS: "El operador lo mandó a comprar a la sucursal dentro del horario de pedidos cargado para esa sucursal, y no hay evidencia de venta. Posible venta perdida.",
};

const CLAIM_LABELS: Record<ClaimMotive, string> = {
  DEMORA: "Demora",
  SIN_NOVEDADES: "Pedido sin novedades",
  INCORRECTO: "Producto o cantidad incorrectos",
  STOCK: "Stock",
  FACTURA: "Factura",
  PRECIO: "Precio o cobertura",
  PAGO: "Pago o devolución",
  TRATO: "Trato",
  OTROS: "Otros",
  ENVIO_NO_LLEGO: "No llegó el pedido",
  ENVIO_ENTREGA: "Problema con la entrega",
  WEB_SIN_CONFIRMACION: "Pagó y no recibió la confirmación",
  WEB_PAGINA: "Problemas con la página",
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DetectedPayload };

/** Bloque "Reclamos y pérdidas": detectado por palabras, con el mismo período que "Atención y demoras". */
export default function DetectedPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>(defaultPeriod(today));
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (p: Period) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/call-center/metrics/detected?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los casos." });
        return;
      }
      setState({ status: "ready", data: body.data as DetectedPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los casos. Revisá la conexión." });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  return (
    <section className="mt-4" aria-label="Reclamos y pérdidas">
      <PeriodForm today={today} period={period} onChange={setPeriod} />
      <p className="mt-2 text-xs text-gray-600">
        Conversaciones que entraron en el período. Se detectan por palabras en los mensajes del cliente: son casos para revisar, no hechos confirmados. Hasta {PERIOD_MAX_DAYS} días.
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

function Report({ data }: { data: DetectedPayload }) {
  const sale = (k: SaleKind) => data.sales.byMotive.find((b) => b.motive === k)?.count ?? 0;
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">
        Calculado a las {timeFmt.format(new Date(data.generatedAt))} · se revisaron {nf.format(data.conversations)} conversaciones.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Pérdidas confirmadas" value={sale("ELSEWHERE")} />
        <Stat label="Compró y no dice dónde" value={sale("UNKNOWN_PLACE")} />
      </div>
      <p className="mt-1 text-xs text-gray-700">Son dos cosas distintas y no se suman: solo la primera es una pérdida.</p>

      <Section title="Ventas" section={data.sales} label={(m) => SALE_LABELS[m]} note={(m) => SALE_NOTES[m]} />
      <Section title="Reclamos del Call Center" section={data.claims.CALL_CENTER} label={(m) => CLAIM_LABELS[m]} />
      <Section title="Envíos" section={data.claims.ENVIOS} label={(m) => CLAIM_LABELS[m]}
        intro="Solo cuenta si hay una queja. Mandar una moto propia o coordinar un horario no es un reclamo." />
      <Section title="Tienda online" section={data.claims.TIENDA_ONLINE} label={(m) => CLAIM_LABELS[m]}
        intro="Compras hechas por la página: no son reclamos de la atención del Call Center." />
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-2xl font-semibold tabular-nums text-gray-900">{nf.format(value)}</p>
      <p className="text-xs text-gray-700">{label}</p>
    </div>
  );
}

function Section<M extends string>({ title, section, label, note, intro }: {
  title: string; section: DetectedSection<M>; label: (m: M) => string; note?: (m: M) => string; intro?: string;
}) {
  const [picked, setPicked] = useState<M | null>(null);
  const cases = picked ? section.cases.filter((c) => c.motive === picked) : section.cases;
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        <p className="text-sm text-gray-700"><span className="text-lg font-semibold tabular-nums text-gray-900">{nf.format(section.conversations)}</span> conversaciones</p>
      </div>
      {intro && <p className="mt-1 text-xs text-gray-700">{intro}</p>}
      <ul className="mt-2 space-y-1">
        {section.byMotive.map((b) => (
          <li key={b.motive}>
            <button type="button" disabled={b.count === 0} aria-pressed={picked === b.motive}
              onClick={() => setPicked(picked === b.motive ? null : b.motive)}
              className={`flex min-h-[40px] w-full items-center justify-between gap-3 rounded-md border px-2 py-1 text-left text-sm disabled:opacity-60 ${picked === b.motive ? "border-[#1E2D5A] ring-1 ring-[#1E2D5A]" : "border-gray-200"}`}>
              <span className="text-gray-800">
                {label(b.motive)}
                {note && <span className="block text-xs text-gray-600">{note(b.motive)}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-gray-900">{nf.format(b.count)}</span>
            </button>
          </li>
        ))}
      </ul>
      {section.casesTotal > 0 && (
        <details className="mt-2" open={picked !== null}>
          <summary className="cursor-pointer py-1 text-xs font-medium text-[#1E2D5A]">
            {picked ? `Casos: ${label(picked)}` : "Ver los casos"}
          </summary>
          {section.casesTotal > section.cases.length && (
            <p className="text-xs text-gray-700">Se muestran los {nf.format(section.cases.length)} más recientes.</p>
          )}
          <ul className="mt-1 divide-y divide-gray-100">
            {cases.map((c) => (
              <li key={`${c.conversationId}|${c.motive}`} className="flex items-center justify-between gap-2 py-1">
                <span className="text-xs text-gray-800">
                  {label(c.motive)}
                  <span className="block text-gray-600">Entró el {dateTimeFmt.format(new Date(c.createdAt))} · {c.open ? "Abierta" : "Cerrada"}</span>
                </span>
                <Link href={`/call-center/${c.conversationId}`} className="inline-flex min-h-[36px] shrink-0 items-center text-xs font-medium text-[#1E2D5A] hover:underline">
                  Ver conversación →
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[11px] text-gray-500">{EVIDENCE_LABELS.DETECTADO}</p>
    </div>
  );
}
