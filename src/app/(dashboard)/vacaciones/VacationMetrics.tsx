"use client";
// Los 4 indicadores de Vacaciones. Cada uno, al tocarlo, filtra la lista por
// ese criterio (definición en src/lib/vacations/kpis.ts); tocarlo de nuevo
// saca el filtro.
import { useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle2, XCircle, Sun } from "lucide-react";
import { KpiCard, KpiGrid, type KpiTone } from "@/components/ui/Kpi";
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

const CARDS: Array<{ kpi: VacationKpi; label: string; icon: any; tone: KpiTone; hint: string }> = [
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
    <KpiGrid cols={4}>
      {CARDS.map((c) => (
        <KpiCard
          key={c.kpi}
          label={c.label}
          value={isLoading ? "—" : (m?.[c.kpi] ?? 0)}
          icon={c.icon}
          tone={c.tone}
          title={c.hint}
          selected={active === c.kpi}
          onClick={() => onSelect(active === c.kpi ? null : c.kpi)}
        />
      ))}
    </KpiGrid>
  );
}
