"use client";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  label:    string;
  value:    string;
  sublabel?: string;
  variation?: number | null;
  accent?:   boolean;
}

export function KPICard({ label, value, sublabel, variation, accent }: Props) {
  const varColor = variation == null
    ? "text-gray-400"
    : variation > 0 ? "text-emerald-600"
    : variation < 0 ? "text-red-500" : "text-gray-400";
  const VarIcon = variation == null || variation === 0 ? Minus : variation > 0 ? TrendingUp : TrendingDown;

  return (
    <div
      className="card p-5"
      style={accent ? { borderColor: "#D4632A", borderWidth: 1 } : {}}
    >
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className="mt-1.5 text-2xl font-bold" style={{ color: "#1E2D5A" }}>{value}</p>
      <div className="flex items-center gap-2 mt-2">
        {variation != null && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${varColor}`}>
            <VarIcon className="w-3.5 h-3.5" />
            {variation > 0 ? "+" : ""}{variation.toFixed(1)}%
          </span>
        )}
        {sublabel && <span className="text-xs text-gray-400">{sublabel}</span>}
      </div>
    </div>
  );
}
