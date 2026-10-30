"use client";
// Los 4 indicadores de Vacaciones. Cada uno, al tocarlo, filtra la lista por
// ese criterio (definición en src/lib/vacations/kpis.ts); tocarlo de nuevo
// saca el filtro.
import { useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle2, XCircle, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VacationKpi } from "@/lib/vacations/kpis";

export interface MetricsResponse {
  solicitadas: number;
  aprobadas:   number;
  rechazadas:  number;
  hoy:         number;
  rrhhStep:    boolean;
}

export function useVacationMetrics(branchId?: string | null) {
  return useQuery<{ data: MetricsResponse }>({
    queryKey: ["vacations-metrics", branchId ?? "all"],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (branchId) p.set("branchId", branchId);
      const res = await fetch(`/api/vacations/metrics?${p}`);
      if (!res.ok) throw new Error("Error metrics");
      return res.json();
    },
    staleTime: 30_000,
  });
}

const CARDS: Array<{ kpi: VacationKpi; label: string; icon: any; tone: Tone; hint: string }> = [
  { kpi: "solicitadas", label: "Solicitadas",       icon: Clock,        tone: "yellow", hint: "Pendientes de aprobación de supervisión" },
  { kpi: "aprobadas",   label: "Aprobadas",         icon: CheckCircle2, tone: "green",  hint: "Aprobadas en curso o futuras" },
  { kpi: "rechazadas",  label: "Rechazadas",        icon: XCircle,      tone: "red",    hint: "Rechazadas este mes" },
  { kpi: "hoy",         label: "De vacaciones hoy", icon: Sun,          tone: "indigo", hint: "Aprobadas cuyo período incluye hoy" },
];

export default function VacationMetrics({ branchId, active, onSelect }: {
  branchId?: string | null;
  active: VacationKpi | null;
  onSelect: (kpi: VacationKpi | null) => void;
}) {
  const { data, isLoading } = useVacationMetrics(branchId);
  const m = data?.data;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {CARDS.map((c) => (
        <KpiCard
          key={c.kpi}
          label={c.label}
          value={m?.[c.kpi]}
          icon={c.icon}
          tone={c.tone}
          hint={c.hint}
          loading={isLoading}
          selected={active === c.kpi}
          onClick={() => onSelect(active === c.kpi ? null : c.kpi)}
        />
      ))}
    </div>
  );
}

type Tone = "yellow" | "green" | "red" | "indigo";

const TONE: Record<Tone, { ring: string; iconBg: string; iconText: string; selected: string }> = {
  yellow: { ring: "ring-yellow-100", iconBg: "bg-yellow-50", iconText: "text-yellow-600", selected: "ring-2 ring-yellow-400" },
  green:  { ring: "ring-green-100",  iconBg: "bg-green-50",  iconText: "text-green-600",  selected: "ring-2 ring-green-400" },
  red:    { ring: "ring-red-100",    iconBg: "bg-red-50",    iconText: "text-red-600",    selected: "ring-2 ring-red-400" },
  indigo: { ring: "ring-indigo-100", iconBg: "bg-indigo-50", iconText: "text-indigo-600", selected: "ring-2 ring-indigo-400" },
};

function KpiCard({ label, value, icon: Icon, tone, loading, hint, selected, onClick }: {
  label: string; value: number | undefined; icon: any; tone: Tone; loading: boolean; hint: string;
  selected: boolean; onClick: () => void;
}) {
  const t = TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={selected}
      className={cn("card px-3 py-2.5 flex items-center gap-2.5 text-left hover:shadow-md transition-shadow", selected ? t.selected : t.ring)}
    >
      <div className={cn("rounded-md p-2 shrink-0", t.iconBg)}>
        <Icon className={cn("w-4 h-4", t.iconText)} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-medium tracking-wide text-gray-500 leading-tight">{label}</p>
        <p className="text-base font-semibold text-gray-900 leading-tight mt-0.5">
          {loading ? "—" : (value ?? 0)}
        </p>
      </div>
    </button>
  );
}
