"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLOSURE_OUTCOMES, CONFIG_SCHEMA_VERSION, DEFAULT_CRITICAL_WAIT_MINUTES, DEFAULT_LAST_RESPONSE_WARNING_MINUTES, DEFAULT_WINDOW_WARNING_HOURS, ISO_WEEKDAYS, criticalWaitMinutesOf, lastResponseWarningMinutesOf, parseConfigData, windowWarningHoursOf,
  type CallCenterMetricsConfigData, type ClosureOutcome, type ConfigAccount, type IsoWeekday,
} from "@/lib/call-center/metrics/config-schema";
import {
  WEEKDAY_LABELS, emptyScheduleText, isValidDayISO, proposeAccount, scheduleToText, textToSchedule,
} from "@/lib/call-center/metrics/config-form";
import type { KnownAccount, KnownVendor } from "@/lib/call-center/metrics/config-service";

type ScheduleText = Record<IsoWeekday, string>;
const CLOSURE_OUTCOME_LABELS: Record<ClosureOutcome, string> = {
  VENTA: "Venta", CONSULTA: "Consulta resuelta", PEDIDO_NO_CONCRETADO: "Pedido no concretado", NO_LO_TRABAJAMOS: "No se pudo vender · no lo trabajamos", SIN_STOCK: "No se pudo vender · sin stock o discontinuado",
  SOLO_BOT: "Solo bot, sin atención de una persona", OTRO: "Otro",
};

const vendorKey = (branchId: string, code: string) => `${branchId}|${code}`;

/** Cuentas del formulario: las de la versión base más las que escribieron y no están en ella. */
function initialAccounts(base: CallCenterMetricsConfigData | null, known: KnownAccount[]): ConfigAccount[] {
  const fromBase = base?.accounts ?? [];
  const have = new Set(fromBase.map((a) => a.externalId));
  // Las que no están en la versión base se proponen según lo que se ve en los datos (proposeAccount).
  const extra = known.filter((k) => !have.has(k.externalId)).map(proposeAccount);
  return [...fromBase, ...extra];
}

