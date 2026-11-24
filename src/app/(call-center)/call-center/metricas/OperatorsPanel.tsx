"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { EVIDENCE_LABELS, POPULATION_LABELS } from "@/lib/call-center/metrics/indicators";
import type { AccountsPayload, OperatorCase, OperatorCaseKind, OperatorCasesPayload } from "@/lib/call-center/metrics/accounts-types";
import { COMPARISON_MIN_ANSWERED } from "@/lib/call-center/metrics/comparison";
import { PERIOD_MAX_DAYS } from "@/lib/call-center/metrics/period";
import { formatMinutes, formatMinutesOrMissing, formatRatio } from "@/lib/call-center/metrics/format";
import PeriodForm, { defaultPeriod, type Period } from "./PeriodForm";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const cutFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

type Account = AccountsPayload["accounts"][number];
type Dist = Account["followups"];
type Closures = NonNullable<Account["closures"]>;
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AccountsPayload };
/** Detalle de casos abierto: el indicador y, si corresponde, la cuenta. */
type Picked = { kind: OperatorCaseKind; account: string | null; name: string | null };

// "Activa" describe la configuración, no que la cuenta esté conectada ahora.
const STATUS_LABELS: Record<Account["status"], string> = { ACTIVA: "Cuenta habilitada", HISTORICA: "Histórica", SIN_CONFIGURAR: "Sin configurar" };

const CLOSURE_ORDER = ["VENTA", "CONSULTA", "PEDIDO_NO_CONCRETADO", "NO_LO_TRABAJAMOS", "SIN_STOCK", "SOLO_BOT", "OTRO"] as const;
const CLOSURE_LABELS: Record<(typeof CLOSURE_ORDER)[number], string> = {
  VENTA: "Venta", CONSULTA: "Consulta resuelta", PEDIDO_NO_CONCRETADO: "Pedido no concretado", NO_LO_TRABAJAMOS: "No se pudo vender · no lo trabajamos", SIN_STOCK: "No se pudo vender · sin stock o discontinuado", SOLO_BOT: "Solo bot", OTRO: "Otro",
};

const CASE_LABELS: Record<OperatorCaseKind, string> = {
  slow_followups: "Respuestas posteriores que más tardaron",
  unanswered_blocks: "Bloques del cliente sin respuesta",
  several_accounts: "Conversaciones atendidas por más de una cuenta",
  first_response_later_day: "Primeras respuestas a conversaciones que habían entrado un día anterior",
};

const accountName = (a: { account: string | null; alias: string | null }) =>
  a.account === null ? "Sin cuenta registrada" : a.alias ? `${a.alias} · cuenta ${a.account}` : `Cuenta ${a.account}`;
const cases = (n: number) => `${nf.format(n)} ${n === 1 ? "caso" : "casos"}`;
/** El 90% solo con muestra suficiente: con pocos casos describe esos casos, no cómo responde la cuenta. */
const p90Text = (d: Dist) => (d.n === 0 ? "Sin datos" : d.n < COMPARISON_MIN_ANSWERED ? `Muestra pequeña: ${cases(d.n)}` : formatMinutesOrMissing(d.p90));

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
      {state.status === "ready" && <Report key={`${period.from}|${period.to}`} data={state.data} period={period} />}
    </section>
  );
}

