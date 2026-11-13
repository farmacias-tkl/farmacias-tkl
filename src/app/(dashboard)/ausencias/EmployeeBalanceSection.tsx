"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronUp, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMinutes } from "@/lib/time-events/duration";

export interface BalanceRow {
  employeeId:   string;
  employeeName: string;
  branchName:   string | null;
  positionName: string | null;
  owed:         number;
  compensated:  number;
  pending:      number;
  inReview:     number;
  toCompensate: number;
  payroll:      number;
  waived:       number;
  events:       number;
}

interface Props {
  /** Filtro de sucursal de la pantalla (o la sucursal del encargado). */
  branchId?: string | null;
  /** Persona elegida (filtra Asistencia por esa persona). */
  selectedId?: string | null;
  onSelect?: (row: BalanceRow) => void;
}

/**
 * "Saldo por empleado": total adeudado, compensado y pendiente de cada persona,
 * de mayor a menor pendiente. Cuenta también lo que está pendiente de revisión.
 * Tocar una persona filtra Asistencia por ella y abre su resumen.
 */
export default function EmployeeBalanceSection({ branchId, selectedId, onSelect }: Props) {
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
  const withPending = rows.filter((r) => r.pending > 0);
  const totalPending = withPending.reduce((acc, r) => acc + r.pending, 0);

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-md bg-amber-50 p-1.5 shrink-0">
            <Hourglass className="w-4 h-4 text-amber-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Saldo por empleado</p>
            <p className="text-xs text-gray-500">
              {isLoading ? "Cargando..."
                : withPending.length === 0 ? "Sin saldos pendientes"
                : `${withPending.length} persona${withPending.length === 1 ? "" : "s"} con saldo pendiente · ${fmtMinutes(totalPending)} en total`}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400">
              No hay llegadas tarde, retiros ni ausencias con horas adeudadas.
            </div>
          ) : (
            <>
              {/* Celular: una tarjeta por persona */}
              <ul className="divide-y divide-gray-100 md:hidden">
                {rows.map((r) => (
                  <li key={r.employeeId}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(r)}
                      className={cn("w-full text-left px-4 py-3 flex items-start gap-2", selectedId === r.employeeId && "bg-blue-50/60")}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="break-words text-sm font-medium text-gray-900">{r.employeeName}</p>
                          <p className={cn("shrink-0 text-sm font-semibold", r.pending > 0 ? "text-red-700" : "text-gray-400")}>
                            {fmtMinutes(r.pending)}
                          </p>
                        </div>
                        <p className="break-words text-xs text-gray-500">
                          {[r.positionName, r.branchName].filter(Boolean).join(" · ") || "—"}
                        </p>
                        <p className="mt-1 text-xs text-gray-600">
                          <span className="whitespace-nowrap">Adeudado {fmtMinutes(r.owed)}</span>
                          {" · "}
                          <span className="whitespace-nowrap">Compensado {fmtMinutes(r.compensated)}</span>
                        </p>
                        <Breakdown row={r} className="mt-1" />
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
                    </button>
                  </li>
                ))}
              </ul>

              {/* Escritorio: tabla */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Empleado</th>
                      <th className="text-left px-3 py-2 font-medium">Sucursal</th>
                      <th className="text-right px-3 py-2 font-medium">Adeudado</th>
                      <th className="text-right px-3 py-2 font-medium">Compensado</th>
                      <th className="text-right px-3 py-2 font-medium">Pendiente</th>
                      <th className="text-right px-3 py-2 font-medium">En revisión</th>
                      <th className="text-right px-3 py-2 font-medium">A compensar</th>
                      <th className="text-right px-3 py-2 font-medium">A descuento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr
                        key={r.employeeId}
                        onClick={() => onSelect?.(r)}
                        className={cn(
                          "cursor-pointer hover:bg-blue-50/50",
                          selectedId === r.employeeId ? "bg-blue-50/70" : idx % 2 === 0 ? "bg-white" : "bg-gray-50/40",
                        )}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-900">{r.employeeName}</span>
                          {r.positionName && <span className="block text-[11px] text-gray-500">{r.positionName}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{r.branchName ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-orange-700 whitespace-nowrap">{fmtMinutes(r.owed)}</td>
                        <td className="px-3 py-2 text-right text-indigo-700 whitespace-nowrap">{fmtMinutes(r.compensated)}</td>
                        <td className={cn("px-3 py-2 text-right font-semibold whitespace-nowrap", r.pending > 0 ? "text-red-700" : "text-gray-400")}>{fmtMinutes(r.pending)}</td>
                        <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{r.inReview ? fmtMinutes(r.inReview) : "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{r.toCompensate ? fmtMinutes(r.toCompensate) : "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{r.payroll ? fmtMinutes(r.payroll) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
                Pendiente = en revisión + a compensar. Tocá una persona para ver su detalle.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** "En revisión 2 h · A compensar 30 min · A descuento 1 h" (solo lo que tiene valor). */
export function Breakdown({ row, className }: { row: { inReview: number; toCompensate: number; payroll: number; waived: number }; className?: string }) {
  const parts: Array<[string, number, string]> = [
    ["En revisión", row.inReview, "bg-yellow-50 text-yellow-800 border-yellow-200"],
    ["A compensar", row.toCompensate, "bg-blue-50 text-blue-800 border-blue-200"],
    ["A descuento", row.payroll, "bg-red-50 text-red-800 border-red-200"],
    ["Condonado", row.waived, "bg-gray-50 text-gray-600 border-gray-200"],
  ];
  const shown = parts.filter(([, v]) => v > 0);
  if (shown.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {shown.map(([label, v, color]) => (
        <span key={label} className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium", color)}>
          {label} {fmtMinutes(v)}
        </span>
      ))}
    </div>
  );
}
