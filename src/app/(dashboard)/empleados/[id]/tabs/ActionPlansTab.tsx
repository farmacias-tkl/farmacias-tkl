"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, AlertTriangle,
  CheckCircle2, ChevronRight, Clock, XCircle, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ActionPlanDetailModal from "@/components/action-plans/ActionPlanDetailModal";

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  OPEN:        { label: "Abierto",    color: "bg-blue-50 text-blue-800 border-blue-200",    icon: Clock },
  IN_PROGRESS: { label: "En curso",   color: "bg-amber-50 text-amber-800 border-amber-200", icon: Clock },
  COMPLETED:   { label: "Completado", color: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2 },
  CLOSED:      { label: "Cerrado",    color: "bg-gray-50 text-gray-600 border-gray-200",    icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelado",  color: "bg-gray-50 text-gray-400 border-gray-200",    icon: XCircle },
};

interface Props {
  employeeId: string;
  canCreate:  boolean;
}

export default function ActionPlansTab({
  employeeId, canCreate,
}: Props) {
  const qc = useQueryClient();
  const [detailPlan, setDetailPlan] = useState<any>(null);

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["action-plans-tab", employeeId],
    queryFn:  () => fetch(`/api/action-plans?employeeId=${employeeId}&limit=50`).then(r => r.json()),
  });

  const plans        = plansData?.data       ?? [];
  const total        = plansData?.meta?.total ?? 0;
  const overdueCount = plans.filter((p: any) => p.isOverdue).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            Planes de acción
            {total > 0 && <span className="ml-1.5 font-normal text-gray-400">({total})</span>}
          </h3>
          {overdueCount > 0 && (
            <p className="text-xs text-red-500 mt-0.5">
              {overdueCount} vencido{overdueCount > 1 ? "s" : ""}
            </p>
          )}
        </div>
        {canCreate && (
          <Link
            href={`/empleados/${employeeId}/planes/nuevo`}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4" />Plan digital
          </Link>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i =>
          <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />
        )}</div>
      ) : plans.length === 0 ? (
        <div className="card p-10 text-center">
          <ClipboardList className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Sin planes de acción registrados.</p>
          {canCreate && (
            <p className="text-xs text-gray-400 mt-1">Hacé clic en "Nuevo plan" para crear uno.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((p: any) => (
            <PlanCard key={p.id} plan={p} onOpen={setDetailPlan} />
          ))}
        </div>
      )}

      <ActionPlanDetailModal
        open={!!detailPlan}
        plan={detailPlan}
        canManage={canCreate}
        onClose={() => setDetailPlan(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["action-plans-tab", employeeId] })}
      />
    </div>
  );
}

function PlanCard({ plan: p, onOpen }: {
  plan: any;
  onOpen: (plan: any) => void;
}) {
  const meta = STATUS_META[p.status] ?? STATUS_META.OPEN;
  const SI   = meta.icon;
  const fmt  = (d: string) =>
    new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div
      className={cn("card overflow-hidden cursor-pointer hover:border-gray-300 transition-colors", p.isOverdue && "border-red-200")}
      onClick={() => onOpen(p)}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
              <SI className="w-3 h-3" />{meta.label}
            </span>
            {p.isOverdue && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" />Vencido
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900 mt-1 truncate">{p.reason}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
            <span>Fecha: {fmt(p.date)}</span>
            <span>·</span>
            <span>Plazo: {fmt(p.deadline)}</span>
            {p.branch?.name && <><span>·</span><span>{p.branch.name}</span></>}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
      </div>
    </div>
  );
}
