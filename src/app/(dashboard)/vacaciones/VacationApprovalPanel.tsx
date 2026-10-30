"use client";
// Panel de aprobación de supervisión (adenda E): saldo y cómo queda,
// advertencias con el detalle de los cruces, rotativos libres y botones
// Aprobar / Aprobar igual / Rechazar. Más el cambio de cobertura de una
// solicitud aprobada.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, XCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BalancePreviewView {
  byYear: Array<{ year: number; days: number }>;
  total: number;
  requested: number;
  allocations: Array<{ year: number; days: number }>;
  after: Array<{ year: number; days: number }>;
  totalAfter: number;
  insufficient: boolean;
}

// Fechas "YYYY-MM-DD" o @db.Date: siempre en UTC.
const fmtDay = (d: string) =>
  new Date(d.length === 10 ? `${d}T00:00:00Z` : d)
    .toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function BalanceBox({ b }: { b: BalancePreviewView | null | undefined }) {
  if (!b) return null;
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2.5 text-xs space-y-1.5",
      b.insufficient ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-gray-50 border-gray-200 text-gray-700",
    )}>
      <p className="font-medium">
        Saldo: {b.total} día(s) · pide {b.requested} · quedaría en {b.totalAfter}
      </p>
      {b.byYear.length === 0 ? (
        <p>No tiene saldo cargado.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {b.byYear.map((y) => {
            const after = b.after.find((a) => a.year === y.year)?.days ?? y.days;
            const taken = b.allocations.find((a) => a.year === y.year)?.days ?? 0;
            return (
              <span key={y.year}>
                {y.year}: {y.days}
                {taken > 0 && <span> → <b className={cn(after < 0 && "text-red-700")}>{after}</b></span>}
              </span>
            );
          })}
        </div>
      )}
      {b.insufficient && (
        <p className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />El saldo no alcanza.</p>
      )}
    </div>
  );
}

