"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_LABELS, POPULATION_LABELS } from "@/lib/call-center/metrics/indicators";
import type { AccountsPayload } from "@/lib/call-center/metrics/accounts-types";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import { formatMinutesOrMissing } from "@/lib/call-center/metrics/format";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

type Account = AccountsPayload["accounts"][number];
type Dist = Account["followups"];
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AccountsPayload };

const STATUS_LABELS: Record<Account["status"], string> = { ACTIVA: "Activa", HISTORICA: "Histórica", SIN_CONFIGURAR: "Sin configurar" };

const CLOSURE_ORDER = ["VENTA", "CONSULTA", "PEDIDO_NO_CONCRETADO", "NO_LO_TRABAJAMOS", "SIN_STOCK", "SOLO_BOT", "OTRO"] as const;
const CLOSURE_LABELS: Record<(typeof CLOSURE_ORDER)[number], string> = {
  VENTA: "Venta", CONSULTA: "Consulta resuelta", PEDIDO_NO_CONCRETADO: "Pedido no concretado", NO_LO_TRABAJAMOS: "No se pudo vender · no lo trabajamos", SIN_STOCK: "No se pudo vender · sin stock o discontinuado", SOLO_BOT: "Solo bot", OTRO: "Otro",
};

const accountName = (a: { account: string | null; alias: string | null }) =>
  a.account === null ? "Sin cuenta registrada" : a.alias ? `${a.alias} · cuenta ${a.account}` : `Cuenta ${a.account}`;

/** Bloque "Operadores": por cuenta de Emozion. `today` es el día de Buenos Aires. */
export default function OperatorsPanel({ today }: { today: string }) {
  const [period, setPeriod] = useState<Period>(defaultPeriod(today));
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (p: Period) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/call-center/metrics/accounts?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar las métricas." });
        return;
      }
      setState({ status: "ready", data: body.data as AccountsPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar las métricas. Revisá la conexión." });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  return (
    <section className="mt-4" aria-label="Operadores">
      <PeriodForm today={today} period={period} onChange={setPeriod} />
      <p className="mt-2 text-xs text-gray-600">
        Se muestra por cuenta de Emozion. Una cuenta no es una persona: puede estar prestada o compartida. Hasta {PERIOD_MAX_DAYS} días.
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

function Report({ data }: { data: AccountsPayload }) {
  const t = data.team;
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">Calculado a las {timeFmt.format(new Date(data.generatedAt))}.</p>
      {!data.hasConfig && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Todavía no hay configuración cargada: las cuentas se muestran por número y no se puede separar la actividad por horario.
        </p>
      )}

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">Todo el equipo</h2>
        <div className="mt-2 space-y-1">
          <Line label="Conversaciones atendidas" value={nf.format(t.conversations)} strong />
          <Line label="Con más de una cuenta" value={nf.format(t.conversationsWithSeveralAccounts)} />
          <Line label="Notas internas" value={nf.format(t.privateNotes)} />
        </div>
        <Sub title="Cuando el cliente vuelve a escribir" badge={POPULATION_LABELS.ACTIVIDAD}>
          <DistLines d={t.followups} countLabel="Respondidos" />
          <Line label="Quedaron sin respuesta" value={nf.format(t.followupsUnanswered)} />
        </Sub>
        <Sub title="Primera respuesta" badge={POPULATION_LABELS.ENTRADA}>
          <DistLines d={t.firstResponses} countLabel="Respondidas" />
        </Sub>
        <p className="mt-2 text-xs text-gray-600">
          Cada conversación cuenta una sola vez acá, aunque hayan participado varias cuentas. Los tiempos son de reloj y solo entre los respondidos.
        </p>
        <Evidence />
      </div>

      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        Por cuenta<span className="ml-2 text-xs font-normal text-gray-600">ordenadas por número, no por desempeño</span>
      </h2>
      {data.accounts.length === 0 ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">Ninguna cuenta escribió en el período.</p>
      ) : (
        <ul className="mt-2 grid gap-3 lg:grid-cols-2">
          {data.accounts.map((a) => <AccountCard key={a.account ?? "sin-cuenta"} a={a} />)}
        </ul>
      )}

      {data.supervisionAccounts.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-gray-800">
            Supervisión<span className="ml-2 text-xs font-normal text-gray-600">no son operadores y no suman en el equipo</span>
          </h2>
          <ul className="mt-2 grid gap-3 lg:grid-cols-2">
            {data.supervisionAccounts.map((a) => <AccountCard key={a.account ?? "sin-cuenta"} a={a} />)}
          </ul>
        </>
      )}

      {data.systemAccounts.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-gray-800">
            Cuentas del sistema<span className="ml-2 text-xs font-normal text-gray-600">no son operadores y no suman en el equipo</span>
          </h2>
          <ul className="mt-2 grid gap-3 lg:grid-cols-2">
            {data.systemAccounts.map((a) => <AccountCard key={a.account ?? "sin-cuenta"} a={a} system />)}
          </ul>
        </>
      )}

      {data.closuresWithoutAccount && CLOSURE_ORDER.some((o) => data.closuresWithoutAccount![o] > 0) && (
        <div className="mt-6 max-w-md rounded-md border border-gray-200 px-3 py-2">
          <p className="text-sm font-semibold text-gray-800">Cierres sin cuenta asignada al resolver</p>
          {CLOSURE_ORDER.filter((o) => data.closuresWithoutAccount![o] > 0).map((o) => <Line key={o} label={CLOSURE_LABELS[o]} value={nf.format(data.closuresWithoutAccount![o])} />)}
          <p className="text-[11px] text-gray-500">Conversaciones con resultado de cierre que se resolvieron sin asignado: no se atribuyen a ninguna cuenta.</p>
        </div>
      )}

      {data.activeWithoutMessages.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-gray-800">Cuentas activas sin mensajes en el período</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {data.activeWithoutMessages.map((a) => <li key={a.account}>{accountName(a)}{a.borrowed ? " · prestada" : ""}</li>)}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-600">
        La demora de la primera respuesta es de la cola, no de la cuenta: no se sabe cuánto esperó el caso antes de que alguien lo viera.
        No sirve para comparar cuentas. Las conversaciones resueltas creadas más de {data.lookbackDays} días antes del período no se recorren.
      </p>
    </>
  );
}

