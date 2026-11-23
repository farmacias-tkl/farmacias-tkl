"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONFIG_SCHEMA_VERSION, DEFAULT_CRITICAL_WAIT_MINUTES, DEFAULT_WINDOW_WARNING_HOURS, ISO_WEEKDAYS, criticalWaitMinutesOf, parseConfigData, windowWarningHoursOf,
  type CallCenterMetricsConfigData, type ConfigAccount, type IsoWeekday,
} from "@/lib/call-center/metrics/config-schema";
import {
  WEEKDAY_LABELS, emptyScheduleText, isValidDayISO, proposeAccount, scheduleToText, textToSchedule,
} from "@/lib/call-center/metrics/config-form";
import type { KnownAccount, KnownVendor } from "@/lib/call-center/metrics/config-service";

type ScheduleText = Record<IsoWeekday, string>;
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
  options: { accounts: KnownAccount[]; vendors: KnownVendor[] };
}) {
  const router = useRouter();
  const [validFrom, setValidFrom] = useState(today);
  const [publicText, setPublicText] = useState<ScheduleText>(base ? scheduleToText(base.data.publicHours) : emptyScheduleText());
  const [operatorText, setOperatorText] = useState<ScheduleText>(base ? scheduleToText(base.data.operatorHours) : emptyScheduleText());
  const [goal, setGoal] = useState(String(base?.data.firstResponseGoalMinutes ?? ""));
  const [critical, setCritical] = useState(String(base ? criticalWaitMinutesOf(base.data) : DEFAULT_CRITICAL_WAIT_MINUTES));
  const [windowWarning, setWindowWarning] = useState(String(base ? windowWarningHoursOf(base.data) : DEFAULT_WINDOW_WARNING_HOURS));
  const [accounts, setAccounts] = useState<ConfigAccount[]>(() => initialAccounts(base?.data ?? null, options.accounts));
  const [newAccount, setNewAccount] = useState("");
  const [vendors, setVendors] = useState<Set<string>>(
    () => new Set((base?.data.callCenterVendors ?? []).map((v) => vendorKey(v.branchId, v.code))),
  );
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
    const warningNumber = Number(windowWarning);
    if (!/^\d+$/.test(windowWarning.trim()) || warningNumber < 1 || warningNumber > 23) problems.push("El aviso de ventana por vencer tiene que ser un número entero de horas, entre 1 y 23.");
    if (problems.length > 0 || !pub.ok || !ops.ok) { setErrors(problems); return; }

    const data: CallCenterMetricsConfigData = {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      publicHours: pub.schedule,
      operatorHours: ops.schedule,
      firstResponseGoalMinutes: goalNumber,
      criticalWaitMinutes: criticalNumber,
      windowWarningHours: warningNumber,
      // system se guarda siempre explícito, aunque la versión base no lo tuviera.
      accounts: accounts.map((a) => ({ ...a, alias: a.alias && a.alias.trim() ? a.alias.trim() : null, system: a.system === true })),
      callCenterVendors: [...vendors].map((k) => {
        const [branchId, ...rest] = k.split("|");
        return { branchId, code: rest.join("|") };
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
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Cuentas de Emozion</h2>
        <p className="text-xs text-gray-500">
          Se muestran por su número o por el alias. Activa: está en uso, aunque no escriba por una ausencia. Prestada: la usa otra persona que su titular.
          Histórica: ya no se usa y aparece solo en los períodos en que tuvo actividad. Sistema: no es una persona (por ejemplo, una cuenta a la que
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
                        onChange={(e) => updateAccount(i, { system: e.target.checked })} />
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
        <h2 className="text-sm font-semibold text-gray-800">Vendedores de SIAF del Call Center</h2>
        <p className="text-xs text-gray-500">
          Marcá, en cada sucursal, los vendedores cuyas ventas son del Call Center. El código de vendedor es propio de cada sucursal.
          Se listan los que tuvieron ventas en los últimos 90 días. Marcados: {vendors.size}.
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
                    <label key={item.key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={vendors.has(item.key)}
                        onChange={(e) => setVendors((set) => {
                          const next = new Set(set);
                          if (e.target.checked) next.add(item.key); else next.delete(item.key);
                          return next;
                        })} />
                      <span className="font-mono text-xs text-gray-500">{item.code}</span>
                      <span className="truncate">{item.name ?? "Sin ventas recientes"}</span>
                    </label>
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
