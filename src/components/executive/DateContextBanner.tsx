"use client";
import { CalendarSearch, Info } from "lucide-react";

interface Props {
  /** Fecha pedida explícitamente. null = modo default, no se renderiza nada. */
  requestedDate: Date | string | null;
  /** Solo aplica cuando requestedDate != null. */
  hasData: boolean;
}

function fmtAR(d: Date | string): string {
  const date = new Date(d);
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yy = date.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

/**
 * Banner informativo para consultas históricas. NO mezcla con AlertBanner
 * (amber/stale): esto comunica CONTEXTO ("estás viendo otra fecha"), no un
 * problema operativo.
 *
 *   - requestedDate=null         → no renderiza nada
 *   - requestedDate + hasData    → banner azul/neutral
 *   - requestedDate + sin datos  → banner gris/neutral
 */
export function DateContextBanner({ requestedDate, hasData }: Props) {
  if (!requestedDate) return null;
  const dateStr = fmtAR(requestedDate);

  if (hasData) {
    return (
      <div
        className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <CalendarSearch className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-900">
            Consultando datos del <span className="font-semibold">{dateStr}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Info className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
        <p className="text-sm text-gray-700">
          No hay datos disponibles para el <span className="font-semibold">{dateStr}</span>
        </p>
      </div>
    </div>
  );
}
