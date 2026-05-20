"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  branches: Array<{ id: string; name: string }>;
  isBranchManager: boolean;
  userBranchId: string | null;
  onClose: () => void;
  onCreated: () => void;
}

interface Validation {
  isValid: boolean;
  calculatedDays: number;
  conflictLevel: "NONE" | "WARNING" | "BLOCKING";
  ruleResults: Array<{ rule: string; status: "OK" | "WARNING" | "BLOCKING"; message: string }>;
  blockingConflicts: Array<{ message: string }>;
  warnings: Array<{ message: string }>;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export default function VacationFormPanel({
  branches, isBranchManager, userBranchId, onClose, onCreated,
}: Props) {
  const [branchId,  setBranchId]  = useState(isBranchManager ? (userBranchId ?? "") : "");
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate,   setEndDate]   = useState(todayISO());
  const [requesterNote, setRequesterNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Empleados de la sucursal seleccionada
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
  const selectedEmployee = employees.find((e: any) => e.id === employeeId);

  // Validación en vivo
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validating, setValidating] = useState(false);
  useEffect(() => {
    if (!employeeId || !startDate || !endDate) {
      setValidation(null);
      return;
    }
    let cancelled = false;
    setValidating(true);
    fetch("/api/vacations/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, startDate, endDate }),
    })
      .then(r => r.json())
      .then(j => { if (!cancelled) setValidation(j.validation ?? null); })
      .catch(() => { if (!cancelled) setValidation(null); })
      .finally(() => { if (!cancelled) setValidating(false); });
    return () => { cancelled = true; };
  }, [employeeId, startDate, endDate]);

  const createMut = useMutation({
    mutationFn: async () => {
      setSubmitError(null);
      const res = await fetch("/api/vacations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, startDate, endDate, requesterNote: requesterNote || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = json.error ?? "Error";
        setSubmitError(err);
        throw new Error(err);
      }
      return json;
    },
    onSuccess: () => { onCreated(); },
  });

  const isBlocking = validation?.conflictLevel === "BLOCKING";
  const canSubmit = !!employeeId && !!startDate && !!endDate && !validating && !isBlocking;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Solicitar vacaciones</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <select
            className="input"
            value={employeeId}
            disabled={!branchId}
            onChange={e => setEmployeeId(e.target.value)}>
            <option value="">{branchId ? "Selecciona empleado" : "Primero selecciona sucursal"}</option>
            {employees.map((e: any) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} — {e.position?.name ?? "sin puesto"}
              </option>
            ))}
          </select>
        </div>

        {/* Info del empleado */}
        {selectedEmployee && (
          <div className="sm:col-span-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 space-y-0.5">
            <div><span className="font-medium text-gray-800">Puesto:</span> {selectedEmployee.position?.name ?? "No configurado"}</div>
            <div><span className="font-medium text-gray-800">Sucursal:</span> {selectedEmployee.currentBranch?.name ?? "No configurada"}</div>
            <div><span className="font-medium text-gray-800">Turno:</span> No configurado</div>
            <div><span className="font-medium text-gray-800">Días disponibles:</span> No configurado</div>
          </div>
        )}

        {/* Fechas */}
        <div>
          <label className="label">Fecha inicio *</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input" />
          <p className="text-xs text-gray-400 mt-0.5">Debe ser lunes (o martes post-feriado).</p>
        </div>
        <div>
          <label className="label">Fecha fin *</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input" />
          <p className="text-xs text-gray-400 mt-0.5">Duración múltiplo de 7 días.</p>
        </div>

        {/* Días calculados */}
        {validation && (
          <div className="sm:col-span-2 text-xs text-gray-600">
            Días calculados: <span className="font-semibold text-gray-900">{validation.calculatedDays}</span>
          </div>
        )}

        {/* Observación */}
        <div className="sm:col-span-2">
          <label className="label">Observación del solicitante</label>
          <textarea
            value={requesterNote}
            onChange={e => setRequesterNote(e.target.value)}
            rows={2}
            className="input resize-none"
            placeholder="Opcional..." />
        </div>
      </div>

      {/* Validation panel */}
      {validating && (
        <p className="text-xs text-gray-400">Validando...</p>
      )}
      {validation && !validating && (
        <ValidationPanel v={validation} />
      )}

      {submitError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button
          onClick={() => createMut.mutate()}
          disabled={!canSubmit || createMut.isPending}
          className="btn-primary">
          {createMut.isPending ? "Guardando..." : "Crear solicitud"}
        </button>
      </div>
    </div>
  );
}

function ValidationPanel({ v }: { v: Validation }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-1.5">
      {v.ruleResults.map((r, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {r.status === "OK" && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />}
          {r.status === "WARNING" && <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
          {r.status === "BLOCKING" && <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
          <span className={cn(
            r.status === "OK"       && "text-gray-700",
            r.status === "WARNING"  && "text-amber-700",
            r.status === "BLOCKING" && "text-red-700",
          )}>{r.message}</span>
        </div>
      ))}
      {v.blockingConflicts.map((c, i) => (
        <div key={`b${i}`} className="flex items-start gap-2 text-xs">
          <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-red-700">Conflicto: {c.message}</span>
        </div>
      ))}
      {v.warnings.map((c, i) => (
        <div key={`w${i}`} className="flex items-start gap-2 text-xs">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-amber-700">Aviso: {c.message}</span>
        </div>
      ))}
    </div>
  );
}