function Report({ data, period }: { data: AccountsPayload; period: Period }) {
  const t = data.team;
  // Se cierra solo al cambiar de período (el informe se vuelve a montar).
  const [picked, setPicked] = useState<Picked | null>(null);
  const open = (kind: OperatorCaseKind, account: string | null = null, name: string | null = null) =>
    setPicked(picked && picked.kind === kind && picked.account === account ? null : { kind, account, name });
  return (
    <>
      <p className="mt-4 text-xs text-gray-600">Corte: {cutFmt.format(new Date(data.generatedAt))}.</p>
      {!data.hasConfig && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Todavía no hay configuración cargada: las cuentas se muestran por número y no se puede separar la actividad por horario.
        </p>
      )}

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">Todo el equipo</h2>
        <div className="mt-2 space-y-1">
          <Line label="Conversaciones atendidas" value={nf.format(t.conversations)} strong />
          <Line label="Atendidas por más de una cuenta" value={nf.format(t.conversationsWithSeveralAccounts)}
            action={t.conversationsWithSeveralAccounts > 0 ? { text: "Ver los casos", onClick: () => open("several_accounts") } : undefined} />
          <Line label="Notas internas" value={nf.format(t.privateNotes)} />
        </div>
        <Sub title="Respuestas posteriores: cuando el cliente vuelve a escribir" badge={POPULATION_LABELS.ACTIVIDAD}>
          <Line label="Bloques del cliente respondidos" value={nf.format(t.followups.n)}
            action={t.followups.n > 0 ? { text: "Ver los que más tardaron", onClick: () => open("slow_followups") } : undefined} />
          <Line label="La mitad esperó menos de" value={formatMinutesOrMissing(t.followups.median)} />
          <Line label="El 90% esperó menos de" value={p90Text(t.followups)} />
          <Line label="Bloques sin respuesta" value={nf.format(t.followupsUnanswered)}
            action={t.followupsUnanswered > 0 ? { text: "Revisar los casos", onClick: () => open("unanswered_blocks") } : undefined} />
          <p className="text-xs text-gray-600">
            Los bloques sin respuesta requieren revisión: no todos piden contestación (un &quot;gracias&quot; final, por ejemplo), y no se atribuyen al último operador que escribió.
          </p>
        </Sub>
        <Sub title="Primera respuesta" badge={POPULATION_LABELS.ENTRADA}>
          <Line label="Conversaciones que recibieron la primera respuesta" value={nf.format(t.firstResponses.n)} />
          <Line label="De esas, habían entrado un día anterior" value={nf.format(t.firstResponsesLaterDay)}
            action={t.firstResponsesLaterDay > 0 ? { text: "Ver los casos", onClick: () => open("first_response_later_day") } : undefined} />
          <p className="text-xs text-gray-600">La espera de estos casos está en &quot;Atención y demoras&quot;: es espera de la cola, no de una cuenta.</p>
        </Sub>
        <p className="mt-2 text-xs text-gray-600">
          Cada conversación cuenta una sola vez acá, aunque hayan participado varias cuentas. Los tiempos son de reloj y solo entre los respondidos.
        </p>
        <Evidence />
      </div>

      {picked && <OperatorCases key={`${picked.kind}|${picked.account ?? ""}`} picked={picked} period={period} onClose={() => setPicked(null)} />}

      <h2 className="mt-6 text-sm font-semibold text-gray-800">
        Por cuenta<span className="ml-2 text-xs font-normal text-gray-600">ordenadas por número, no por desempeño</span>
      </h2>
      <p className="mt-1 text-xs text-gray-700">
        Una conversación atendida por varias cuentas aparece en cada una: las filas no se suman para obtener el total del equipo.
      </p>
      {data.accounts.length === 0 ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm text-gray-600">Ninguna cuenta escribió en el período.</p>
      ) : (
        <AccountsTable accounts={data.accounts} lookbackDays={data.lookbackDays} onOpen={open} />
      )}
      <p className="mt-2 text-xs text-gray-600">
        Cómo leer la tabla: dos cuentas pueden tener la misma mediana y un 90% muy distinto. Esa diferencia sirve para buscar casos puntuales, no para concluir que una atiende mejor.
        Los tiempos de las respuestas posteriores todavía no tienen un objetivo definido: por eso no llevan color. La meta de 15 minutos es de la primera atención y no se traslada acá.
      </p>

      {data.supervisionAccounts.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-gray-800">
            Supervisión<span className="ml-2 text-xs font-normal text-gray-600">no son operadores y no suman en el equipo</span>
          </h2>
          <AccountsTable accounts={data.supervisionAccounts} lookbackDays={data.lookbackDays} onOpen={open} />
        </>
      )}

      {data.systemAccounts.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-gray-800">
            Cuentas del sistema<span className="ml-2 text-xs font-normal text-gray-600">no son operadores y no suman en el equipo</span>
          </h2>
          <AccountsTable accounts={data.systemAccounts} lookbackDays={data.lookbackDays} onOpen={open} system />
        </>
      )}

      {data.closures && <TeamClosures c={data.closures} />}

      {data.activeWithoutMessages.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-gray-800">Cuentas habilitadas sin mensajes en el período</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {data.activeWithoutMessages.map((a) => <li key={a.account}>{accountName(a)}{a.borrowed ? " · prestada" : ""}</li>)}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-600">Las conversaciones resueltas creadas más de {data.lookbackDays} días antes del período no se recorren.</p>
    </>
  );
}

const COLS = "md:grid md:grid-cols-[minmax(0,2.2fr)_repeat(6,minmax(0,1fr))] md:items-center md:gap-3";

