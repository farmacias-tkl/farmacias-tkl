import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callCenterMetricsConfigAccess } from "@/lib/permissions";
import { loadConfigVersions, configForDay, versionPeriods, versionPeriodLabel } from "@/lib/call-center/metrics/config";
import { loadConfigOptions } from "@/lib/call-center/metrics/config-service";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import ConfigForm from "./ConfigForm";

export const metadata = { title: "Call Center — Configuración de métricas" };
export const dynamic = "force-dynamic";

// Configuración de las métricas: horarios, meta, cuentas de Emozion y vendedores de SIAF.
// Dirección, Administrador y Supervisión. Guardar crea una versión nueva vigente desde la fecha elegida; las
// anteriores no se editan ni se borran.
export default async function CallCenterMetricsConfigPage() {
  const session = await auth();
  const access = callCenterMetricsConfigAccess(session?.user);
  if (access === 401) redirect("/login");
  if (access === 403) redirect("/sin-acceso");

  const [{ versions, invalid }, options] = await Promise.all([loadConfigVersions(), loadConfigOptions(prisma)]);
  const today = arDayISO(new Date());
  // Punto de partida del formulario: la versión que rige hoy o, si todas son futuras, la más nueva.
  const current = configForDay(versions, today);
  const base = current ?? versions[0] ?? null;
  // Qué período rige cada versión; las que tienen otra de la misma fecha creada después no rigen ningún día.
  const periods = versionPeriods(versions);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/call-center" className="text-xs text-gray-500 hover:text-gray-800">← Volver a conversaciones</Link>
      <h1 className="mt-3 text-xl font-bold text-gray-900">Configuración de las métricas</h1>
      <p className="mt-1 text-sm text-gray-500">
        Horarios, meta de primera respuesta, cuentas de Emozion y vendedores de SIAF del Call Center. Cada vez que
        guardás se crea una versión nueva, que rige desde la fecha que elijas. Las versiones anteriores no se
        modifican: los días pasados se siguen midiendo con el horario que regía ese día.
      </p>

      {invalid.length > 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Hay {invalid.length} {invalid.length === 1 ? "versión guardada que no se pudo leer y no se está usando" : "versiones guardadas que no se pudieron leer y no se están usando"}.
        </p>
      )}

      <ConfigForm today={today} base={base ? { validFrom: base.validFrom, data: base.data } : null} options={options} />

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-gray-800">Versiones guardadas</h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            Todavía no hay ninguna. Hasta que se guarde la primera, la meta, el tiempo hábil y las ventas se muestran como no disponibles.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Rige desde</th>
                  <th className="px-3 py-2 font-medium">Guardada</th>
                  <th className="px-3 py-2 font-medium">Meta</th>
                  <th className="px-3 py-2 font-medium">Cuentas</th>
                  <th className="px-3 py-2 font-medium">Vendedores</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 tabular-nums">{formatDay(v.validFrom)}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-500">{formatDay(arDayISO(v.createdAt))}</td>
                    <td className="px-3 py-2">{v.data.firstResponseGoalMinutes} min</td>
                    <td className="px-3 py-2">{v.data.accounts.length}</td>
                    <td className="px-3 py-2">{v.data.callCenterVendors.length}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {(() => {
                        const period = periods.get(v.id);
                        if (!period) return null;
                        if (period.superseded) return <span className="text-gray-400">Reemplazada</span>;
                        return (
                          <span className={current?.id === v.id ? "font-medium text-emerald-700" : "text-gray-600"}>
                            {versionPeriodLabel(period, today)}{current?.id === v.id ? " · vigente hoy" : ""}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

/** "2026-03-01" → "01/03/2026". */
function formatDay(dayISO: string): string {
  const [y, m, d] = dayISO.split("-");
  return `${d}/${m}/${y}`;
}
