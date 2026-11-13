"use client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckSquare, ChevronDown, ChevronRight, ChevronUp, Loader2, Plus, Square, Undo2, X } from "lucide-react";
import type { TimeEventStatus, UserRole } from "@prisma/client";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import { parseCalendarDate, toLocalISODate } from "@/lib/dates/calendar";
import { fmtMinutes, joinHM } from "@/lib/time-events/duration";
import { allocateCompensation, TIME_EVENT_TYPE_LABEL } from "@/lib/time-events/summary";
import { canTransition } from "@/lib/time-events/validation";
import { DurationInput } from "@/components/ui/DurationInput";
import { TIME_EVENT_STATUS_META } from "./TimeEventCard";
import { Breakdown } from "./EmployeeBalanceSection";

type BulkAction = "compensation" | "payroll" | "waive";

const BULK: Record<BulkAction, { label: string; to: TimeEventStatus; noteRequired: boolean; className: string }> = {
  compensation: { label: "Aprobar compensación", to: "APPROVED_FOR_COMPENSATION", noteRequired: false, className: "bg-green-600 hover:bg-green-700 text-white" },
  payroll:      { label: "Enviar a descuento",   to: "SENT_TO_PAYROLL_DEDUCTION", noteRequired: true,  className: "bg-red-600 hover:bg-red-700 text-white" },
  waive:        { label: "Condonar",             to: "WAIVED",                    noteRequired: true,  className: "bg-gray-700 hover:bg-gray-900 text-white" },
};

const fmtDay = (d: string | Date) => parseCalendarDate(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });

interface Props {
  employeeId: string;
  role: UserRole | undefined;
  /** Abre el detalle de una deuda (historial, compensaciones, acciones puntuales). */
  onOpenEvent: (id: string) => void;
  /** Si está, muestra el botón para quitar el filtro por persona. */
  onClose?: () => void;
  /** Avisar a la pantalla que cambió algo (para refrescar sus listas). */
  onChanged?: () => void;
}

/**
 * Resumen de una persona en Asistencia: total adeudado, compensado y pendiente;
 * compensación por persona (se reparte entre sus deudas, la más vieja primero);
 * resolver varias deudas juntas; y deshacer una compensación mal cargada.
 */
