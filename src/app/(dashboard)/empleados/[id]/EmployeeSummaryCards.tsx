"use client";
import { UserMinus, ClipboardList, AlertTriangle, Clock, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SummaryCounts {
  totalAbsences:    number;
  openPlansCount:   number;
  overdueCount:     number;
  totalOvertime:    number;
  totalAssignments: number;
}

export default function EmployeeSummaryCards({ counts: c }: { counts: SummaryCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <StatCard icon={UserMinus}     label="Ausencias"      value={c.totalAbsences}
        color={c.totalAbsences > 0 ? "text-red-500" : "text-gray-300"} />
      <StatCard icon={ClipboardList} label="Planes activos"  value={c.openPlansCount}
        color={c.openPlansCount > 0 ? "text-amber-500" : "text-gray-300"} />
      <StatCard icon={AlertTriangle} label="Planes vencidos" value={c.overdueCount}
        color={c.overdueCount > 0 ? "text-red-500" : "text-gray-300"} />
      <StatCard icon={Clock}         label="Horas extras"    value={c.totalOvertime}
        color={c.totalOvertime > 0 ? "text-blue-500" : "text-gray-300"} />
      <StatCard icon={Building2}     label="Asignaciones"    value={c.totalAssignments}
        color={c.totalAssignments > 0 ? "text-gray-500" : "text-gray-300"} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: any; label: string; value: number; color: string;
}) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <Icon className={cn("w-5 h-5 shrink-0", color)} />
      <div>
        <p className="text-xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  );
}