function WarningsBox({ validation }: { validation: any }) {
  const blocking = [
    ...validation.ruleResults.filter((r: any) => r.status === "BLOCKING").map((r: any) => r.message),
    ...validation.blockingConflicts.map((c: any) => c.message),
  ];
  const ruleWarnings = validation.ruleResults
    .filter((r: any) => r.status === "WARNING" && r.rule !== "saldo" && r.rule !== "rotativos")
    .map((r: any) => r.message);
  const otherWarnings = validation.warnings
    .filter((w: any) => w.type === "MANAGER_SAME_BRANCH" || w.type === "NO_FREE_ROTATIVE")
    .map((w: any) => w.message);
  const overlaps: any[] = validation.overlaps ?? [];
  if (blocking.length + ruleWarnings.length + otherWarnings.length + overlaps.length === 0) {
    return <p className="text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />Sin advertencias.</p>;
  }
  return (
    <div className="space-y-2">
      {blocking.map((m, i) => (
        <p key={`b${i}`} className="text-xs text-red-700 flex items-start gap-1.5"><XCircle className="w-4 h-4 shrink-0" />{m}</p>
      ))}
      {[...ruleWarnings, ...otherWarnings].map((m, i) => (
        <p key={`w${i}`} className="text-xs text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />{m}</p>
      ))}
      {overlaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
          <p className="text-xs font-medium text-amber-900 px-3 py-1.5 border-b border-amber-200">
            Cruces con el mismo puesto en franjas que se pisan
          </p>
          <table className="w-full text-xs text-amber-900">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-amber-700">
                <th className="px-3 py-1">Quién</th><th className="px-3 py-1">Estado</th>
                <th className="px-3 py-1">Sucursal</th><th className="px-3 py-1">Días y franja</th>
              </tr>
            </thead>
            <tbody>
              {overlaps.map((o, i) => (
                <tr key={i} className="border-t border-amber-100 align-top">
                  <td className="px-3 py-1.5">{o.employeeName}<br /><span className="text-amber-700">{o.positionName}</span></td>
                  <td className="px-3 py-1.5">{o.stateLabel}</td>
                  <td className="px-3 py-1.5">{o.branchName}</td>
                  <td className="px-3 py-1.5">
                    {o.dates.length <= 4 ? o.dates.map(fmtDay).join(", ") : `${o.dates.length} días (${fmtDay(o.dates[0])} → ${fmtDay(o.dates[o.dates.length - 1])})`}
                    <br />{o.ranges.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Lista de rotativos libres con selección (radio). value = employeeId o null (ninguno). */
export function CoveragePicker({ vacationId, value, onChange }: {
  vacationId: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["vacation-coverage", vacationId],
    queryFn: async () => {
      const res = await fetch(`/api/vacations/${vacationId}/coverage`);
      if (!res.ok) throw new Error("No se pudieron cargar los rotativos");
      return res.json();
    },
  });
  const d = data?.data;
  if (isLoading) return <p className="text-xs text-gray-400">Buscando rotativos...</p>;
  if (!d?.applies) return <p className="text-xs text-gray-400">Esta solicitud no se cubre con rotativos.</p>;
  const list: any[] = d.availability ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-gray-400" />Rotativos que pueden cubrir
        {d.requestZone && <span className="font-normal text-gray-500">· zona {d.requestZone}</span>}
      </p>
      {d.current && (
        <p className="text-[11px] text-gray-500">
          Cobertura actual: {d.current.employee.firstName} {d.current.employee.lastName}
        </p>
      )}
      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-64 overflow-y-auto">
        <label className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer">
          <input type="radio" checked={value === null} onChange={() => onChange(null)} />
          <span className="text-gray-700">Ninguno (queda <b>sin cobertura</b>)</span>
        </label>
        {list.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400">No hay rotativos libres en la zona.</p>
        )}
        {list.map((r) => (
          <label key={r.employeeId} className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer">
            <input type="radio" className="mt-0.5" checked={value === r.employeeId} onChange={() => onChange(r.employeeId)} />
            <span className="flex-1">
              <span className="font-medium text-gray-900">{r.name}</span>
              {r.zone && <span className="text-gray-400"> · {r.zone}</span>}
              <span className={cn("ml-1.5 text-[10px] px-1.5 py-0.5 rounded",
                r.freeAll ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
                {r.freeAll ? "libre todo el período" : `libre ${r.freeDays.length} día(s)`}
              </span>
              <br />
              <span className="text-gray-500">
                {r.weeklyHours !== null ? `${r.weeklyHours} h semanales` : "horas sin cargar"}
                {" "}· la cobertura suma {r.coverageWeeklyHours} h/sem
              </span>
              {!r.freeAll && (
                <span className="block text-amber-700">
                  Ocupado: {r.busyDays.slice(0, 6).map((b: any) => `${fmtDay(b.date)} (${b.reason})`).join(", ")}
                  {r.busyDays.length > 6 && ` y ${r.busyDays.length - 6} más`}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Panel de aprobación para PENDING_SUPERVISOR. */
export function ApprovalPanel({ vacation: v, onApproved, onReject }: {
  vacation: any;
  onApproved: () => void;
  onReject: () => void;
}) {
  const [rotative, setRotative] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRotative(null); setNote(""); setError(null); }, [v.id]);

  const { data: valRes, isLoading } = useQuery({
    queryKey: ["vacation-approval-validation", v.id, v.updatedAt],
    queryFn: async () => {
      const res = await fetch("/api/vacations/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: v.employeeId,
          startDate: String(v.startDate).slice(0, 10),
          endDate: String(v.endDate).slice(0, 10),
          excludeRequestId: v.id,
        }),
      });
      if (!res.ok) throw new Error("No se pudo validar");
      return res.json();
    },
  });
  const validation = valRes?.validation;
  const hasBlocking = validation?.conflictLevel === "BLOCKING";
  const hasWarnings = validation?.conflictLevel === "WARNING";

  const approve = async (confirmWarnings: boolean) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/vacations/${v.id}/supervisor-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(note.trim() && { note: note.trim() }),
          confirmWarnings,
          rotativeEmployeeId: rotative,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo aprobar");
      onApproved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !validation) {
    return <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />Revisando la solicitud...</div>;
  }

  return (
    <div className="space-y-4 border-t border-gray-100 pt-4">
      <p className="text-xs font-semibold text-gray-800">Revisión antes de aprobar</p>
      <BalanceBox b={validation.balance} />
      <WarningsBox validation={validation} />
      {validation.rotativos?.applies && (
        <CoveragePicker vacationId={v.id} value={rotative} onChange={setRotative} />
      )}
      <div>
        <label className="label">Nota del supervisor (opcional)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input resize-none" disabled={busy} />
      </div>
      {hasWarnings && (
        <p className="text-[11px] text-amber-800">
          Hay advertencias: para aprobar hay que confirmar con <b>Aprobar igual</b>. Queda registrado con la lista de advertencias.
        </p>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={onReject} disabled={busy} className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
          <XCircle className="w-3.5 h-3.5" />Rechazar
        </button>
        {hasWarnings ? (
          <button onClick={() => approve(true)} disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50">
            {busy ? "Procesando..." : "Aprobar igual"}
          </button>
        ) : (
          <button onClick={() => approve(false)} disabled={busy || hasBlocking}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
            {busy ? "Procesando..." : "Aprobar"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Cambiar o quitar el rotativo de una solicitud aprobada. */
export function ChangeCoveragePanel({ vacation: v, onDone, onBack }: {
  vacation: any;
  onDone: () => void;
  onBack: () => void;
}) {
  const currentId: string | null = v.coverages?.find((c: any) => c.status === "ACTIVE")?.employeeId ?? null;
  const [rotative, setRotative] = useState<string | null>(currentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/vacations/${v.id}/coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotativeEmployeeId: rotative }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo cambiar la cobertura");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <CoveragePicker vacationId={v.id} value={rotative} onChange={setRotative} />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onBack} disabled={busy} className="btn-secondary">Volver</button>
        <button onClick={save} disabled={busy || rotative === currentId} className="btn-primary">
          {busy ? "Guardando..." : rotative ? "Guardar cobertura" : "Quitar cobertura"}
        </button>
      </div>
    </div>
  );
}