export default function ConfigForm({
  today, base, options,
}: {
  today: string;
  base: { validFrom: string; data: CallCenterMetricsConfigData } | null;
  options: { accounts: KnownAccount[]; vendors: KnownVendor[]; branches: Array<{ id: string; name: string }> };
}) {
  const router = useRouter();
  const [validFrom, setValidFrom] = useState(today);
  const [publicText, setPublicText] = useState<ScheduleText>(base ? scheduleToText(base.data.publicHours) : emptyScheduleText());
  const [operatorText, setOperatorText] = useState<ScheduleText>(base ? scheduleToText(base.data.operatorHours) : emptyScheduleText());
  const [goal, setGoal] = useState(String(base?.data.firstResponseGoalMinutes ?? ""));
  const [critical, setCritical] = useState(String(base ? criticalWaitMinutesOf(base.data) : DEFAULT_CRITICAL_WAIT_MINUTES));
  const [windowWarning, setWindowWarning] = useState(String(base ? windowWarningHoursOf(base.data) : DEFAULT_WINDOW_WARNING_HOURS));
  const [lastResponseWarning, setLastResponseWarning] = useState(String(base ? lastResponseWarningMinutesOf(base.data) : DEFAULT_LAST_RESPONSE_WARNING_MINUTES));
  const [accounts, setAccounts] = useState<ConfigAccount[]>(() => initialAccounts(base?.data ?? null, options.accounts));
  const [newAccount, setNewAccount] = useState("");
  const [vendors, setVendors] = useState<Set<string>>(
    () => new Set((base?.data.callCenterVendors ?? []).map((v) => vendorKey(v.branchId, v.code))),
  );
  // Cuenta de operador asociada a cada vendedor marcado (clave sucursal|código → externalId).
  const [vendorAccounts, setVendorAccounts] = useState<Record<string, string>>(
    () => Object.fromEntries((base?.data.callCenterVendors ?? []).flatMap((v) => (v.accountId ? [[vendorKey(v.branchId, v.code), v.accountId]] : []))),
  );
  // Horario de pedidos por sucursal: retiro y envíos, cada uno con su texto por día.
  const [orderHours, setOrderHours] = useState<Array<{ branchId: string; pickup: ScheduleText; delivery: ScheduleText }>>(
    () => (base?.data.branchOrderHours ?? []).map((b) => ({ branchId: b.branchId, pickup: scheduleToText(b.pickup), delivery: scheduleToText(b.delivery) })),
  );
  const [newOrderBranch, setNewOrderBranch] = useState("");
  // Etiquetas de cierre de Emozion y el resultado que significa cada una.
  const [closureLabels, setClosureLabels] = useState<Array<{ label: string; outcome: ClosureOutcome }>>(() => [...(base?.data.closureLabels ?? [])]);
  const branchName = (id: string) => options.branches.find((b) => b.id === id)?.name ?? "Sucursal que ya no existe";
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const knownByAccount = useMemo(() => new Map(options.accounts.map((a) => [a.externalId, a])), [options.accounts]);

  // Vendedores por sucursal. Los que están en la versión base y ya no figuran en las ventas
  // recientes se listan igual, para que desmarcarlos sea una decisión y no un efecto de guardar.
  const vendorGroups = useMemo(() => {
    const groups = new Map<string, { branchName: string; items: Array<{ key: string; code: string; name: string | null; recent: boolean }> }>();
    const add = (branchId: string, branchName: string, code: string, name: string | null, recent: boolean) => {
      const g = groups.get(branchId) ?? { branchName, items: [] };
      if (!g.items.some((i) => i.code === code)) g.items.push({ key: vendorKey(branchId, code), code, name, recent });
      groups.set(branchId, g);
    };
    for (const v of options.vendors) add(v.branchId, v.branchName, v.code, v.name, true);
    for (const v of base?.data.callCenterVendors ?? []) {
      const branchName = options.vendors.find((o) => o.branchId === v.branchId)?.branchName ?? "Sucursal sin ventas recientes";
      add(v.branchId, branchName, v.code, null, false);
    }
    return [...groups.entries()].sort((a, b) => a[1].branchName.localeCompare(b[1].branchName, "es"));
  }, [options.vendors, base]);

  const updateAccount = (i: number, patch: Partial<ConfigAccount>) =>
    setAccounts((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  function addAccount() {
    const id = newAccount.trim();
    if (!id || /\s/.test(id) || accounts.some((a) => a.externalId === id)) return;
    setAccounts((list) => [...list, { externalId: id, alias: null, active: true, borrowed: false, historical: false, system: false }]);
    setNewAccount("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(null);
    const problems: string[] = [];
    if (!isValidDayISO(validFrom)) problems.push("Elegí la fecha desde la que rige.");
    const pub = textToSchedule(publicText);
    const ops = textToSchedule(operatorText);
    if (!pub.ok) for (const [d, m] of Object.entries(pub.errors)) problems.push(`Horario público, ${WEEKDAY_LABELS[d as IsoWeekday]}: ${m}`);
    if (!ops.ok) for (const [d, m] of Object.entries(ops.errors)) problems.push(`Horario de operadores, ${WEEKDAY_LABELS[d as IsoWeekday]}: ${m}`);
    const goalNumber = Number(goal);
    if (!/^\d+$/.test(goal.trim()) || goalNumber < 1) problems.push("La meta tiene que ser un número entero de minutos, mayor que cero.");
    const criticalNumber = Number(critical);
    if (!/^\d+$/.test(critical.trim()) || criticalNumber <= goalNumber) problems.push("La demora crítica tiene que ser un número entero de minutos, mayor que la meta.");
    const branchOrderHours: NonNullable<CallCenterMetricsConfigData["branchOrderHours"]> = [];
    for (const b of orderHours) {
      const pickup = textToSchedule(b.pickup);
      const delivery = textToSchedule(b.delivery);
      if (!pickup.ok) for (const [d, msg] of Object.entries(pickup.errors)) problems.push(`Pedidos para retirar, ${branchName(b.branchId)}, ${WEEKDAY_LABELS[d as IsoWeekday]}: ${msg}`);
      if (!delivery.ok) for (const [d, msg] of Object.entries(delivery.errors)) problems.push(`Pedidos con envío, ${branchName(b.branchId)}, ${WEEKDAY_LABELS[d as IsoWeekday]}: ${msg}`);
      if (pickup.ok && delivery.ok) branchOrderHours.push({ branchId: b.branchId, pickup: pickup.schedule, delivery: delivery.schedule });
    }
    const warningNumber = Number(windowWarning);
    if (!/^\d+$/.test(windowWarning.trim()) || warningNumber < 1 || warningNumber > 23) problems.push("El aviso de ventana por vencer tiene que ser un número entero de horas, entre 1 y 23.");
    const lastResponseNumber = Number(lastResponseWarning);
    if (!/^\d+$/.test(lastResponseWarning.trim()) || lastResponseNumber < 1 || lastResponseNumber > 1440) problems.push("El aviso de última respuesta tiene que ser un número entero de minutos, entre 1 y 1440.");
    if (problems.length > 0 || !pub.ok || !ops.ok) { setErrors(problems); return; }

    const data: CallCenterMetricsConfigData = {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      publicHours: pub.schedule,
      operatorHours: ops.schedule,
      firstResponseGoalMinutes: goalNumber,
      criticalWaitMinutes: criticalNumber,
      windowWarningHours: warningNumber,
      lastResponseWarningMinutes: lastResponseNumber,
      // Sin sucursales cargadas el campo no se guarda, como en las versiones anteriores.
      ...(branchOrderHours.length > 0 ? { branchOrderHours } : {}),
      ...(closureLabels.some((c) => c.label.trim()) ? { closureLabels: closureLabels.filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim(), outcome: c.outcome })) } : {}),
      // system se guarda siempre explícito, aunque la versión base no lo tuviera.
      accounts: accounts.map((a) => ({ ...a, alias: a.alias && a.alias.trim() ? a.alias.trim() : null, system: a.system === true, ...(a.supervision === true ? { supervision: true } : {}) })),
      callCenterVendors: [...vendors].map((k) => {
        const [branchId, ...rest] = k.split("|");
        // La asociación se guarda solo si esa cuenta sigue en la lista de cuentas.
        const accountId = vendorAccounts[k];
        const known = accountId && accounts.some((a) => a.externalId === accountId);
        return { branchId, code: rest.join("|"), ...(known ? { accountId } : {}) };
      }),
    };
    // Misma validación que hace el servidor, para mostrar el problema antes de enviar.
    const check = parseConfigData(data);
    if (!check.ok) { setErrors(check.errors); return; }

    setErrors([]);
    setSaving(true);
    try {
      const res = await fetch("/api/call-center/metrics/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validFrom, data }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors(Array.isArray(body?.errors) && body.errors.length ? body.errors : [body?.error ?? "No se pudo guardar."]);
        return;
      }
      setSaved(validFrom);
      router.refresh();
    } catch {
      setErrors(["No se pudo guardar. Revisá la conexión y probá de nuevo."]);
    } finally {
      setSaving(false);
    }
  }

  const input = "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-[#1E2D5A] focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-8">
      <section>
        <label htmlFor="validFrom" className="block text-sm font-semibold text-gray-800">Rige desde</label>
        <p className="text-xs text-gray-500">
          Los días anteriores a esta fecha se siguen midiendo con la versión que regía. Para un cambio de horario futuro, elegí el día en que empieza.
        </p>
        <input id="validFrom" type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={`mt-2 ${input}`} />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Horarios</h2>
        <p className="text-xs text-gray-500">
          Una o más franjas por día, separadas por coma: <span className="font-mono">08:00-13:00, 16:00-20:30</span>. Vacío = ese día no hay atención.
          La meta se mide sobre el horario público.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Día</th>
                <th className="py-1 pr-3 font-medium">Horario público</th>
                <th className="py-1 font-medium">Horario de operadores</th>
              </tr>
            </thead>
            <tbody>
              {ISO_WEEKDAYS.map((d) => (
                <tr key={d}>
                  <td className="py-1 pr-3 text-gray-700">{WEEKDAY_LABELS[d]}</td>
                  <td className="py-1 pr-3">
                    <input aria-label={`Horario público, ${WEEKDAY_LABELS[d]}`} value={publicText[d]} placeholder="Sin atención"
                      onChange={(e) => setPublicText((t) => ({ ...t, [d]: e.target.value }))} className={`w-full min-w-[11rem] font-mono ${input}`} />
                  </td>
                  <td className="py-1">
                    <input aria-label={`Horario de operadores, ${WEEKDAY_LABELS[d]}`} value={operatorText[d]} placeholder="Sin atención"
                      onChange={(e) => setOperatorText((t) => ({ ...t, [d]: e.target.value }))} className={`w-full min-w-[11rem] font-mono ${input}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <label htmlFor="goal" className="block text-sm font-semibold text-gray-800">Meta de primera respuesta</label>
        <p className="text-xs text-gray-500">Minutos hábiles, contados dentro del horario público, desde que la conversación sale del bot.</p>
        <div className="mt-2 flex items-center gap-2">
          <input id="goal" inputMode="numeric" value={goal} onChange={(e) => setGoal(e.target.value)} className={`w-24 ${input}`} />
          <span className="text-sm text-gray-600">minutos</span>
        </div>
        <label htmlFor="critical" className="mt-4 block text-sm font-semibold text-gray-800">Demora crítica</label>
        <p className="text-xs text-gray-500">
          Minutos hábiles de espera desde los que un caso se marca como crítico en &quot;Ahora&quot;. Entre la meta y este valor se marca como demorado.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input id="critical" inputMode="numeric" value={critical} onChange={(e) => setCritical(e.target.value)} className={`w-24 ${input}`} />
          <span className="text-sm text-gray-600">minutos</span>
        </div>
        <label htmlFor="windowWarning" className="mt-4 block text-sm font-semibold text-gray-800">Aviso de ventana de WhatsApp por vencer</label>
        <p className="text-xs text-gray-500">
          Horas antes del cierre de la ventana desde las que un caso se marca &quot;por vencer&quot; en &quot;Ahora&quot;. La ventana de 24 horas desde el último mensaje del
          cliente es una regla de WhatsApp y no se configura.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input id="windowWarning" inputMode="numeric" value={windowWarning} onChange={(e) => setWindowWarning(e.target.value)} className={`w-24 ${input}`} />
          <span className="text-sm text-gray-600">horas</span>
        </div>
        <label htmlFor="lastResponseWarning" className="mt-4 block text-sm font-semibold text-gray-800">Aviso de última respuesta de un operador</label>
        <p className="text-xs text-gray-500">
          Minutos sin una respuesta pública de un operador desde los que &quot;Ahora&quot; muestra el aviso &quot;para revisar&quot;. Solo aparece si además hay pendientes
          y es horario de operadores.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input id="lastResponseWarning" inputMode="numeric" value={lastResponseWarning} onChange={(e) => setLastResponseWarning(e.target.value)} className={`w-24 ${input}`} />
          <span className="text-sm text-gray-600">minutos</span>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Cuentas de Emozion</h2>
        <p className="text-xs text-gray-500">
          Se muestran por su número o por el alias. Activa: está en uso, aunque no escriba por una ausencia. Prestada: la usa otra persona que su titular.
          Histórica: ya no se usa y aparece solo en los períodos en que tuvo actividad. Supervisión: la usa quien supervisa; se muestra aparte de los operadores y no suma en el equipo. Sistema: no es una persona (por ejemplo, una cuenta a la que
          Emozion asigna conversaciones de forma automática).
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Cuenta</th>
                <th className="px-3 py-2 font-medium">Alias</th>
                <th className="px-3 py-2 font-medium">Último mensaje</th>
                <th className="px-3 py-2 font-medium">Activa</th>
                <th className="px-3 py-2 font-medium">Prestada</th>
                <th className="px-3 py-2 font-medium">Histórica</th>
                <th className="px-3 py-2 font-medium">Sistema</th>
                <th className="px-3 py-2 font-medium">Supervisión</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-3 text-gray-500">No hay cuentas. Agregá una con su número de Emozion.</td></tr>
              )}
              {accounts.map((a, i) => {
                const known = knownByAccount.get(a.externalId);
                return (
                  <tr key={a.externalId} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-mono tabular-nums">{a.externalId}</td>
                    <td className="px-3 py-2">
                      <input aria-label={`Alias de la cuenta ${a.externalId}`} value={a.alias ?? ""} maxLength={60}
                        onChange={(e) => updateAccount(i, { alias: e.target.value })} className={`w-36 ${input}`} />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-gray-500">
                      {known?.lastMessageDay
                        ? formatDay(known.lastMessageDay)
                        : known?.onlySeenAsAssignee
                          ? <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Vista solo como asignada</span>
                          : "Sin mensajes"}
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Cuenta ${a.externalId} activa`} checked={a.active}
                        onChange={(e) => updateAccount(i, { active: e.target.checked, historical: e.target.checked ? false : a.historical })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Cuenta ${a.externalId} prestada`} checked={a.borrowed}
                        onChange={(e) => updateAccount(i, { borrowed: e.target.checked })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Cuenta ${a.externalId} histórica`} checked={a.historical}
                        onChange={(e) => updateAccount(i, { historical: e.target.checked, active: e.target.checked ? false : a.active })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Cuenta ${a.externalId} de sistema`} checked={a.system === true}
                        onChange={(e) => updateAccount(i, { system: e.target.checked, ...(e.target.checked ? { supervision: false } : {}) })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Cuenta ${a.externalId} de supervisión`} checked={a.supervision === true}
                        onChange={(e) => updateAccount(i, { supervision: e.target.checked, ...(e.target.checked ? { system: false } : {}) })} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!known && (
                        <button type="button" onClick={() => setAccounts((list) => list.filter((_, j) => j !== i))} className="text-xs text-gray-500 hover:text-red-700">
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input aria-label="Número de una cuenta nueva" value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Número de cuenta" className={`w-40 ${input}`} />
          <button type="button" onClick={addAccount} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Agregar cuenta
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Horario de pedidos por sucursal</h2>
        <p className="text-xs text-gray-500">
          Horario en que cada sucursal toma pedidos por WhatsApp, para retirar y con envío. Sirve para distinguir una derivación a compra presencial correcta
          (fuera de ese horario) de una posible venta perdida (dentro). Los feriados no tienen horario. Una sucursal sin horario cargado no se marca dentro ni fuera.
          Mismo formato que arriba: 09:30-18:00, y vacío si ese día no toma pedidos.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select aria-label="Sucursal para cargar su horario de pedidos" value={newOrderBranch} onChange={(e) => setNewOrderBranch(e.target.value)} className={`w-56 max-w-full ${input}`}>
            <option value="">Elegí una sucursal</option>
            {options.branches.filter((b) => !orderHours.some((o) => o.branchId === b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="button" disabled={!newOrderBranch}
            onClick={() => { setOrderHours((list) => [...list, { branchId: newOrderBranch, pickup: emptyScheduleText(), delivery: emptyScheduleText() }]); setNewOrderBranch(""); }}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 disabled:opacity-50">Agregar sucursal</button>
        </div>
        <div className="mt-3 space-y-3">
          {orderHours.map((b, i) => (
            <div key={b.branchId} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-800">{branchName(b.branchId)}</h3>
                <button type="button" onClick={() => setOrderHours((list) => list.filter((_, j) => j !== i))} className="text-xs font-medium text-red-700 underline">Quitar</button>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr><th className="py-1 pr-3 font-medium">Día</th><th className="py-1 pr-3 font-medium">Pedidos para retirar</th><th className="py-1 font-medium">Pedidos con envío</th></tr>
                  </thead>
                  <tbody>
                    {ISO_WEEKDAYS.map((d) => (
                      <tr key={d}>
                        <td className="py-1 pr-3 text-gray-700">{WEEKDAY_LABELS[d]}</td>
                        {(["pickup", "delivery"] as const).map((kind) => (
                          <td key={kind} className="py-1 pr-3">
                            <input aria-label={`${kind === "pickup" ? "Pedidos para retirar" : "Pedidos con envío"}, ${branchName(b.branchId)}, ${WEEKDAY_LABELS[d]}`}
                              value={b[kind][d]} placeholder="No toma pedidos"
                              onChange={(e) => setOrderHours((list) => list.map((x, j) => (j === i ? { ...x, [kind]: { ...x[kind], [d]: e.target.value } } : x)))}
                              className={`w-full min-w-[11rem] font-mono ${input}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Etiquetas de cierre</h2>
        <p className="text-xs text-gray-500">
          Etiquetas que Emozion agrega al resolver una conversación, con el resultado que eligió el operador. Escribí el nombre de la etiqueta tal como figura en Emozion
          (por ejemplo, con guiones bajos) y elegí qué resultado significa. Las demás etiquetas no son de cierre y no hace falta cargarlas.
        </p>
        <div className="mt-2 space-y-2">
          {closureLabels.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label={`Etiqueta de cierre ${i + 1}`} value={c.label} placeholder="nombre_de_la_etiqueta"
                onChange={(e) => setClosureLabels((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`w-64 max-w-full font-mono ${input}`} />
              <select aria-label={`Resultado de la etiqueta de cierre ${i + 1}`} value={c.outcome}
                onChange={(e) => setClosureLabels((list) => list.map((x, j) => (j === i ? { ...x, outcome: e.target.value as ClosureOutcome } : x)))} className={`w-56 max-w-full ${input}`}>
                {CLOSURE_OUTCOMES.map((o) => <option key={o} value={o}>{CLOSURE_OUTCOME_LABELS[o]}</option>)}
              </select>
              <button type="button" onClick={() => setClosureLabels((list) => list.filter((_, j) => j !== i))} className="text-xs font-medium text-red-700 underline">Quitar</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setClosureLabels((list) => [...list, { label: "", outcome: "VENTA" }])}
          className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800">Agregar etiqueta</button>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Vendedores de SIAF del Call Center</h2>
        <p className="text-xs text-gray-500">
          Marcá, en cada sucursal, los vendedores cuyas ventas son del Call Center. El código de vendedor es propio de cada sucursal.
          Se listan los que tuvieron ventas en los últimos 90 días. Marcados: {vendors.size}.
          Al marcar uno podés indicar a qué cuenta de operador pertenece: así los códigos que una misma persona tiene en distintas sucursales se juntan en una sola ficha de ventas.
        </p>
        {vendorGroups.length === 0 && <p className="mt-2 text-sm text-gray-500">No hay ventas recientes con detalle de vendedores.</p>}
        <div className="mt-3 space-y-2">
          {vendorGroups.map(([branchId, g]) => {
            const selected = g.items.filter((i) => vendors.has(i.key)).length;
            return (
              <details key={branchId} className="rounded-lg border border-gray-200 bg-white" open={selected > 0}>
                <summary className="cursor-pointer px-3 py-2 text-sm text-gray-800">
                  {g.branchName} <span className="text-xs text-gray-500">· {selected} de {g.items.length}</span>
                </summary>
                <div className="grid gap-x-6 gap-y-1 border-t border-gray-100 px-3 py-2 sm:grid-cols-2">
                  {g.items.map((item) => (
                    <div key={item.key} className="py-0.5">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={vendors.has(item.key)}
                          onChange={(e) => setVendors((set) => {
                            const next = new Set(set);
                            if (e.target.checked) next.add(item.key); else next.delete(item.key);
                            return next;
                          })} />
                        <span className="font-mono text-xs text-gray-500">{item.code}</span>
                        <span className="truncate">{item.name ?? "Sin ventas recientes"}</span>
                      </label>
                      {vendors.has(item.key) && (
                        <select aria-label={`Cuenta de operador del vendedor ${item.code}`} value={vendorAccounts[item.key] ?? ""}
                          onChange={(e) => setVendorAccounts((map) => {
                            const next = { ...map };
                            if (e.target.value) next[item.key] = e.target.value; else delete next[item.key];
                            return next;
                          })}
                          className={`ml-6 mt-1 w-56 max-w-full text-xs ${input}`}>
                          <option value="">Sin cuenta asociada</option>
                          {accounts.filter((a) => a.system !== true).map((a) => (
                            <option key={a.externalId} value={a.externalId}>{a.alias && a.alias.trim() ? `${a.alias.trim()} · cuenta ${a.externalId}` : `Cuenta ${a.externalId}`}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">No se guardó. Revisá:</p>
          <ul className="mt-1 list-disc pl-5">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {saved && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Versión guardada. Rige desde el {formatDay(saved)}.
        </p>
      )}

      <button type="submit" disabled={saving}
        className="rounded-md bg-[#1E2D5A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16224a] disabled:opacity-60">
        {saving ? "Guardando…" : "Guardar versión nueva"}
      </button>
    </form>
  );
}

/** "2026-03-01" → "01/03/2026". */
function formatDay(dayISO: string): string {
  const [y, m, d] = dayISO.split("-");
  return `${d}/${m}/${y}`;
}
