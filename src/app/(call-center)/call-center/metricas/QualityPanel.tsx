"use client";

import type { ReactNode } from "react";
import { EVIDENCE_LABELS } from "@/lib/call-center/metrics/indicators";
import { useNowData } from "./useNowData";

const TZ = "America/Argentina/Buenos_Aires";
const nf = new Intl.NumberFormat("es-AR");
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: TZ });

const when = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : "No disponible");

/** Pestaña "Calidad de datos": lo que ayuda a leer los números, no la cola del momento. */
export default function QualityPanel() {
  const { state, reload } = useNowData();

  if (state.status === "loading") return <p className="mt-6 text-sm text-gray-500">Cargando…</p>;
  if (state.status === "error") {
    return (
      <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.message}{" "}
        <button type="button" onClick={reload} className="font-medium underline">Reintentar</button>
      </div>
    );
  }

  const q = state.data.quality;
  const closed = q.closedUnanswered;
  const since = dayFmt.format(new Date(q.closedSince));
  const ages: Array<[string, number]> = [
    ["Menos de 24 horas", closed.byAge.lt24h], ["Entre 24 y 72 horas", closed.byAge.h24to72],
    ["Entre 3 y 30 días", closed.byAge.d3to30], ["Más de 30 días", closed.byAge.gt30d],
  ];

  return (
    <section className="mt-4 space-y-3" aria-label="Calidad de datos">
      <p className="text-xs text-gray-500">Estos números ayudan a leer las métricas. No son la cola del momento.</p>

      <Box title="¿Están llegando los datos?" evidence="Medido">
        <Line label="Último aviso de Emozion" value={when(q.freshness.lastWebhookAt)} />
        <Line label="Último mensaje guardado" value={when(q.freshness.lastMessageAt)} />
        <Note>Fuera del horario de atención es normal que pasen varios minutos sin avisos.</Note>
      </Box>

      <Box title="Cerradas con el último mensaje del cliente" evidence="Medido">
        <Line label={`Desde el ${since}`} value={nf.format(closed.total)} strong />
        <Line label="Nunca les respondió una persona" value={nf.format(closed.neverHuman)} />
        <Line label="Les respondieron y volvieron a escribir" value={nf.format(closed.awaitingNext)} />
        {ages.map(([label, n]) => <Line key={label} label={`El cliente escribió hace ${label.toLowerCase()}`} value={nf.format(n)} />)}
        <Line label={`Anteriores al ${since}`} value={q.closedBefore ? nf.format(q.closedBefore.total) : "No disponible"} strong />
        <Note>Cuenta todas, sin mirar qué escribió el cliente: la mayoría son agradecimientos. Las que pedían algo están en &quot;Cerradas sin responder&quot;, en Ahora.</Note>
      </Box>

      <Box title="Probables agradecimientos" evidence="Detectado">
        <Line label="En abiertas" value={nf.format(q.openWaiting.thanksCandidates)} />
        <Line label="En cerradas" value={nf.format(closed.thanksCandidates)} />
        <Note>Mensajes cortos de un cliente al que se le cerró otra conversación en las 24 horas previas. Es una estimación: siguen contando como pendientes en las demoras.</Note>
      </Box>

      <Box title="No son clientes" evidence={q.notCustomers === null ? "No disponible" : "Detectado"}>
        <Line label={`Últimos ${q.notCustomersDays} días`} value={q.notCustomers === null ? "No disponible" : nf.format(q.notCustomers)} strong />
        <Note>Proveedores, currículums y publicidad. No entran en &quot;Cerradas sin responder&quot;.</Note>
      </Box>

      <Box title="Sin registro de cuándo salieron del bot" evidence="Medido">
        <Line label="En abiertas" value={nf.format(q.openWaiting.noBotExit)} />
        <Line label="En cerradas" value={nf.format(closed.noBotExit)} />
        <Note>Sin ese dato no se puede medir la demora desde que la conversación pasó a una persona.</Note>
      </Box>

      <Box title="Límites de la detección" evidence={EVIDENCE_LABELS.DETECTADO}>
        <Note>
          &quot;Cerradas sin responder&quot; busca preguntas, pedidos y adjuntos. No toma los reclamos escritos sin signo de pregunta
          (por ejemplo, un cliente que avisa que le corresponde otro descuento). Un agradecimiento con una foto sí entra, porque la foto puede ser una receta o un comprobante.
        </Note>
        <Note>Las abiertas con más de {state.data.windowHours} horas de espera ({nf.format(state.data.stale.total)}) no cuentan como conversaciones esperando: están en &quot;Casos antiguos por revisar&quot;.</Note>
      </Box>
    </section>
  );
}

function Box({ title, evidence, children }: { title: string; evidence: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <div className="mt-2 space-y-1">{children}</div>
      <p className="mt-2 text-[11px] text-gray-400">{evidence}</p>
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

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-gray-500">{children}</p>;
}
