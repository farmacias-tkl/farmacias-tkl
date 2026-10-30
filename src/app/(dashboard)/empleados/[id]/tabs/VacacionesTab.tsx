"use client";
import { useQuery } from "@tanstack/react-query";
import { Umbrella } from "lucide-react";
import { cn } from "@/lib/utils";

// Fechas @db.Date (00:00 UTC): se muestran en UTC para no correr un día.
const fmtDay = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const fmtWhen = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });

const MOVEMENT_LABEL: Record<string, string> = {
  LOAD:        "Carga inicial",
  LOAD_ADJUST: "Ajuste de planilla",
  CONSUME:     "Vacaciones aprobadas",
  REFUND:      "Devolución",
};

export default function VacacionesTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["employee-personal", employeeId],
    queryFn:  () => fetch(`/api/employees/${employeeId}/personal`).then(r => r.json()),
  });
  const p = data?.data;
  const balances: Array<{ year: number; days: number }> = p?.balances ?? [];
  const movements: any[] = p?.movements ?? [];

  if (isLoading) return <div className="card p-4 h-24 animate-pulse bg-gray-50" />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <Umbrella className="w-4 h-4 text-gray-400" />
        Saldo de vacaciones (días corridos)
      </h3>

      {balances.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-400">Sin saldo cargado.</p>
        </div>
      ) : (
        <div className="card p-4">
          <div className="flex flex-wrap gap-3">
            {balances.map((b) => (
              <div key={b.year} className="rounded-lg border border-gray-200 px-3 py-2 min-w-[80px]">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{b.year}</p>
                <p className={cn("text-lg font-semibold", b.days < 0 ? "text-red-700" : "text-gray-900")}>{b.days}</p>
              </div>
            ))}
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 min-w-[80px]">
              <p className="text-[10px] uppercase tracking-wide text-blue-500">Total</p>
              <p className="text-lg font-semibold text-blue-900">{p.balanceTotal}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Se descuenta del año más viejo primero.</p>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-2">Movimientos</p>
        {movements.length === 0 ? (
          <p className="text-xs text-gray-400">Sin movimientos.</p>
        ) : (
          <div className="card divide-y divide-gray-100">
            {movements.map((m) => (
              <div key={m.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                <span className="text-gray-400 w-20 shrink-0">{fmtWhen(m.createdAt)}</span>
                <span className="text-gray-700 flex-1">
                  {MOVEMENT_LABEL[m.type] ?? m.type} · año {m.year}
                  {m.vacationRequest && (
                    <span className="text-gray-500">
                      {" "}· solicitud {fmtDay(m.vacationRequest.startDate)} → {fmtDay(m.vacationRequest.endDate)}
                    </span>
                  )}
                  {m.note && <span className="text-gray-400"> · {m.note}</span>}
                </span>
                <span className={cn("font-semibold tabular-nums", m.days < 0 ? "text-red-700" : "text-green-700")}>
                  {m.days > 0 ? `+${m.days}` : m.days}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
