"use client";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  label:     string;
  value:     string;
  sublabel?: string;
  variation?: number | null;
}

const KPI_CSS = `
.kpi-card {
  padding: 1.125rem 1rem;
  border-radius: 12px;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  border-left: 4px solid #D4632A;
  min-height: 110px;
  display: flex; flex-direction: column; justify-content: center;
  gap: 0.5rem;
  box-sizing: border-box;
  overflow: hidden;
}
@media (min-width: 768px) {
  .kpi-card { padding: 1.5rem 1.25rem; min-height: 120px; }
}
.kpi-label {
  font-size: 10px;
  color: #6b7280;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1.2;
}
@media (min-width: 768px) { .kpi-label { font-size: 11px; } }

.kpi-value {
  font-size: clamp(1.1rem, 2.2vw, 1.5rem);
  font-weight: 900;
  line-height: 1.1;
  color: #1E2D5A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-value--long { font-size: 1.1rem; }

.kpi-footer {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
}
.kpi-var {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 11px; font-weight: 600;
}
.kpi-sublabel { font-size: 11px; color: #9ca3af; }
`;

export function KPICard({ label, value, sublabel, variation }: Props) {
  // hasVarProp: el caller envió la prop (incluso null). Determina si renderizar el bloque.
  // isValidVar: el número es real y finito. Determina si mostrar el % o "N/A".
  const hasVarProp = variation !== undefined;
  const isValidVar = variation != null && Number.isFinite(variation);
  const varColor   = !isValidVar ? "#9ca3af"
    : variation! > 0 ? "#059669"
    : variation! < 0 ? "#ef4444" : "#9ca3af";
  const VarIcon    = !isValidVar || variation === 0 ? Minus : variation! > 0 ? TrendingUp : TrendingDown;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KPI_CSS }} />
      <div className="kpi-card">
        <div className="kpi-label">{label}</div>
        <div className={value.length > 10 ? "kpi-value kpi-value--long" : "kpi-value"}>{value}</div>
        {(hasVarProp || sublabel) && (
          <div className="kpi-footer">
            {hasVarProp && (
              <span
                className="kpi-var"
                style={{ color: varColor }}
                title={!isValidVar ? "Sin base de comparación (día anterior sin actividad)" : undefined}
              >
                <VarIcon style={{ width: 14, height: 14 }} />
                {isValidVar ? `${variation! > 0 ? "+" : ""}${variation!.toFixed(1)}%` : "N/A"}
              </span>
            )}
            {sublabel && <span className="kpi-sublabel">{sublabel}</span>}
          </div>
        )}
      </div>
    </>
  );
}
