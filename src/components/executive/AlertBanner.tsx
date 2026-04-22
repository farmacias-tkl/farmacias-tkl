"use client";
import { AlertTriangle } from "lucide-react";

export function AlertBanner({ alertas }: { alertas: string[] }) {
  if (alertas.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1">
          {alertas.map((a, i) => (
            <p key={i} className="text-sm text-amber-900">{a}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