/** Una fila por cuenta para comparar; el resto queda en "Ver detalle". En el celular, tarjetas cortas. */
function AccountsTable({ accounts, lookbackDays, onOpen, system }: {
  accounts: Account[]; lookbackDays: number; onOpen: (kind: OperatorCaseKind, account: string | null, name: string | null) => void; system?: boolean;
}) {
  const head = "text-right text-[11px] font-medium leading-tight text-gray-600";
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white">
      <div className={`hidden border-b border-gray-200 px-3 py-2 ${COLS}`} aria-hidden>
        <span className="text-[11px] font-medium text-gray-600">Cuenta</span>
        <span className={head}>Conversaciones atendidas</span>
        <span className={head}>Dio la primera respuesta</span>
        <span className={head}>Respuestas posteriores</span>
        <span className={head}>Mediana</span>
        <span className={head}>El 90% en menos de</span>
        <span className={head}>Días con actividad</span>
      </div>
      <ul>
        {accounts.map((a) => <AccountRow key={a.account ?? "sin-cuenta"} a={a} lookbackDays={lookbackDays} onOpen={onOpen} system={system} />)}
      </ul>
    </div>
  );
}

function Cell({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
      <span className="text-xs text-gray-600 md:hidden">{label}</span>
      <span className={`tabular-nums text-gray-900 ${small ? "text-xs" : "text-sm font-semibold"}`}>{value}</span>
    </div>
  );
}

