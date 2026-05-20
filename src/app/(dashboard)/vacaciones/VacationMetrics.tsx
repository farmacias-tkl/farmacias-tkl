"use client";
import { useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle2, XCircle, Sun, Users, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricsResponse {
  pendingSupervisor:        number;
  pendingRrhh:              number;
  approvedThisMonth:        number;
  rejectedThisMonth:        number;
  approvedActiveToday:      number;
  pendingActiveToday:       number;
}

interface Props {
  branchId?: string | null;
}

export default function VacationMetrics({ branchId }: Props) {
  const { data, isLoading } = useQuery<{ data: MetricsResponse }>({
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

  const m = data?.data;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <KpiCard label="Pend. supervisor" value={m?.pendingSupervisor}      icon={Clock}        tone="yellow" loading={isLoading} />
      <KpiCard label="Pend. RRHH"       value={m?.pendingRrhh}            icon={Clock}        tone="blue"   loading={isLoading} />
      <KpiCard label="Aprob. este mes"  value={m?.approvedThisMonth}      icon={CheckCircle2} tone="green"  loading={isLoading} />
      <KpiCard label="Rech. este mes"   value={m?.rejectedThisMonth}      icon={XCircle}      tone="red"    loading={isLoading} />
      <KpiCard label="De vacaciones hoy" value={m?.approvedActiveToday}   icon={Sun}          tone="indigo" loading={isLoading} />
      <KpiCard
        label="Pendientes activas hoy"
        value={m?.pendingActiveToday}
        icon={AlertTriangle}
        tone="amber"
        loading={isLoading}
        hint="Solicitudes PENDING_* cuyo rango incluye hoy"
      />
    </div>
  );
}

type Tone = "yellow" | "blue" | "green" | "red" | "indigo" | "amber";

const TONE: Record<Tone, { ring: string; iconBg: string; iconText: string }> = {
  yellow: { ring: "ring-yellow-100", iconBg: "bg-yellow-50", iconText: "text-yellow-600" },
  blue:   { ring: "ring-blue-100",   iconBg: "bg-blue-50",   iconText: "text-blue-600" },
  green:  { ring: "ring-green-100",  iconBg: "bg-green-50",  iconText: "text-green-600" },
  red:    { ring: "ring-red-100",    iconBg: "bg-red-50",    iconText: "text-red-600" },
  indigo: { ring: "ring-indigo-100", iconBg: "bg-indigo-50", iconText: "text-indigo-600" },
  amber:  { ring: "ring-amber-100",  iconBg: "bg-amber-50",  iconText: "text-amber-600" },
};

function KpiCard({ label, value, icon: Icon, tone, loading, hint }: {
  label: string; value: number | undefined; icon: any; tone: Tone; loading: boolean; hint?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("card px-3 py-2.5 flex items-center gap-2.5", t.ring)} title={hint}>
      <div className={cn("rounded-md p-2 shrink-0", t.iconBg)}>
        <Icon className={cn("w-4 h-4", t.iconText)} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-medium tracking-wide text-gray-500 leading-tight">{label}</p>
        <p className="text-base font-semibold text-gray-900 leading-tight mt-0.5">
          {loading ? "—" : (value ?? 0)}
        </p>
      </div>
    </div>
  );
}
