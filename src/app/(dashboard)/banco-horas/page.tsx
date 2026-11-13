"use client";
// Banco de horas: pedidos de día o franja (pedir, autorizar, rechazar,
// cancelar) y saldos por persona. Encargado/a: su sucursal. RRHH y Dirección:
// solo lectura.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Hourglass, Plus, XCircle, Ban } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { parseCalendarDate, toLocalISODate } from "@/lib/dates/calendar";
import { fmtMinutes, parseHHMM } from "@/lib/personal/schedule";
import { fmtHours, REQUEST_STATUS_LABEL } from "@/lib/hour-bank/hours";
import { FilterPanel } from "@/components/ui/FilterPanel";

const STATUS_META: Record<string, { color: string; icon: any }> = {
  PENDING:   { color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: Clock },
  APPROVED:  { color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  REJECTED:  { color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  CANCELLED: { color: "bg-gray-50 text-gray-600 border-gray-200",      icon: Ban },
};

const fmtDay = (d: string) =>
  parseCalendarDate(d).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", year: "2-digit" });

function periodLabel(r: any): string {
  const a = String(r.startDate).slice(0, 10), b = String(r.endDate).slice(0, 10);
  const days = a === b ? fmtDay(a) : `${fmtDay(a)} → ${fmtDay(b)}`;
  return r.startMinute !== null && r.endMinute !== null
    ? `${days} · ${fmtMinutes(r.startMinute)}–${fmtMinutes(r.endMinute)}`
    : `${days} · día completo`;
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
  return json;
}

export default function BancoHorasPage() {
  const { data: session, status } = useSession();
  const qc = useQueryClient();
  const role = session?.user?.role as UserRole | undefined;
  const userBranchId = session?.user?.branchId ?? "";
  const isBranchManager = role === "BRANCH_MANAGER";
  const ready = status === "authenticated";

  const canRequest = !!role && can.requestHourBank(role);
  const canAuthorize = !!role && can.authorizeHourBank(role);

  const [tab, setTab] = useState<"pedidos" | "saldos">("pedidos");
  const [showForm, setShowForm] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const branchId = isBranchManager ? userBranchId : branchFilter;

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn: () => fetch("/api/branches").then((r) => r.json()),
    enabled: ready,
  });
  const branches: any[] = branchRes?.data ?? [];

  const { data: listRes, isLoading } = useQuery({
    queryKey: ["hour-bank-requests", { branchId, statusFilter }],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "100" });
      if (branchId) p.set("branchId", branchId);
      if (statusFilter) p.set("status", statusFilter);
      const res = await fetch(`/api/hour-bank/requests?${p}`);
      if (!res.ok) throw new Error("Error al cargar");
      return res.json();
    },
    enabled: ready && tab === "pedidos",
  });
  const rows: any[] = listRes?.data ?? [];
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;

  const { data: balRes, isLoading: balLoading } = useQuery({
    queryKey: ["hour-bank-balances", { branchId }],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (branchId) p.set("branchId", branchId);
      const res = await fetch(`/api/hour-bank/balances?${p}`);
      if (!res.ok) throw new Error("Error al cargar");
      return res.json();
    },
    enabled: ready && tab === "saldos",
  });
  const balances: any[] = balRes?.data ?? [];

  const reload = () => {
    for (const k of ["hour-bank-requests", "hour-bank-balances", "hour-bank-balance", "hour-bank-cal", "hour-bank-day"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };

  if (status === "loading") return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Banco de horas</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Días o franjas que se toman contra las horas a favor. Las horas no vencen.
            {tab === "pedidos" && pendingCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">· {pendingCount} sin autorizar</span>
            )}
          </p>
        </div>
        {canRequest && (
          <button onClick={() => { setTab("pedidos"); setShowForm((v) => !v); }} className="btn-primary">
            <Plus className="w-4 h-4" />Pedir día o franja
          </button>
        )}
      </div>

      {showForm && canRequest && (
        <RequestForm
          branches={branches}
          fixedBranchId={isBranchManager ? userBranchId : null}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["pedidos", "saldos"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-3 py-1.5 rounded-md font-medium", tab === t ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-50")}>
              {t === "pedidos" ? "Pedidos" : "Saldos"}
            </button>
          ))}
        </div>
        <FilterPanel
          activeCount={[!isBranchManager && branchFilter, tab === "pedidos" && statusFilter].filter(Boolean).length}
          onClear={() => { setBranchFilter(""); setStatusFilter(""); }}>
          {!isBranchManager && (
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input w-auto">
              <option value="">Todas las sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {tab === "pedidos" && (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-auto">
              <option value="">Todos los estados</option>
              {Object.keys(STATUS_META).map((k) => <option key={k} value={k}>{REQUEST_STATUS_LABEL[k]}</option>)}
            </select>
          )}
        </FilterPanel>
      </div>

      {tab === "pedidos" ? (
        isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center">
            <Hourglass className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No hay pedidos con los filtros aplicados.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <RequestCard key={r.id} r={r} canAuthorize={canAuthorize} canRequest={canRequest} onChanged={reload} />
            ))}
          </div>
        )
      ) : balLoading ? (
        <div className="card p-4 h-24 animate-pulse bg-gray-50" />
      ) : balances.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-gray-400">Todavía nadie tiene movimientos en el banco de horas.</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {balances.map((b) => (
            <Link key={b.employee.id} href={`/empleados/${b.employee.id}?tab=banco-horas`}
              className="block px-4 py-2.5 hover:bg-gray-50">
              <span className="flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">
                    {b.employee.lastName}, {b.employee.firstName}
                    {!b.employee.active && <span className="ml-1.5 text-xs font-normal text-gray-400">(baja)</span>}
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    {b.employee.position?.name}{b.employee.currentBranch ? ` · ${b.employee.currentBranch.name}` : ""}
                  </span>
                </span>
                <span className={cn("text-sm font-semibold tabular-nums", b.balance < 0 ? "text-red-700" : "text-gray-900")}>
                  {fmtHours(b.balance)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pedir
// -----------------------------------------------------------------------------

function RequestForm({ branches, fixedBranchId, onClose, onSaved }: {
  branches: any[];
  fixedBranchId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = toLocalISODate(new Date());
  const [branchId, setBranchId] = useState(fixedBranchId ?? "");
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<"day" | "window">("day");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hours, setHours] = useState("");
  const [hoursTouched, setHoursTouched] = useState(false);
  const [coverId, setCoverId] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: empRes, isLoading: empLoading } = useQuery({
    queryKey: ["employees-for-hour-bank", branchId],
    queryFn: () => fetch(`/api/employees?${new URLSearchParams({ limit: "200", branchId })}`).then((r) => r.json()),
    enabled: !!branchId,
  });
  const employees: any[] = empRes?.data ?? [];

  const startMinute = kind === "window" ? parseHHMM(from) : null;
  const endMinute = kind === "window" ? parseHHMM(to) : null;
  const effectiveEnd = kind === "window" ? startDate : endDate;
  const windowReady = kind === "day" || (startMinute !== null && endMinute !== null && startMinute < endMinute);
  const datesReady = !!startDate && !!effectiveEnd && effectiveEnd >= startDate;

  const { data: prevRes, isFetching: prevLoading } = useQuery({
    queryKey: ["hour-bank-preview", employeeId, startDate, effectiveEnd, startMinute, endMinute],
    queryFn: () => send("/api/hour-bank/preview", "POST", { employeeId, startDate, endDate: effectiveEnd, startMinute, endMinute }),
    enabled: !!employeeId && datesReady && windowReady,
  });
  const preview = prevRes?.data;

  // Por defecto, las horas del turno según el horario; si se editaron, se respetan.
  useEffect(() => {
    if (hoursTouched) return;
    setHours(preview && preview.scheduleHours ? String(preview.scheduleHours) : "");
  }, [preview, hoursTouched]);

  const hoursNum = Number(String(hours).replace(",", "."));
  const hoursOk = hours !== "" && Number.isFinite(hoursNum) && hoursNum > 0;
  const after = preview && hoursOk ? Math.round((preview.balance - preview.pendingHours - hoursNum) * 100) / 100 : null;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await send("/api/hour-bank/requests", "POST", {
        employeeId, startDate, endDate: effectiveEnd, startMinute, endMinute,
        hours: hoursNum,
        coveredByEmployeeId: coverId || null,
        coverageNote: coverNote.trim() || null,
        requesterNote: note.trim() || null,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="card p-5 form-sheet">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Pedir día o franja por banco de horas</h3>
      <p className="text-xs text-gray-400 mb-4">Queda pendiente hasta que supervisión lo autorice. Recién ahí descuenta.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Sucursal *</label>
          {fixedBranchId ? (
            <input className="input bg-gray-50 text-gray-500" disabled
              value={branches.find((b) => b.id === fixedBranchId)?.name ?? "Tu sucursal"} />
          ) : (
            <select className="input" value={branchId}
              onChange={(e) => { setBranchId(e.target.value); setEmployeeId(""); setCoverId(""); }}>
              <option value="">Seleccioná sucursal</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="label">Persona *</label>
          <select className="input" value={employeeId} disabled={!branchId || empLoading}
            onChange={(e) => { setEmployeeId(e.target.value); setHoursTouched(false); }}>
            <option value="">{!branchId ? "Primero seleccioná sucursal" : "Seleccioná persona"}</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName} — {e.position?.name}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2 flex flex-wrap gap-4 text-sm text-gray-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={kind === "day"} onChange={() => { setKind("day"); setHoursTouched(false); }} />
            Día(s) completo(s)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={kind === "window"} onChange={() => { setKind("window"); setHoursTouched(false); }} />
            Franja de un día
          </label>
        </div>

        <div>
          <label className="label">{kind === "window" ? "Día *" : "Desde *"}</label>
          <input type="date" className="input" value={startDate}
            onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); setHoursTouched(false); }} />
        </div>
        {kind === "day" ? (
          <div>
            <label className="label">Hasta *</label>
            <input type="date" className="input" value={endDate} min={startDate}
              onChange={(e) => { setEndDate(e.target.value); setHoursTouched(false); }} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Desde la hora *</label>
              <input type="time" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setHoursTouched(false); }} />
            </div>
            <div>
              <label className="label">Hasta la hora *</label>
              <input type="time" className="input" value={to} onChange={(e) => { setTo(e.target.value); setHoursTouched(false); }} />
            </div>
          </div>
        )}

        <div>
          <label className="label">Horas que descuenta *</label>
          <input type="number" step="0.25" min="0.25" className="input" value={hours}
            onChange={(e) => { setHours(e.target.value); setHoursTouched(true); }} placeholder="Ej: 6" />
          <p className="text-[11px] text-gray-500 mt-1">
            {!employeeId ? "Elegí la persona para ver las horas de su turno."
              : prevLoading ? "Calculando según su horario..."
              : !preview ? ""
              : preview.scheduleHours === null ? "No tiene horario cargado: indicá las horas."
              : preview.scheduleHours === 0 ? "Según su horario no trabaja en ese día o franja: indicá las horas."
              : `Según su horario: ${fmtHours(preview.scheduleHours)}. Se puede editar.`}
          </p>
        </div>
        <div>
          <label className="label">Saldo</label>
          <div className={cn("rounded-lg border px-3 py-2 text-xs",
            after !== null && after < 0 ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-gray-50 border-gray-200 text-gray-700")}>
            {!preview ? "—" : (
              <>
                Tiene {fmtHours(preview.balance)}
                {preview.pendingHours > 0 && <> · otros pedidos sin autorizar: {fmtHours(preview.pendingHours)}</>}
                {after !== null && <> · quedaría en <b>{fmtHours(after)}</b></>}
                {after !== null && after < 0 && (
                  <span className="flex items-center gap-1 mt-1"><AlertTriangle className="w-3.5 h-3.5" />El saldo queda en negativo.</span>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <label className="label">Quién cubre</label>
          <select className="input" value={coverId} onChange={(e) => setCoverId(e.target.value)} disabled={!branchId}>
            <option value="">Nadie / se aclara abajo</option>
            {employees.filter((e) => e.id !== employeeId).map((e) => (
              <option key={e.id} value={e.id}>{e.lastName}, {e.firstName} — {e.position?.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Aclaración de la cobertura</label>
          <input className="input" value={coverNote} onChange={(e) => setCoverNote(e.target.value)}
            placeholder="Ej: cubre alguien de otra sucursal, no hace falta cubrir" maxLength={300} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Observaciones</label>
          <textarea className="input resize-none" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="form-actions flex gap-2 justify-end mt-4">
        <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">Cancelar</button>
        <button type="button" onClick={submit} className="btn-primary"
          disabled={busy || !employeeId || !datesReady || !windowReady || !hoursOk}>
          {busy ? "Guardando..." : "Pedir"}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta de un pedido, con sus acciones
// -----------------------------------------------------------------------------

function RequestCard({ r, canAuthorize, canRequest, onChanged }: {
  r: any; canAuthorize: boolean; canRequest: boolean; onChanged: () => void;
}) {
  const [mode, setMode] = useState<null | "approve" | "reject" | "cancel">(null);
  const [hours, setHours] = useState(String(Number(r.hours)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = STATUS_META[r.status] ?? STATUS_META.PENDING;
  const Icon = meta.icon;
  const cover = [r.coveredBy ? `${r.coveredBy.firstName} ${r.coveredBy.lastName}` : null, r.coverageNote].filter(Boolean).join(" · ");
  const edited = r.scheduleHours !== null && Number(r.scheduleHours) !== Number(r.hours);

  const canCancel = r.status === "PENDING" ? canRequest : r.status === "APPROVED" ? canAuthorize : false;
  const noteRequired = mode === "reject" || (mode === "cancel" && r.status === "APPROVED");

  const act = async () => {
    setBusy(true); setError(null);
    try {
      const body = mode === "approve"
        ? { action: "approve", hours: Number(String(hours).replace(",", ".")), note: note.trim() || null }
        : { action: mode, note: note.trim() || null };
      await send(`/api/hour-bank/requests/${r.id}`, "PATCH", body);
      setMode(null); setNote("");
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/empleados/${r.employeeId}?tab=banco-horas`} className="text-sm font-semibold text-gray-900 hover:underline">
              {r.employeeNameSnapshot}
            </Link>
            <span className="text-xs text-gray-500">{r.positionNameSnapshot}</span>
            <span className="text-sm font-bold text-gray-800">{fmtHours(Number(r.hours))}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {periodLabel(r)} · {r.branchNameSnapshot}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Cubre: {cover || "sin registrar"}
            {edited && <> · horas editadas (su turno: {fmtHours(Number(r.scheduleHours))})</>}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Pidió {r.requestedBy?.name}
            {r.decidedBy && <> · {r.status === "REJECTED" ? "rechazó" : "autorizó"} {r.decidedBy.name}</>}
            {r.requesterNote && <> · {r.requesterNote}</>}
            {r.decisionNote && <> · {r.decisionNote}</>}
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border shrink-0", meta.color)}>
          <Icon className="w-3 h-3" />{REQUEST_STATUS_LABEL[r.status]}
        </span>
      </div>

      {mode === null && ((r.status === "PENDING" && canAuthorize) || canCancel) && (
        <div className="px-4 pb-3 flex flex-wrap gap-2 justify-end">
          {canCancel && (
            <button onClick={() => setMode("cancel")} className="btn-secondary text-xs py-1.5 px-3">Cancelar pedido</button>
          )}
          {r.status === "PENDING" && canAuthorize && (
            <>
              <button onClick={() => setMode("reject")} className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                Rechazar
              </button>
              <button onClick={() => setMode("approve")}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-green-600 hover:bg-green-700 text-white">
                Autorizar
              </button>
            </>
          )}
        </div>
      )}

      {mode !== null && (
        <div className="px-4 pb-3 pt-3 border-t border-gray-100 bg-gray-50/50 space-y-3">
          {mode === "approve" && (
            <div className="max-w-[12rem]">
              <label className="label">Horas que descuenta</label>
              <input type="number" step="0.25" min="0.25" className="input" value={hours} onChange={(e) => setHours(e.target.value)} disabled={busy} />
            </div>
          )}
          <div>
            <label className="label">
              {mode === "approve" ? "Nota (opcional)" : noteRequired ? "Motivo (obligatorio)" : "Motivo (opcional)"}
            </label>
            <textarea className="input resize-none" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          {mode === "cancel" && r.status === "APPROVED" && (
            <p className="text-xs text-amber-800">El pedido ya está autorizado: al cancelarlo vuelven las horas al banco.</p>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => { setMode(null); setError(null); }} disabled={busy} className="btn-secondary text-xs py-1.5 px-3">Volver</button>
            <button onClick={act} disabled={busy || (noteRequired && !note.trim())}
              className={cn("px-3 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50",
                mode === "approve" ? "bg-green-600 hover:bg-green-700" : mode === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-900")}>
              {busy ? "Procesando..." : mode === "approve" ? "Autorizar y descontar" : mode === "reject" ? "Rechazar pedido" : "Cancelar pedido"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