function AccountRow({ a, onOpen, system }: {
  a: Account; lookbackDays: number; onOpen: (kind: OperatorCaseKind, account: string | null, name: string | null) => void; system?: boolean;
}) {
  const act = a.activity;
  const hours = act.inPublicHours !== null && act.inOperatorHoursOnly !== null && act.outsideAllHours !== null;
  const name = a.alias && a.account !== null && !system ? a.alias : accountName(a);
  const smallP90 = a.followups.n > 0 && a.followups.n < COMPARISON_MIN_ANSWERED;
  return (
    <li className="border-b border-gray-100 px-3 py-2 last:border-0">
      <div className={COLS}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-gray-900">
            {name}{a.alias && a.account !== null && !system ? <span className="ml-1 text-xs font-normal text-gray-600">cuenta {a.account}</span> : null}
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">{STATUS_LABELS[a.status]}</span>
          {a.borrowed && <span className="rounded-full border border-gray-400 px-2 py-0.5 text-[11px] font-medium text-gray-800">Prestada</span>}
        </div>
        <div className="mt-1 space-y-0.5 md:contents">
          <Cell label="Conversaciones atendidas" value={nf.format(a.conversations)} />
          <Cell label="Dio la primera respuesta" value={nf.format(a.firstResponses.n)} />
          <Cell label="Respuestas posteriores" value={nf.format(a.followups.n)} />
          <Cell label="Mediana de las posteriores" value={formatMinutesOrMissing(a.followups.median)} />
          <Cell label="El 90% en menos de" value={p90Text(a.followups)} small={smallP90} />
          <Cell label="Días con actividad" value={nf.format(act.daysWithActivity)} />
        </div>
      </div>
      <details className="mt-1">
        <summary className="inline-flex min-h-[32px] cursor-pointer items-center text-xs font-medium text-[#1E2D5A]">Ver detalle</summary>
        <div className="grid gap-x-8 gap-y-3 pb-2 pt-1 md:grid-cols-2">
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-gray-700">Mensajes</h4>
            <Line label="Mensajes a clientes" value={nf.format(a.publicMessages)} />
            <Line label="Notas internas" value={nf.format(a.privateNotes)} />
            <Line label="Intervenciones de respuesta" value={nf.format(a.followups.n)} />
            <p className="text-xs text-gray-600">
              Una intervención es una respuesta a un bloque de mensajes del cliente. Una misma conversación puede tener varias: por eso pueden ser más que las conversaciones atendidas.
            </p>
            {hours ? (
              <>
                <Line label="Mensajes a clientes en horario al público" value={nf.format(act.inPublicHours!)} />
                <Line label="Solo en horario de operadores" value={nf.format(act.inOperatorHoursOnly!)} />
                <Line label="Fuera de horario" value={nf.format(act.outsideAllHours!)} />
                <p className="text-xs text-gray-600">El desglose por horario suma los mensajes a clientes; las notas internas no entran.</p>
              </>
            ) : (
              <Line label="Mensajes por horario" value="No disponible" />
            )}
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-gray-700">Actividad observada <span className="font-normal text-gray-600">· no es jornada</span></h4>
            <Line label="Primer mensaje del período" value={act.firstMessageAt ? dateTimeFmt.format(new Date(act.firstMessageAt)) : "Sin datos"} />
            <Line label="Último mensaje del período" value={act.lastMessageAt ? dateTimeFmt.format(new Date(act.lastMessageAt)) : "Sin datos"} />
            <p className="text-xs text-gray-600">Entre el primer y el último mensaje no hay tiempo trabajado medido: no se calcula productividad por hora.</p>
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-gray-700">Espera acumulada de los casos que respondió</h4>
            <Line label="Primeras respuestas que dio" value={nf.format(a.firstResponses.n)} />
            <Line label="La mitad de esos casos había esperado" value={formatMinutesOrMissing(a.firstResponses.median)} />
            <Line label="Habían entrado un día anterior" value={nf.format(a.firstResponsesLaterDay)} />
            <p className="text-xs text-gray-600">
              Es la demora de la cola, no de la cuenta: no se sabe cuánto esperó el caso antes de que alguien lo viera. Atender un pedido de la noche anterior
              sube este número justamente por ayudar a bajar el atraso. No sirve para comparar cuentas.
            </p>
          </div>
          {a.closures && a.closures.closed > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-gray-700">Cierres del período que tenía asignados</h4>
              <ClosureLines c={a.closures} />
              <p className="text-xs text-gray-600">Por fecha de cierre y por la cuenta asignada en ese momento. Escribir en una conversación no es cerrarla.</p>
            </div>
          )}
          {a.account !== null && !system && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 md:col-span-2">
              {a.followups.n > 0 && <CaseLink text="Ver sus respuestas posteriores que más tardaron" onClick={() => onOpen("slow_followups", a.account, name)} />}
              <CaseLink text="Ver conversaciones que compartió con otras cuentas" onClick={() => onOpen("several_accounts", a.account, name)} />
              {a.firstResponsesLaterDay > 0 && <CaseLink text="Ver primeras respuestas a conversaciones de días anteriores" onClick={() => onOpen("first_response_later_day", a.account, name)} />}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function CaseLink({ text, onClick }: { text: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-[32px] items-center text-xs font-medium text-[#1E2D5A] underline">{text}</button>;
}

function ClosureLines({ c }: { c: Closures }) {
  return (
    <>
      <Line label="Conversaciones cerradas" value={nf.format(c.closed)} />
      {CLOSURE_ORDER.filter((o) => c.byOutcome[o] > 0).map((o) => <Line key={o} label={CLOSURE_LABELS[o]} value={nf.format(c.byOutcome[o])} />)}
      {c.untyped > 0 && <Line label="Sin tipo de cierre" value={nf.format(c.untyped)} />}
      {c.ambiguous > 0 && <Line label="Resultado ambiguo" value={nf.format(c.ambiguous)} />}
    </>
  );
}

/** Cierres del período de todo el equipo, con la cobertura a la vista. */
function TeamClosures({ c }: { c: NonNullable<AccountsPayload["closures"]> }) {
  const t = c.total;
  const low = c.coverage !== null && c.coverage < 0.5;
  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">Cierres del período<span className="ml-2 text-xs font-normal text-gray-600">por fecha de cierre</span></h2>
      {t.closed === 0 ? <p className="mt-1 text-sm text-gray-600">No se cerró ninguna conversación en el período.</p> : (
        <>
          <p className={`mt-1 text-sm ${low ? "font-medium text-gray-900" : "text-gray-800"}`}>
            {nf.format(t.closed - t.untyped - t.ambiguous)} de {nf.format(t.closed)} cierres tienen un resultado legible ({formatRatio(c.coverage)}).
            {low ? " Dato parcial: menos de la mitad tiene tipo de cierre, así que el reparto por resultado no describe al conjunto." : ""}
          </p>
          <div className="mt-2 grid gap-x-8 gap-y-3 md:grid-cols-3">
            <div className="space-y-1"><h3 className="text-xs font-semibold text-gray-700">Todos</h3><ClosureLines c={t} /></div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-gray-700">Sin cuenta asignada al resolver</h3>
              <ClosureLines c={c.withoutAccount} />
              <p className="text-xs text-gray-600">No se atribuyen a ninguna cuenta.</p>
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-gray-700">Con el bot como asignado</h3>
              <ClosureLines c={c.byBot} />
              <p className="text-xs text-gray-600">Ninguna persona las había tomado al resolverse.</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            Cada conversación cuenta una vez, por su último cierre del período. El resultado es el tipo de cierre guardado en ese momento, leído con las etiquetas de cierre vigentes ese día.
            &quot;Resultado ambiguo&quot;: sin tipo guardado y con etiquetas de cierre que dicen cosas distintas; no se elige una. Las correcciones de estado contra Emozion no cuentan como cierres.
          </p>
        </>
      )}
      <Evidence />
    </div>
  );
}

type CasesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OperatorCasesPayload };

/** Lista de conversaciones detrás de un número de "Operadores". Se pide al abrirla. */
function OperatorCases({ picked, period, onClose }: { picked: Picked; period: Period; onClose: () => void }) {
  const [state, setState] = useState<CasesState>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const account = picked.account !== null ? `&account=${encodeURIComponent(picked.account)}` : "";
      const res = await fetch(`/api/call-center/metrics/accounts/cases?kind=${picked.kind}&from=${period.from}&to=${period.to}${account}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setState({ status: "error", message: body?.error ?? "No se pudieron cargar los casos." });
        return;
      }
      setState({ status: "ready", data: body.data as OperatorCasesPayload });
    } catch {
      setState({ status: "error", message: "No se pudieron cargar los casos. Revisá la conexión." });
    }
  }, [picked.kind, picked.account, period.from, period.to]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-3 rounded-lg border border-[#1E2D5A] bg-white p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Casos: {CASE_LABELS[picked.kind]}{picked.name ? ` · ${picked.name}` : ""}
          {state.status === "ready" ? ` (${nf.format(state.data.total)})` : ""}
        </h3>
        <button type="button" onClick={onClose} className="shrink-0 text-xs font-medium text-[#1E2D5A] underline">Cerrar</button>
      </div>
      {picked.kind === "unanswered_blocks" && (
        <p className="mt-1 text-xs text-gray-700">Para revisar: no todos piden contestación, y no se atribuyen al último operador que escribió.</p>
      )}
      {state.status === "loading" && <p className="mt-2 text-sm text-gray-600">Cargando…</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {state.message} <button type="button" onClick={load} className="font-medium underline">Reintentar</button>
        </p>
      )}
      {state.status === "ready" && (
        state.data.cases.length === 0 ? <p className="mt-2 text-sm text-gray-600">No hay casos en el período.</p> : (
          <>
            {state.data.total > state.data.cases.length && <p className="mt-1 text-xs text-gray-700">Se muestran los primeros {nf.format(state.data.cases.length)}.</p>}
            <ul className="mt-2 grid gap-2 lg:grid-cols-2">
              {state.data.cases.map((c) => <CaseRow key={`${c.conversationId}|${c.at}`} c={c} kind={picked.kind} />)}
            </ul>
          </>
        )
      )}
    </div>
  );
}

function CaseRow({ c, kind }: { c: OperatorCase; kind: OperatorCaseKind }) {
  const tag = "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800";
  const when = dateTimeFmt.format(new Date(c.at));
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-semibold tabular-nums text-gray-900">
          {c.waitMinutes !== null ? formatMinutes(c.waitMinutes) : `${nf.format(c.accounts.length)} cuentas`}
        </p>
        <Link href={`/call-center/${c.conversationId}`} className="inline-flex min-h-[36px] shrink-0 items-center text-xs font-medium text-[#1E2D5A] hover:underline">
          Ver conversación →
        </Link>
      </div>
      {(c.accounts.length > 0 || c.order) && (
        <p className="mt-1 flex flex-wrap gap-1.5">
          {c.accounts.map((a) => <span key={a} className={tag}>{a}</span>)}
          {c.order && <span className={tag}>Pedido completo</span>}
        </p>
      )}
      <p className="mt-1 text-xs text-gray-700">
        {kind === "slow_followups" ? `El cliente volvió a escribir el ${when}; esa fue la espera hasta la respuesta.`
          : kind === "unanswered_blocks" ? `El cliente escribió el ${when} y no hubo respuesta después. Espera de reloj hasta ahora.`
          : kind === "several_accounts" ? `Primer mensaje de operador del período: ${when}.`
          : `Salió del bot el ${when}; esa fue la espera de reloj hasta la primera respuesta.`}
      </p>
    </li>
  );
}

function Sub({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{badge}</span>
      </div>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  );
}

function Line({ label, value, strong, action }: { label: string; value: string; strong?: boolean; action?: { text: string; onClick: () => void } }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-700">
        {label}
        {action && <button type="button" onClick={action.onClick} className="ml-2 text-xs font-medium text-[#1E2D5A] underline">{action.text}</button>}
      </span>
      <span className={`shrink-0 tabular-nums text-gray-900 ${strong ? "text-lg font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function Evidence() {
  return <p className="mt-2 text-[11px] text-gray-500">{EVIDENCE_LABELS.MEDIDO}</p>;
}
