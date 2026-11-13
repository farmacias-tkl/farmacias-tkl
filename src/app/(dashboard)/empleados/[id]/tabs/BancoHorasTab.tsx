"use client";
// Ficha del empleado: saldo del banco de horas como movimientos. Supervisión
// puede cargar el saldo inicial, una compensación o un ajuste.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseCalendarDate } from "@/lib/dates/calendar";
import { fmtMinutes } from "@/lib/personal/schedule";
import { fmtHours, MOVEMENT_LABEL } from "@/lib/hour-bank/hours";

const fmtDay = (d: string) =>
  parseCalendarDate(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });
const fmtWhen = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });

function requestPeriod(r: any): string {
  const a = String(r.startDate).slice(0, 10), b = String(r.endDate).slice(0, 10);
  const days = a === b ? fmtDay(a) : `${fmtDay(a)} → ${fmtDay(b)}`;
  return r.startMinute !== null && r.endMinute !== null ? `${days} ${fmtMinutes(r.startMinute)}–${fmtMinutes(r.endMinute)}` : days;
}

const MANUAL_TYPES = [
  { value: "INITIAL", label: "Saldo inicial", hint: "Las horas que tenía a favor (o en contra, con signo menos) antes de usar la plataforma. Se carga una sola vez." },
  { value: "COMPENSATION", label: "Compensación", hint: "Suma horas. Por ejemplo, un feriado trabajado." },
  { value: "ADJUST", label: "Ajuste", hint: "Corrección. Con signo menos, resta." },
] as const;

export default function BancoHorasTab({ employeeId, canAdjust }: { employeeId: string; canAdjust: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["hour-bank-balance", employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/hour-bank/balance?employeeId=${employeeId}`);
      if (!res.ok) throw new Error("No se pudo cargar");
      return res.json();
    },
  });
  const b = data?.data;

  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<(typeof MANUAL_TYPES)[number]["value"]>("COMPENSATION");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoursNum = Number(String(hours).replace(",", "."));
  const hoursOk = hours !== "" && Number.isFinite(hoursNum) && hoursNum !== 0;
  const noteRequired = type !== "INITIAL";

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/hour-bank/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, type, hours: hoursNum, note: note.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      setShowForm(false); setHours(""); setNote("");
      qc.invalidateQueries({ queryKey: ["hour-bank-balance", employeeId] });
      qc.invalidateQueries({ queryKey: ["hour-bank-balances"] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="card p-4 h-24 animate-pulse bg-gray-50" />;
  if (isError || !b) return <div className="card p-8 text-center text-sm text-red-700">No se pudo cargar el banco de horas.</div>;

  const movements: any[] = b.movements ?? [];
  const hasInitial = movements.some((m) => m.type === "INITIAL");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-gray-400" />
          Banco de horas
        </h3>
        <div className="flex flex-wrap gap-2">
          <Link href="/banco-horas" className="btn-secondary text-xs py-1.5 px-3">Ver pedidos</Link>
          {canAdjust && !showForm && (
            <button onClick={() => { setShowForm(true); setType(hasInitial ? "COMPENSATION" : "INITIAL"); setError(null); }}
              className="btn-secondary text-xs py-1.5 px-3">
              Cargar movimiento
            </button>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap gap-3">
          <div className={cn("rounded-lg border px-3 py-2 min-w-[110px]",
            b.balance < 0 ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50")}>
            <p className={cn("text-[10px] uppercase tracking-wide", b.balance < 0 ? "text-red-500" : "text-blue-500")}>Saldo</p>
            <p className={cn("text-lg font-semibold", b.balance < 0 ? "text-red-800" : "text-blue-900")}>{fmtHours(b.balance)}</p>
          </div>
          {b.pendingHours > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 min-w-[110px]">
              <p className="text-[10px] uppercase tracking-wide text-yellow-700">Pedido sin autorizar</p>
              <p className="text-lg font-semibold text-yellow-900">{fmtHours(b.pendingHours)}</p>
            </div>
          )}
          {b.timeDebt?.enabled && b.timeDebt.hours !== 0 && (
            <div className="rounded-lg border border-gray-200 px-3 py-2 min-w-[110px]">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Minutos a compensar</p>
              <p className="text-lg font-semibold text-red-700">{fmtHours(b.timeDebt.hours)}</p>
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          En horas. No vencen. El saldo es la suma de los movimientos y puede quedar en negativo.
          {b.pendingHours > 0 && ` Si se autoriza lo pedido, queda en ${fmtHours(b.balanceAfterPending)}.`}
          {b.timeDebt?.enabled && b.timeDebt.hours !== 0 && " Incluye los minutos de Asistencia que todavía debe compensar."}
        </p>
      </div>

      {showForm && canAdjust && (
        <div className="card p-4 space-y-3 form-sheet">
          <p className="text-sm font-semibold text-gray-900">Cargar movimiento</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as any)} disabled={busy}>
                {MANUAL_TYPES.filter((t) => t.value !== "INITIAL" || !hasInitial).map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">{MANUAL_TYPES.find((t) => t.value === type)?.hint}</p>
            </div>
            <div>
              <label className="label">Horas</label>
              <input type="number" step="0.25" className="input" value={hours} onChange={(e) => setHours(e.target.value)}
                placeholder={type === "COMPENSATION" ? "Ej: 8" : "Ej: 12 o -3"} disabled={busy} />
              {hoursOk && <p className="text-[11px] text-gray-500 mt-1">El saldo quedaría en {fmtHours(b.balance + hoursNum)}.</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="label">{noteRequired ? "Motivo (obligatorio)" : "Nota (opcional)"}</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy} />
            </div>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="form-actions flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} disabled={busy} className="btn-secondary">Cancelar</button>
            <button onClick={save} className="btn-primary"
              disabled={busy || !hoursOk || (type === "COMPENSATION" && hoursNum < 0) || (noteRequired && !note.trim())}>
              {busy ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-2">Movimientos</p>
        {movements.length === 0 ? (
          <p className="text-xs text-gray-400">Sin movimientos.</p>
        ) : (
          <div className="card divide-y divide-gray-100">
            {movements.map((m) => {
              const h = Number(m.hours);
              return (
                <div key={m.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                  <span className="text-gray-400 w-20 shrink-0">{fmtWhen(m.createdAt)}</span>
                  <span className="text-gray-700 flex-1 min-w-0">
                    {MOVEMENT_LABEL[m.type] ?? m.type}
                    {m.hourBankRequest && <span className="text-gray-500"> · {requestPeriod(m.hourBankRequest)}</span>}
                    {m.overtimeRecord && <span className="text-gray-500"> · horas extra del {fmtDay(m.overtimeRecord.date)}</span>}
                    {!m.hourBankRequest && !m.overtimeRecord && m.note && <span className="text-gray-400"> · {m.note}</span>}
                    {m.userName && <span className="text-gray-400"> · {m.userName}</span>}
                  </span>
                  <span className={cn("font-semibold tabular-nums whitespace-nowrap", h < 0 ? "text-red-700" : "text-green-700")}>
                    {h > 0 ? `+${fmtHours(h)}` : fmtHours(h)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
