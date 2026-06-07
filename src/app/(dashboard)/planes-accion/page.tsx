"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Clock, XCircle,
} from "lucide-react";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  OPEN:        { label: "Abierto",       color: "bg-blue-50 text-blue-800 border-blue-200",     icon: Clock },
  IN_PROGRESS: { label: "En curso",      color: "bg-amber-50 text-amber-800 border-amber-200",  icon: Clock },
  COMPLETED:   { label: "Completado",    color: "bg-green-50 text-green-800 border-green-200",  icon: CheckCircle2 },
  CLOSED:      { label: "Cerrado",       color: "bg-gray-50 text-gray-600 border-gray-200",     icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelado",     color: "bg-gray-50 text-gray-400 border-gray-200",     icon: XCircle },
};

export default function PlanesAccionPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  const userBranchId = session?.user?.branchId;

  const [branchFilter,setBranchFilter]= useState("");
  const [statusFilter,setStatusFilter]= useState("");

  const sessionReady    = status === "authenticated";
  const isBranchManager = role === "BRANCH_MANAGER";
  const canCreate       = role ? can.createActionPlan(role) : false;

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["action-plans", { branchFilter, statusFilter }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "50",
        ...(isBranchManager && userBranchId ? { branchId: userBranchId }
          : branchFilter ? { branchId: branchFilter } : {}),
        ...(statusFilter && { status: statusFilter }),
      });
      const res = await fetch(`/api/action-plans?${p}`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: sessionReady,
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn: () => fetch("/api/branches").then(r => r.json()),
    enabled: sessionReady,
  });

  const branches  = branchRes?.data  ?? [];
  const plans     = plansData?.data  ?? [];
  const total     = plansData?.meta?.total ?? 0;

  const updateStatus = async (id: string, newStatus: string) => {
    await fetch(`/api/action-plans/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    qc.invalidateQueries({ queryKey: ["action-plans"] });
  };

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  const overdueCount = plans.filter((p: any) => p.isOverdue).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Planes de accion</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} registros
            {overdueCount > 0 && (
              <span className="ml-2 text-red-500 font-medium">
                · {overdueCount} vencido{overdueCount > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {!isBranchManager && (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto">
            <option value="">Todas las sucursales</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
      ) : plans.length === 0 ? (
        <div className="card p-10 text-center">
          <ClipboardList className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No hay planes de accion registrados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((p: any) => (
            <PlanCard key={p.id} plan={p} canManage={canCreate} onUpdateStatus={updateStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan: p, canManage, onUpdateStatus }: {
  plan: any; canManage: boolean;
  onUpdateStatus: (id: string, status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[p.status] ?? STATUS_META.OPEN;
  const SI   = meta.icon;
  const deadline = new Date(p.deadline);

  return (
    <div className={cn("card overflow-hidden", p.isOverdue && "border-red-200")}>
      <div className="px-4 py-3 cursor-pointer flex items-start gap-3" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {p.employee.firstName} {p.employee.lastName}
            </p>
            <span className="text-xs text-gray-500">{p.employee.position?.name}</span>
            {p.isOverdue && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                Vencido
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 mt-0.5 truncate">{p.reason}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
            <span>{p.branch?.name}</span>
            <span>·</span>
            <span>Plazo: {deadline.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
            <SI className="w-3 h-3" />{meta.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 bg-gray-50/50 space-y-2">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Acciones requeridas</p>
            <p className="text-sm text-gray-700">{p.requiredActions}</p>
          </div>
          {p.notes && (
            <p className="text-xs text-gray-500 italic">{p.notes}</p>
          )}
          {canManage && !["COMPLETED","CLOSED","CANCELLED"].includes(p.status) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {p.status === "OPEN" && (
                <button onClick={() => onUpdateStatus(p.id, "IN_PROGRESS")}
                  className="btn-secondary text-xs py-1.5 px-3 text-amber-700 border-amber-300 hover:bg-amber-50">
                  Marcar en curso
                </button>
              )}
              {p.status === "IN_PROGRESS" && (
                <button onClick={() => onUpdateStatus(p.id, "COMPLETED")}
                  className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                  Completado
                </button>
              )}
              <button onClick={() => onUpdateStatus(p.id, "CANCELLED")}
                className="btn-secondary text-xs py-1.5 px-3 text-gray-500">
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
