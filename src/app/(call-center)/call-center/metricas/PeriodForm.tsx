"use client";

import { useState } from "react";
import { addDaysISO, resolvePeriod } from "@/lib/call-center/metrics/period";

export type Period = { from: string; to: string };

/** Período inicial de los bloques con fechas: los últimos 7 días. `today` es el día de Buenos Aires. */
export const defaultPeriod = (today: string): Period => ({ from: addDaysISO(today, -6), to: today });

/** Fechas desde/hasta con accesos rápidos. Avisa solo períodos válidos. */
export default function PeriodForm({ today, period, onChange }: { today: string; period: Period; onChange: (p: Period) => void }) {
  const [draft, setDraft] = useState<Period>(period);
  const [error, setError] = useState<string | null>(null);

  const apply = (p: Period) => {
    const r = resolvePeriod(p, today);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setDraft({ from: r.from, to: r.to });
    onChange({ from: r.from, to: r.to });
  };
  const quick: Array<[string, Period]> = [
    ["Hoy", { from: today, to: today }],
    ["Ayer", { from: addDaysISO(today, -1), to: addDaysISO(today, -1) }],
    ["7 días", defaultPeriod(today)],
    ["30 días", { from: addDaysISO(today, -29), to: today }],
  ];

  return (
    <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); apply(draft); }}>
        <label className="text-xs text-gray-600">
          Desde
          <input type="date" value={draft.from} max={today} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="mt-1 block h-11 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900" />
        </label>
        <label className="text-xs text-gray-600">
          Hasta
          <input type="date" value={draft.to} max={today} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="mt-1 block h-11 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900" />
        </label>
        <button type="submit" className="h-11 rounded-md bg-[#1E2D5A] px-4 text-sm font-semibold text-white hover:bg-[#16224a]">Ver</button>
        <div className="flex flex-wrap gap-2">
          {quick.map(([label, p]) => {
            const active = p.from === period.from && p.to === period.to;
            return (
              <button key={label} type="button" onClick={() => apply(p)} aria-pressed={active}
                className={`h-11 rounded-md border px-3 text-xs font-medium ${active ? "border-[#1E2D5A] bg-[#1E2D5A] text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
                {label}
              </button>
            );
          })}
        </div>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </>
  );
}
