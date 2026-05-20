"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, Clock, LogOut, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  branches: Array<{ id: string; name: string }>;
  isBranchManager: boolean;
  userBranchId: string | null;
  onClose: () => void;
  onCreated: () => void;
}

type SubType = "LATE_ARRIVAL" | "EARLY_DEPARTURE";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function combineDateAndTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(dateStr);
  d.setHours(h, m, 0, 0);
  return d;
}

function diffMinutes(expectedTime: string, actualTime: string, type: SubType): number | null {
  if (!expectedTime || !actualTime) return null;
  const [eh, em] = expectedTime.split(":").map(Number);
  const [ah, am] = actualTime.split(":").map(Number);
  if (isNaN(eh) || isNaN(em) || isNaN(ah) || isNaN(am)) return null;
  const e = eh * 60 + em;
  const a = ah * 60 + am;
  return type === "LATE_ARRIVAL" ? a - e : e - a;
}

export default function TimeEventFormPanel({
  branches, isBranchManager, userBranchId, onClose, onCreated,
}: Props) {
  const [subType,    setSubType]    = useState<SubType | null>(null);
  const [branchId,   setBranchId]   = useState(isBranchManager ? (userBranchId ?? "") : "");
  const [employeeId, setEmployeeId] = useState("");
  const [date,       setDate]       = useState(todayISO());
  const [expected,   setExpected]   = useState("");
  const [actual,     setActual]     = useState("");
  const [reason,     setReason]     = useState("");
  const [reporterNote, setReporterNote] = useState("");
  const [error,      setError]      = useState<string | null>(null);

  // Reset al cambiar tipo
  useEffect(() => {
    setExpected(""); setActual(""); setReason(""); setError(null);
  }, [subType]);

  const { data: empRes } = useQuery({
    queryKey: ["employees-by-branch", branchId],
    queryFn: async () => {
      if (!branchId) return { data: [] };
      const res = await fetch(`/api/employees?branchId=${branchId}&limit=200`);
      return res.json();
    },
    enabled: !!branchId,
  });
  const employees = empRes?.data ?? [];

  const minutes = subType ? diffMinutes(expected, actual, subType) : null;
  const validMinutes = minutes !== null && minutes > 0;
  const invalidMinutes = !!expected && !!actual && minutes !== null && minutes <= 0;

  const createMut = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!subType) throw new Error("Tipo no seleccionado");
      const exp = combineDateAndTime(date, expected);
      const act = combineDateAndTime(date, actual);
      if (!exp || !act) throw new Error("Ambas horas son obligatorias");
      const payload = {
        employeeId,
        type: subType,
        date,
        expectedTime: exp.toISOString(),
        actualTime:   act.toISOString(),
        reason:       reason.trim() || null,
        reporterNote: reporterNote.trim() || null,
      };
      const res = await fetch("/api/time-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al crear");
      return json;
    },
    onSuccess: () => { onCreated(); },
    onError: (e: any) => setError(e.message),
  });

  const requiresReason = subType === "EARLY_DEPARTURE";
  const canSubmit = !!subType && !!employeeId && !!date && validMinutes
    && (!requiresReason || !!reason.trim()) && !createMut.isPending;

  return (
    <div className="card p-5 space-y-4">
      {/* Sub-chooser */}
      {subType === null ? (
        <>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">¿Qué necesitás registrar?</h3>
            <p className="text-xs text-gray-500 mt-0.5">El empleado SÍ trabajó, pero fuera del horario esperado.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSubType("LATE_ARRIVAL")}
              className="text-left rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50/40 p-4 group transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-orange-50 group-hover:bg-orange-100 p-2">
                  <Clock className="w-5 h-5 text-orange-600" />
                </div>
                <span className="text-sm font-semibold text-gray-900">Llegada tarde</span>
              </div>
              <p className="text-xs text-gray-500 leading-snug">
                El empleado llegó después de la hora esperada de entrada.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSubType("EARLY_DEPARTURE")}
              className="text-left rounded-xl border-2 border-gray-200 hover:border-violet-400 hover:bg-violet-50/40 p-4 group transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-violet-50 group-hover:bg-violet-100 p-2">
                  <LogOut className="w-5 h-5 text-violet-600" />
                </div>
                <span className="text-sm font-semibold text-gray-900">Retiro anticipado</span>
              </div>
              <p className="text-xs text-gray-500 leading-snug">
                El empleado se retiró antes del horario. Requiere autorización del supervisor.
              </p>
            </button>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSubType(null)}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />Cambiar tipo
            </button>
            <h3 className="text-sm font-semibold text-gray-900">
              {subType === "LATE_ARRIVAL" ? "Llegada tarde" : "Retiro anticipado"}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Sucursal */}
            {!isBranchManager ? (
              <div>
                <label className="label">Sucursal *</label>
                <select className="input" value={branchId} onChange={e => { setBranchId(e.target.value); setEmployeeId(""); }}>
                  <option value="">Selecciona sucursal</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="label">Sucursal</label>
                <input className="input bg-gray-50 text-gray-500" disabled
                  value={branches.find(b => b.id === userBranchId)?.name ?? "Tu sucursal"} />
              </div>
            )}

            {/* Empleado */}
            <div>
              <label className="label">Empleado *</label>
              <select className="input" value={employeeId} disabled={!branchId}
                onChange={e => setEmployeeId(e.target.value)}>
                <option value="">{branchId ? "Selecciona empleado" : "Primero selecciona sucursal"}</option>
                {employees.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} — {e.position?.name ?? "sin puesto"}
                  </option>
                ))}
              </select>
            </div>

            {/* Fecha */}
            <div>
              <label className="label">Fecha *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
            </div>

            {/* Tiempos */}
            <div>
              <label className="label">
                {subType === "LATE_ARRIVAL" ? "Hora esperada de entrada *" : "Hora esperada de salida *"}
              </label>
              <input type="time" value={expected} onChange={e => setExpected(e.target.value)}
                className={cn("input", invalidMinutes && "input-error")} />
            </div>
            <div>
              <label className="label">
                {subType === "LATE_ARRIVAL" ? "Hora real de llegada *" : "Hora real de retiro *"}
              </label>
              <input type="time" value={actual} onChange={e => setActual(e.target.value)}
                className={cn("input", invalidMinutes && "input-error")} />
            </div>

            {/* Cálculo en vivo */}
            <div className="sm:col-span-2">
              {validMinutes && (
                <div className="inline-flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                  <Clock className="w-4 h-4 text-orange-600" />
                  <span className="text-sm font-semibold text-orange-800">
                    {minutes} min {subType === "LATE_ARRIVAL" ? "de demora" : "antes del horario"}
                  </span>
                </div>
              )}
              {invalidMinutes && (
                <p className="error-msg">
                  {subType === "LATE_ARRIVAL"
                    ? "La hora real debe ser posterior a la esperada."
                    : "La hora real debe ser anterior a la esperada."}
                </p>
              )}
              {!expected && !actual && (
                <p className="text-xs text-gray-400">Cargá ambas horas para calcular los minutos.</p>
              )}
            </div>

            {/* Motivo */}
            <div className="sm:col-span-2">
              <label className="label">
                Motivo {requiresReason ? "*" : "(opcional)"}
              </label>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="input"
                placeholder={requiresReason ? "Obligatorio para retiro anticipado" : "Opcional..."}
              />
            </div>

            {/* Observación adicional */}
            <div className="sm:col-span-2">
              <label className="label">Observación interna</label>
              <textarea
                value={reporterNote}
                onChange={e => setReporterNote(e.target.value)}
                rows={2}
                className="input resize-none"
                placeholder="Opcional..."
              />
            </div>
          </div>

          {subType === "EARLY_DEPARTURE" && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
              ℹ La solicitud queda en <strong>PENDING_AUTHORIZATION</strong> hasta que un supervisor confirme la autorización.
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!canSubmit}
              className="btn-primary"
            >
              {createMut.isPending ? "Guardando..." : "Registrar evento"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
