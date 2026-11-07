"use client";
import { UserMinus, ClipboardList, AlertTriangle, Clock, Building2 } from "lucide-react";
import { KpiCard, KpiGrid } from "@/components/ui/Kpi";

export interface SummaryCounts {
  totalAbsences:    number;
  openPlansCount:   number;
  overdueCount:     number;
  totalOvertime:    number;
  totalAssignments: number;
}

export default function EmployeeSummaryCards({ counts: c }: { counts: SummaryCounts }) {
  return (
    <KpiGrid cols={5}>
      <KpiCard icon={UserMinus}     label="Ausencias"       value={c.totalAbsences}    tone={c.totalAbsences > 0 ? "red" : "gray"} />
      <KpiCard icon={ClipboardList} label="Planes activos"  value={c.openPlansCount}   tone={c.openPlansCount > 0 ? "amber" : "gray"} />
      <KpiCard icon={AlertTriangle} label="Planes vencidos" value={c.overdueCount}     tone={c.overdueCount > 0 ? "red" : "gray"} />
      <KpiCard icon={Clock}         label="Horas extras"    value={c.totalOvertime}    tone={c.totalOvertime > 0 ? "blue" : "gray"} />
      <KpiCard icon={Building2}     label="Asignaciones"    value={c.totalAssignments} tone="gray" />
    </KpiGrid>
  );
}