export default function PersonDebtPanel({ employeeId, role, onOpenEvent, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const canResolve = role ? can.resolveTimeEvent(role) : false;
  const canCompensate = role ? can.addCompensation(role) : false;

  const [mode, setMode] = useState<null | "compensate" | "select">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // Compensación
  const [hh, setHh] = useState("");
  const [mm, setMm] = useState("");
  const [compDate, setCompDate] = useState(() => toLocalISODate(new Date()));
  const [note, setNote] = useState("");
  // Selección
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  // Compensaciones cargadas
  const [showComps, setShowComps] = useState(false);
  const [undoKey, setUndoKey] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["time-events-person", employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/time-events/person?employeeId=${encodeURIComponent(employeeId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar el resumen");
      return json.data;
    },
  });

  const events: any[] = useMemo(() => data?.events ?? [], [data]);
  const totals = data?.totals;
  // Más nuevas arriba para leer; el reparto de una compensación va de la más vieja a la más nueva.
  const shown = useMemo(() => [...events].filter((e) => e.status !== "CANCELLED").reverse(), [events]);
  const cancelled = events.length - shown.length;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["time-events-person"] }),
      qc.invalidateQueries({ queryKey: ["time-events"] }),
      qc.invalidateQueries({ queryKey: ["time-events-balance"] }),
      qc.invalidateQueries({ queryKey: ["time-event-detail"] }),
      qc.invalidateQueries({ queryKey: ["hour-bank-balance"] }),
      qc.invalidateQueries({ queryKey: ["hour-bank-balances"] }),
      qc.invalidateQueries({ queryKey: ["absences"] }),
    ]);
    onChanged?.();
  };

  const reset = () => { setMode(null); setError(null); setHh(""); setMm(""); setNote(""); setSelected(new Set()); setBulkAction(null); };

  const call = async (url: string, init: RequestInit, done: (json: any) => string) => {
    setBusy(true); setError(null); setOkMsg(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      reset();
      setUndoKey(null);
      setOkMsg(done(json));
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Compensación por persona
  const minutes = joinHM(hh, mm);
  const max = totals?.toCompensate ?? 0;
  const openDebts = useMemo(() => events
    .filter((e) => (e.status === "APPROVED_FOR_COMPENSATION" || e.status === "PARTIALLY_COMPENSATED") && e.minutesRemaining > 0)
    .map((e) => ({ id: e.id as string, date: parseCalendarDate(e.date), createdAt: new Date(e.createdAt), minutesRemaining: e.minutesRemaining as number })),
  [events]);
  const preview = minutes && minutes > 0 ? allocateCompensation(openDebts, minutes) : null;
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const submitCompensation = () => {
    if (minutes === null || minutes <= 0) { setError("Indicá cuánto se compensó."); return; }
    if (minutes > max) { setError(`No se puede compensar más que lo pendiente a compensar. El máximo es ${fmtMinutes(max)}.`); return; }
    call("/api/time-events/person/compensations", {
      method: "POST",
      body: JSON.stringify({ employeeId, date: compDate, minutes, note: note.trim() || null }),
    }, (json) => {
      const n = json.data?.applied?.length ?? 1;
      return `Compensación de ${fmtMinutes(minutes)} registrada${n > 1 ? `, repartida entre ${n} deudas` : ""}.`;
    });
  };

  // ---- Resolver varias
  const selectable = (e: any) => (Object.keys(BULK) as BulkAction[]).some((a) => canTransition(e.status, BULK[a].to));
  const selectableEvents = shown.filter(selectable);
  const selectedEvents = shown.filter((e) => selected.has(e.id));
  // Cada acción se aplica a las elegidas que la admiten (las demás quedan como están).
  const eligible = (a: BulkAction) => selectedEvents.filter((e) => canTransition(e.status, BULK[a].to));
  const minutesOf = (list: any[]) => list.reduce((acc, e) => acc + (e.minutesOwed - e.minutesCompensated), 0);
  const selectedMinutes = minutesOf(selectedEvents);
  const target = bulkAction ? eligible(bulkAction) : [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submitBulk = () => {
    if (!bulkAction) return;
    if (BULK[bulkAction].noteRequired && !note.trim()) { setError("El motivo es obligatorio."); return; }
    const n = target.length;
    const mins = minutesOf(target);
    if (n === 0) return;
    call("/api/time-events/bulk-resolve", {
      method: "POST",
      body: JSON.stringify({ ids: target.map((e) => e.id), action: bulkAction, note: note.trim() || null }),
    }, () => `${BULK[bulkAction].label}: ${n} deuda${n === 1 ? "" : "s"} (${fmtMinutes(mins)}).`);
  };

  // ---- Compensaciones cargadas, agrupadas por carga
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; batchId: string | null; id: string; date: string; minutes: number; note: string | null; by: string | null; parts: any[] }>();
    for (const c of (data?.compensations ?? []) as any[]) {
      const key = c.batchId ? `b:${c.batchId}` : `c:${c.id}`;
      const g = map.get(key) ?? { key, batchId: c.batchId, id: c.id, date: c.date, minutes: 0, note: c.note, by: c.registeredBy?.name ?? null, parts: [] as any[] };
      g.minutes += c.minutesCompensated;
      g.parts.push(c);
      map.set(key, g);
    }
    return [...map.values()];
  }, [data]);

  const undo = (g: (typeof groups)[number]) => call(
    g.batchId ? `/api/time-events/compensations/${g.batchId}?batch=1` : `/api/time-events/compensations/${g.id}`,
    { method: "DELETE" },
    () => `Se deshizo la compensación de ${fmtMinutes(g.minutes)} del ${fmtDay(g.date)}.`,
  );

  if (isLoading) {
    return <div className="card p-6 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }
  if (loadError || !data) {
    return (
      <div className="card p-4 text-sm text-red-700 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{(loadError as Error)?.message ?? "No se pudo cargar el resumen"}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Encabezado */}
      <div className="px-4 py-3 flex items-start justify-between gap-2 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 break-words">{data.employee.name}</p>
          <p className="text-xs text-gray-500 break-words">
            {[data.employee.positionName, data.employee.branchName].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="btn-secondary text-xs py-1 px-2 shrink-0">
            <X className="w-3.5 h-3.5" />Quitar filtro
          </button>
        )}
      </div>

      {/* Totales */}
      <div className="px-4 py-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Total label="Adeudado" value={totals.owed} color="text-orange-700" />
          <Total label="Compensado" value={totals.compensated} color="text-indigo-700" />
          <Total label="Pendiente" value={totals.pending} color={totals.pending > 0 ? "text-red-700" : "text-gray-500"} strong />
        </div>
        <Breakdown row={totals} />
        {totals.events === 0 && <p className="text-xs text-gray-400">Sin llegadas tarde, retiros ni ausencias con horas adeudadas.</p>}
      </div>

      {/* Mensajes */}
      {okMsg && mode === null && (
        <p className="mx-4 mb-3 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">{okMsg}</p>
      )}
      {error && mode === null && (
        <p className="mx-4 mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">{error}</p>
      )}

      {/* Acciones */}
      {mode === null && (canCompensate || canResolve) && totals.events > 0 && (
        <div className="px-4 pb-3 space-y-1.5">
          <div className="flex flex-col sm:flex-row gap-2">
            {canCompensate && (
              <button
                type="button"
                disabled={max === 0}
                onClick={() => { setMode("compensate"); setError(null); setOkMsg(null); setCompDate(toLocalISODate(new Date())); }}
                className="px-3 py-2 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />Registrar compensación
              </button>
            )}
            {canResolve && selectableEvents.length > 0 && (
              <button
                type="button"
                onClick={() => { setMode("select"); setError(null); setOkMsg(null); setSelected(new Set()); }}
                className="btn-secondary justify-center"
              >
                <CheckSquare className="w-4 h-4" />Resolver varias
              </button>
            )}
          </div>
          {canCompensate && max === 0 && totals.inReview > 0 && (
            <p className="text-[11px] text-gray-500">
              Para registrar una compensación primero hay que aprobar que se compense (hoy está todo en revisión).
            </p>
          )}
        </div>
      )}

      {/* Formulario: compensación por persona */}
      {mode === "compensate" && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60 space-y-3">
          <p className="text-sm font-semibold text-gray-900">Registrar compensación</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="comp-h">Tiempo compensado *</label>
              <DurationInput id="comp-h" hours={hh} minutes={mm} onChange={(h, m) => { setHh(h); setMm(m); setError(null); }} disabled={busy} />
              <p className="text-[11px] text-gray-500 mt-1">Máximo: {fmtMinutes(max)} (lo pendiente a compensar).</p>
            </div>
            <div>
              <label className="label" htmlFor="comp-d">Día en que compensó *</label>
              <input id="comp-d" type="date" className="input" value={compDate} onChange={(e) => setCompDate(e.target.value)} disabled={busy} />
            </div>
          </div>
          {preview && preview.ok && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <p className="text-[11px] font-medium text-indigo-900">Se aplica empezando por la deuda más vieja:</p>
              <ul className="mt-1 space-y-0.5">
                {preview.parts.map((part) => {
                  const e = byId.get(part.id);
                  return (
                    <li key={part.id} className="text-xs text-indigo-900 flex justify-between gap-3">
                      <span>{e ? `${TIME_EVENT_TYPE_LABEL[e.type] ?? e.type} del ${fmtDay(e.date)}` : part.id}</span>
                      <span className="font-medium whitespace-nowrap">{fmtMinutes(part.minutes)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {preview && !preview.ok && minutes! > max && (
            <p className="text-xs text-red-700">Supera lo pendiente a compensar. El máximo es {fmtMinutes(max)}.</p>
          )}
          <div>
            <label className="label" htmlFor="comp-n">Nota (opcional)</label>
            <input id="comp-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy} />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button type="button" onClick={reset} disabled={busy} className="btn-secondary justify-center">Volver</button>
            <button
              type="button"
              onClick={submitCompensation}
              disabled={busy || !minutes || minutes <= 0 || minutes > max || !compDate}
              className="px-3 py-2 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            >
              {busy ? "Guardando..." : minutes && minutes > 0 ? `Registrar ${fmtMinutes(minutes)}` : "Registrar"}
            </button>
          </div>
        </div>
      )}

      {/* Barra de selección */}
      {mode === "select" && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">
              {selectedEvents.length === 0 ? "Elegí las deudas" : `${selectedEvents.length} elegida${selectedEvents.length === 1 ? "" : "s"} · ${fmtMinutes(selectedMinutes)}`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected(selected.size === selectableEvents.length ? new Set<string>() : new Set<string>(selectableEvents.map((e) => e.id as string)))}
                className="btn-secondary text-xs py-1 px-2"
              >
                {selected.size === selectableEvents.length ? "Ninguna" : "Todas"}
              </button>
              <button type="button" onClick={reset} disabled={busy} className="btn-secondary text-xs py-1 px-2">Volver</button>
            </div>
          </div>
          {bulkAction === null ? (
            <div className="flex flex-col sm:flex-row gap-2">
              {(Object.keys(BULK) as BulkAction[]).map((a) => {
                const n = eligible(a).length;
                return (
                  <button
                    key={a}
                    type="button"
                    disabled={n === 0}
                    onClick={() => { setBulkAction(a); setNote(""); setError(null); }}
                    className={cn("px-3 py-2 rounded-md text-sm font-medium disabled:opacity-40", BULK[a].className)}
                  >
                    {BULK[a].label}{selectedEvents.length > 0 ? ` (${n})` : ""}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-700">
                <span className="font-semibold">{BULK[bulkAction].label}</span> para {target.length} deuda{target.length === 1 ? "" : "s"} ({fmtMinutes(minutesOf(target))}).
                {target.length < selectedEvents.length && ` Las otras ${selectedEvents.length - target.length} elegidas no admiten esta acción y quedan como están.`}
                {bulkAction === "payroll" && " Se descuenta del sueldo: es definitivo."}
                {bulkAction === "waive" && " La deuda queda saldada sin compensación ni descuento."}
              </p>
              <label className="label" htmlFor="bulk-n">{BULK[bulkAction].noteRequired ? "Motivo (obligatorio)" : "Nota (opcional)"}</label>
              <textarea id="bulk-n" rows={2} className="input resize-none" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy} />
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                <button type="button" onClick={() => { setBulkAction(null); setError(null); }} disabled={busy} className="btn-secondary justify-center">Cambiar acción</button>
                <button
                  type="button"
                  onClick={submitBulk}
                  disabled={busy || (BULK[bulkAction].noteRequired && !note.trim())}
                  className={cn("px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50", BULK[bulkAction].className)}
                >
                  {busy ? "Procesando..." : `Confirmar: ${BULK[bulkAction].label.toLowerCase()}`}
                </button>
              </div>
            </div>
          )}
          {bulkAction === null && selectedEvents.length > 0 && eligible("compensation").length < selectedEvents.length && (
            <p className="text-[11px] text-gray-500">
              El número es a cuántas de las elegidas se aplica. Aprobar compensación y Condonar: solo deudas en revisión. Enviar a descuento: también las que están a compensar sin compensaciones cargadas.
            </p>
          )}
        </div>
      )}

      {/* Deudas */}
      {shown.length > 0 && (
        <ul className="border-t border-gray-100 divide-y divide-gray-100">
          {shown.map((e) => {
            const meta = TIME_EVENT_STATUS_META[e.status] ?? TIME_EVENT_STATUS_META.PENDING_REVIEW;
            const inSelect = mode === "select";
            const canPick = inSelect && selectable(e) && bulkAction === null;
            const skipped = inSelect && bulkAction !== null && selected.has(e.id) && !target.some((t) => t.id === e.id);
            const picked = selected.has(e.id);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  disabled={inSelect && !canPick}
                  onClick={() => (inSelect ? toggle(e.id) : onOpenEvent(e.id))}
                  className={cn("w-full text-left px-4 py-2.5 flex items-start gap-2.5", picked && !skipped && "bg-blue-50/70", inSelect && ((!canPick && !picked) || skipped) && "opacity-50")}
                >
                  {inSelect && (
                    picked ? <CheckSquare className="w-5 h-5 text-blue-600 shrink-0" /> : <Square className="w-5 h-5 text-gray-300 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{TIME_EVENT_TYPE_LABEL[e.type] ?? e.type}</span>
                        <span className="text-gray-400"> · </span>
                        <span className="font-semibold">{fmtMinutes(e.minutesOwed)}</span>
                      </p>
                      <p className="text-xs text-gray-500 shrink-0">{fmtDay(e.date)}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded-full border", meta.color)}>{meta.label}</span>
                      {e.minutesCompensated > 0 && e.minutesRemaining > 0 && (
                        <span className="text-[11px] text-indigo-700">compensado {fmtMinutes(e.minutesCompensated)} · falta {fmtMinutes(e.minutesRemaining)}</span>
                      )}
                    </div>
                  </div>
                  {!inSelect && <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-1" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {cancelled > 0 && (
        <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          {cancelled} registro{cancelled === 1 ? "" : "s"} cancelado{cancelled === 1 ? "" : "s"} no se muestra{cancelled === 1 ? "" : "n"} ni cuenta{cancelled === 1 ? "" : "n"}.
        </p>
      )}

      {/* Compensaciones cargadas */}
      {groups.length > 0 && (
        <div className="border-t border-gray-100">
          <button type="button" onClick={() => setShowComps((v) => !v)} className="w-full px-4 py-2.5 flex items-center justify-between text-left">
            <span className="text-xs font-semibold text-gray-800">Compensaciones cargadas ({groups.length})</span>
            {showComps ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showComps && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {groups.map((g) => (
                <li key={g.key} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-semibold text-indigo-700">{fmtMinutes(g.minutes)}</span>
                        <span className="text-gray-400"> · </span>{fmtDay(g.date)}
                      </p>
                      <p className="text-[11px] text-gray-500 break-words">
                        {g.parts.length === 1
                          ? `Aplicada a ${(TIME_EVENT_TYPE_LABEL[g.parts[0].timeEvent.type] ?? "").toLowerCase()} del ${fmtDay(g.parts[0].timeEvent.date)}`
                          : `Repartida: ${g.parts.map((c: any) => `${fmtMinutes(c.minutesCompensated)} al ${fmtDay(c.timeEvent.date)}`).join(", ")}`}
                        {g.by ? ` · cargó ${g.by}` : ""}
                      </p>
                      {g.note && <p className="text-[11px] text-gray-500 italic break-words">{g.note}</p>}
                    </div>
                    {canCompensate && (undoKey === g.key ? (
                      <div className="flex gap-1.5 shrink-0">
                        <button type="button" disabled={busy} onClick={() => undo(g)} className="px-2 py-1 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
                          {busy ? "..." : "Sí, deshacer"}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setUndoKey(null)} className="btn-secondary text-xs py-1 px-2">No</button>
                      </div>
                    ) : (
                      <button type="button" disabled={busy || mode !== null} onClick={() => { setUndoKey(g.key); setError(null); setOkMsg(null); }} className="btn-secondary text-xs py-1 px-2 shrink-0">
                        <Undo2 className="w-3.5 h-3.5" />Deshacer
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Total({ label, value, color, strong }: { label: string; value: number; color: string; strong?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-lg border px-2 py-2", strong && value > 0 ? "border-red-200 bg-red-50/40" : "border-gray-200")}>
      <p className="text-[11px] text-gray-500 font-medium truncate">{label}</p>
      <p className={cn("text-sm font-semibold leading-tight mt-0.5", color)}>{fmtMinutes(value)}</p>
    </div>
  );
}
