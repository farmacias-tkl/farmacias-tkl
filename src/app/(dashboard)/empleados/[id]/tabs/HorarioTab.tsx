"use client";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_NAMES, fmtMinutes } from "@/lib/personal/schedule";

// Fechas @db.Date (00:00 UTC): se muestran en UTC para no correr un día.
const fmt = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const WEEK_LABEL: Record<string, string> = { ALL: "Todas las semanas", A: "Semana A", B: "Semana B" };

export default function HorarioTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["employee-personal", employeeId],
    queryFn:  () => fetch(`/api/employees/${employeeId}/personal`).then(r => r.json()),
  });
  const p = data?.data;
  const schedules: any[] = p?.schedules ?? [];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-400" />
        Horario semanal
      </h3>

      {isLoading ? (
        <div className="card p-4 h-24 animate-pulse bg-gray-50" />
      ) : schedules.length === 0 ? (
        <div className="card p-10 text-center">
          <Clock className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">
            {p?.isRotating
              ? `Rotativo/a sin horario fijo${p?.declaredWeeklyHours !== null ? ` · ${p.declaredWeeklyHours} h semanales` : ""}.`
              : "Sin horario cargado."}
          </p>
        </div>
      ) : (
        schedules.map((s) => {
          const weeks: string[] = [...new Set<string>(s.slots.map((x: any) => x.week))].sort();
          return (
            <div key={s.id} className={cn("card p-4 space-y-3", !s.isCurrent && "opacity-70")}>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-semibold text-gray-900">Vigente desde {fmt(s.validFrom)}</span>
                {s.isCurrent && <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded">Actual</span>}
                {s.abReferenceDate && (
                  <span className="text-gray-500">Semana A: la del {fmt(s.abReferenceDate)}</span>
                )}
                <span className="text-gray-500">
                  · {s.hours.alternating && s.hours.A !== s.hours.B
                    ? `A ${s.hours.A} h / B ${s.hours.B} h`
                    : `${s.hours.A} h semanales`}
                </span>
              </div>
              {s.hoursWarning && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />{s.hoursWarning}
                </p>
              )}
              {weeks.map((w) => (
                <div key={w}>
                  {weeks.length > 1 || w !== "ALL" ? (
                    <p className="text-[11px] font-medium text-gray-500 mb-1">{WEEK_LABEL[w]}</p>
                  ) : null}
                  <table className="w-full text-xs">
                    <tbody>
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                        const ss = s.slots.filter((x: any) => x.week === w && x.dayOfWeek === day);
                        return (
                          <tr key={day} className="border-b border-gray-50 last:border-0">
                            <td className="py-1 pr-3 text-gray-500 w-24">{DAY_NAMES[day]}</td>
                            <td className="py-1 text-gray-800">
                              {ss.length === 0
                                ? <span className="text-gray-400">{w === "ALL" ? "Franco" : "—"}</span>
                                : ss.map((x: any) => (
                                    <span key={x.id} className="mr-3">
                                      {fmtMinutes(x.startMinute)}–{fmtMinutes(x.endMinute)}
                                      <span className="text-gray-500"> · {x.branch?.name ?? x.otherPlace ?? "—"}</span>
                                    </span>
                                  ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
