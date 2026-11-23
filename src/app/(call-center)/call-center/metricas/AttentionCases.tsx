"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AttentionCase, AttentionCaseKind, AttentionCasesPayload } from "@/lib/call-center/metrics/attention-types";
import { formatMinutes } from "@/lib/call-center/metrics/format";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

export const CASE_KIND_LABELS: Record<AttentionCaseKind, string> = {
  pending: "Sin primera respuesta",
  overdue: "Sin primera respuesta y con la meta vencida",
  unanswered_same_day: "Sin respuesta el mismo día",
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AttentionCasesPayload };

const ownerLabel = (o: AttentionCase["owner"]) =>
  o.kind === "SYSTEM" ? "Sin tomar" : o.kind === "ACCOUNT" ? `Asignada a ${o.label}` : "Sin dato de asignado";

/** Lista de conversaciones detrás de un indicador de "Atención y demoras". Se pide al abrirla. */
export default function AttentionCases({ kind, period, onClose }: { kind: AttentionCaseKind; period: { from: string; to: string }; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/call-center/metrics/attention/cases?kind=${kind}&from=${period.from}&to=${period.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los casos." });
        return;
      }
      setState({ status: "ready", data: body.data as AttentionCasesPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los casos. Revisá la conexión." });
    }
  }, [kind, period.from, period.to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-3 rounded-lg border border-[#1E2D5A] bg-white p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Casos: {CASE_KIND_LABELS[kind]}
          {state.status === "ready" ? ` (${nf.format(state.data.total)})` : ""}
        </h3>
        <button type="button" onClick={onClose} className="shrink-0 text-xs font-medium text-[#1E2D5A] underline">Cerrar</button>
      </div>
      {state.status === "loading" && <p className="mt-2 text-sm text-gray-600">Cargando…</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {state.message} <button type="button" onClick={load} className="font-medium underline">Reintentar</button>
        </p>
      )}
      {state.status === "ready" && (
        state.data.cases.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No hay casos en el período.</p>
        ) : (
          <>
            {state.data.total > state.data.cases.length && (
              <p className="mt-1 text-xs text-gray-700">Se muestran los {nf.format(state.data.cases.length)} que más esperan.</p>
            )}
            <ul className="mt-2 grid gap-2 lg:grid-cols-2">
              {state.data.cases.map((c) => <CaseRow key={c.conversationId} c={c} />)}
            </ul>
          </>
        )
      )}
    </div>
  );
}

function CaseRow({ c }: { c: AttentionCase }) {
  const tag = "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800";
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-semibold tabular-nums text-gray-900">
          {c.businessMinutes !== null ? `${formatMinutes(c.businessMinutes)} hábiles` : formatMinutes(c.waitMinutes)}
          {c.overdue && <span className="ml-2 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-900">Meta vencida</span>}
        </p>
        <Link href={`/call-center/${c.conversationId}`} className="inline-flex min-h-[36px] shrink-0 items-center text-xs font-medium text-[#1E2D5A] hover:underline">
          Ver conversación →
        </Link>
      </div>
      <p className="mt-1 flex flex-wrap gap-1.5">
        <span className={tag}>{ownerLabel(c.owner)}</span>
        <span className={tag}>{c.answeredAt ? "Respondida otro día" : "Sin primera respuesta"}</span>
        {c.open !== null && <span className={tag}>{c.open ? "Abierta" : "Cerrada"}</span>}
        {c.orderComplete && <span className={tag}>Pedido completo</span>}
      </p>
      <p className="mt-1 text-xs text-gray-700">
        Salió del bot el <span className="font-semibold text-gray-900">{dateTimeFmt.format(new Date(c.clockStart))}</span>
        {c.answeredAt ? ` · respondida el ${dateTimeFmt.format(new Date(c.answeredAt))}` : ` · espera real ${formatMinutes(c.waitMinutes)}`}
        {c.thanksCandidate ? " · puede ser solo un agradecimiento" : ""}
      </p>
      <p className="text-xs text-gray-600">La conversación entró el {dateTimeFmt.format(new Date(c.createdAt))}</p>
    </li>
  );
}
