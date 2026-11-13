"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hourglass, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseCalendarDate } from "@/lib/dates/calendar";
import { fmtMinutes, joinHM, splitMinutes } from "@/lib/time-events/duration";
import { absenceCanOweHours } from "@/lib/time-events/summary";
import { DurationInput } from "@/components/ui/DurationInput";
import { TIME_EVENT_STATUS_META } from "./TimeEventCard";

type Resolution = "compensation" | "payroll" | "waive";

const OPTIONS: Array<{ value: Resolution; label: string; hint: string }> = [
  { value: "compensation", label: "A compensar", hint: "Queda debiendo esas horas: se compensan igual que una llegada tarde y restan del banco de horas." },
  { value: "payroll", label: "Descuento de sueldo", hint: "Queda registrada para liquidación, con la cantidad de días." },
  { value: "waive", label: "Condonar", hint: "No se descuenta ni se compensa." },
];

/** Chip para la tarjeta de la ausencia: "5 h · A compensar". */
export function AbsenceDebtChip({ debt }: { debt: any }) {
  if (!debt || debt.status === "CANCELLED") return null;
  const meta = TIME_EVENT_STATUS_META[debt.status] ?? TIME_EVENT_STATUS_META.PENDING_REVIEW;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border", meta.color)}>
      <Hourglass className="w-2.5 h-2.5" />{fmtMinutes(debt.minutesOwed)} · {meta.label}
    </span>
  );
}

interface Props {
  absence: any;
  canResolve: boolean;
  onOpenEvent: (id: string) => void;
  onChanged: () => void;
}

/**
 * Qué se hace con las horas de una ausencia injustificada: descuento de sueldo,
 * a compensar (genera la deuda en horas, según el horario de la persona en
 * esos días) o condonar. Si ya se resolvió, muestra la deuda.
 */
export default function AbsenceDebtSection({ absence: a, canResolve, onOpenEvent, onChanged }: Props) {
  const debt = a.timeEvent && a.timeEvent.status !== "CANCELLED" ? a.timeEvent : null;
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution>("compensation");
  const [hh, setHh] = useState("");
  const [mm, setMm] = useState("");
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isLoading } = useQuery({
    queryKey: ["absence-debt", a.id],
    queryFn: async () => {
      const res = await fetch(`/api/absences/${a.id}/debt`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudieron calcular las horas");
      const d = json.data;
      if (!touched && d.scheduleMinutes) {
        const s = splitMinutes(d.scheduleMinutes);
        setHh(s.hours ? String(s.hours) : ""); setMm(s.minutes ? String(s.minutes) : "");
      }
      return d;
    },
    enabled: open && !debt,
    staleTime: 0,
  });

  if (debt) {
    const meta = TIME_EVENT_STATUS_META[debt.status] ?? TIME_EVENT_STATUS_META.PENDING_REVIEW;
    return (
      <div className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Horas de la ausencia</p>
          <p className="text-sm text-gray-900">
            <span className="font-semibold">{fmtMinutes(debt.minutesOwed)}</span>
            <span className={cn("ml-2 inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded-full border", meta.color)}>{meta.label}</span>
          </p>
          {debt.minutesCompensated > 0 && debt.minutesRemaining > 0 && (
            <p className="text-[11px] text-indigo-700">Compensado {fmtMinutes(debt.minutesCompensated)} · falta {fmtMinutes(debt.minutesRemaining)}</p>
          )}
        </div>
        <button type="button" onClick={() => onOpenEvent(debt.id)} className="btn-secondary text-xs py-1.5 px-3">Ver deuda</button>
      </div>
    );
  }

  if (!canResolve || !absenceCanOweHours(a)) return null;

  if (!open) {
    return (
      <div className="mb-3">
        <button type="button" onClick={() => { setOpen(true); setError(null); }} className="btn-secondary text-xs py-1.5 px-3 text-amber-800 border-amber-300 hover:bg-amber-50">
          <Hourglass className="w-3.5 h-3.5" />Resolver horas de la ausencia
        </button>
      </div>
    );
  }

  const minutes = joinHM(hh, mm);
  const days: Array<{ date: string; minutes: number | null }> = preview?.days ?? [];
  const fmtDay = (d: string) => parseCalendarDate(d).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });

  const submit = async () => {
    if (minutes === null || minutes <= 0) { setError("Indicá cuántas horas son."); return; }
    if (resolution === "waive" && !note.trim()) { setError("El motivo de la condonación es obligatorio."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/absences/${a.id}/debt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, minutes, note: note.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-3 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Horas de la ausencia</p>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      ) : (
        <>
          <div className="space-y-1.5">
            {OPTIONS.map((o) => (
              <label key={o.value} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" className="mt-1" checked={resolution === o.value} onChange={() => { setResolution(o.value); setError(null); }} disabled={busy} />
                <span className="text-sm text-gray-800">
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-[11px] text-gray-500">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div>
            <label className="label" htmlFor={`abs-h-${a.id}`}>
              Horas{preview?.totalDays > 1 ? ` (${preview.totalDays} días)` : ""} *
            </label>
            <DurationInput id={`abs-h-${a.id}`} hours={hh} minutes={mm} onChange={(h, m) => { setHh(h); setMm(m); setTouched(true); setError(null); }} disabled={busy} />
            <p className="text-[11px] text-gray-500 mt-1">
              {preview?.scheduleMinutes === null ? "No tiene horario cargado en esas fechas: indicá las horas."
                : preview?.scheduleMinutes === 0 ? "Según su horario no trabajaba esos días: indicá las horas."
                : `Según su horario: ${fmtMinutes(preview?.scheduleMinutes)}. Se puede editar.`}
            </p>
            {days.length > 1 && preview?.scheduleMinutes !== null && (
              <ul className="mt-1 text-[11px] text-gray-500 space-y-0.5">
                {days.map((d) => (
                  <li key={d.date} className="flex justify-between gap-3 max-w-xs">
                    <span>{fmtDay(d.date)}</span>
                    <span>{d.minutes === null ? "sin horario" : d.minutes === 0 ? "no trabaja" : fmtMinutes(d.minutes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="label" htmlFor={`abs-n-${a.id}`}>{resolution === "waive" ? "Motivo (obligatorio)" : "Nota (opcional)"}</label>
            <input id={`abs-n-${a.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy} />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy} className="btn-secondary justify-center">Volver</button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !minutes || minutes <= 0 || (resolution === "waive" && !note.trim())}
              className="px-3 py-2 rounded-md text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
            >
              {busy ? "Guardando..." : `Confirmar: ${OPTIONS.find((o) => o.value === resolution)!.label.toLowerCase()}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
