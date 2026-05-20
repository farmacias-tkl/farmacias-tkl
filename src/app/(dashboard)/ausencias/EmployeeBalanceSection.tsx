"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

interface BalanceRow {
  employeeId:       string;
  employeeName:     string;
  branchName:       string | null;
  positionName:     string | null;
  eventsCount:      number;
  totalOwed:        number;
  totalCompensated: number;
  totalRemaining:   number;
}

interface Props {
  branchId?: string | null;
}

export default function EmployeeBalanceSection({ branchId }: Props) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ["time-events-balance", branchId ?? "all"],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (branchId) p.set("branchId", branchId);
      const res = await fetch(`/api/time-events/balance?${p}`);
      if (!res.ok) throw new Error("Error balance");
      return res.json();
    },
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-amber-50 p-1.5">
            <Hourglass className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Saldo de minutos por empleado</p>
            <p className="text-xs text-gray-500">
              {isLoading ? "Cargando..." : rows.length === 0 ? "Sin saldos pendientes" : `${rows.length} empleado${rows.length === 1 ? "" : "s"} con saldo pendiente`}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400">
              Ningún empleado tiene minutos pendientes de compensación.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Empleado</th>
                    <th className="text-left px-3 py-2 font-medium">Sucursal</th>
                    <th className="text-left px-3 py-2 font-medium">Puesto</th>
                    <th className="text-right px-3 py-2 font-medium">Adeudados</th>
                    <th className="text-right px-3 py-2 font-medium">Compensados</th>
                    <th className="text-right px-3 py-2 font-medium">Pendientes</th>
                    <th className="text-right px-3 py-2 font-medium">Eventos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.employeeId} className={cn(idx % 2 === 0 ? "bg-white" : "bg-gray-50/40")}>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.employeeName}</td>
                      <td className="px-3 py-2 text-gray-600">{r.branchName ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{r.positionName ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-orange-700">{r.totalOwed}</td>
                      <td className="px-3 py-2 text-right text-indigo-700">{r.totalCompensated}</td>
                      <td className="px-3 py-2 text-right font-semibold text-red-700">{r.totalRemaining}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.eventsCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