function AccountCard({ a, system }: { a: Account; system?: boolean }) {
  const act = a.activity;
  const hours = act.inPublicHours !== null && act.inOperatorHoursOnly !== null && act.outsideAllHours !== null;
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* El alias sale de la configuración. Sin alias, o en una cuenta del sistema, queda el nombre de siempre. */}
        {a.alias && a.account !== null && !system ? (
          <h3 className="text-sm font-semibold text-gray-900">{a.alias}<span className="block text-xs font-normal text-gray-600">cuenta {a.account}</span></h3>
        ) : (
          <h3 className="text-sm font-semibold text-gray-900">{accountName(a)}</h3>
        )}
        <span className="flex shrink-0 flex-wrap gap-1">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{STATUS_LABELS[a.status]}</span>
          {a.borrowed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Prestada</span>}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <Line label="Conversaciones atendidas" value={nf.format(a.conversations)} strong />
        {a.closures && CLOSURE_ORDER.some((o) => a.closures![o] > 0) && (
          <div className="rounded-md border border-gray-200 px-2 py-1">
            <p className="text-xs font-medium text-gray-600">Cierre confirmado por el operador</p>
            {CLOSURE_ORDER.filter((o) => a.closures![o] > 0).map((o) => <Line key={o} label={CLOSURE_LABELS[o]} value={nf.format(a.closures![o])} />)}
            <p className="text-[11px] text-gray-500">Etiqueta de cierre de Emozion. Cuenta las conversaciones que la cuenta tenía asignadas al resolverse.</p>
          </div>
        )}
        <Line label="Mensajes a clientes" value={nf.format(a.publicMessages)} />
        <Line label="Notas internas" value={nf.format(a.privateNotes)} />
      </div>
      <Sub title="Cuando el cliente vuelve a escribir" badge={POPULATION_LABELS.ACTIVIDAD}>
        <DistLines d={a.followups} countLabel="Respondió" />
      </Sub>
      <Sub title="Primera respuesta" badge={POPULATION_LABELS.ENTRADA}>
        <DistLines d={a.firstResponses} countLabel="Dio la primera respuesta" medianLabel="Demora de la cola (la mitad esperó menos de)" />
      </Sub>
      <Sub title="Actividad observada" badge="No es jornada">
        <Line label="Días con mensajes" value={nf.format(act.daysWithActivity)} />
        <Line label="Primer mensaje" value={act.firstMessageAt ? dateTimeFmt.format(new Date(act.firstMessageAt)) : "Sin datos"} />
        <Line label="Último mensaje" value={act.lastMessageAt ? dateTimeFmt.format(new Date(act.lastMessageAt)) : "Sin datos"} />
        {hours ? (
          <>
            <Line label="Mensajes en horario al público" value={nf.format(act.inPublicHours!)} />
            <Line label="Solo en horario de operadores" value={nf.format(act.inOperatorHoursOnly!)} />
            <Line label="Fuera de horario" value={nf.format(act.outsideAllHours!)} />
          </>
        ) : (
          <Line label="Mensajes por horario" value="No disponible" />
        )}
      </Sub>
      <Evidence />
    </li>
  );
}

function DistLines({ d, countLabel, medianLabel = "La mitad esperó menos de" }: { d: Dist; countLabel: string; medianLabel?: string }) {
  return (
    <>
      <Line label={countLabel} value={nf.format(d.n)} />
      <Line label={medianLabel} value={formatMinutesOrMissing(d.median)} />
      <Line label="9 de cada 10 esperaron menos de" value={formatMinutesOrMissing(d.p90)} />
    </>
  );
}

function Sub({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-gray-700">{title}</h4>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{badge}</span>
      </div>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-700">{label}</span>
      <span className={`shrink-0 tabular-nums text-gray-900 ${strong ? "text-lg font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function Evidence() {
  return <p className="mt-2 text-[11px] text-gray-500">{EVIDENCE_LABELS.MEDIDO}</p>;
}
