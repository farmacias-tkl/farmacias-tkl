"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, CalendarDays } from "lucide-react";
import { can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";
import VacationFormPanel from "./VacationFormPanel";
import VacationCard, { STATUS_META } from "./VacationCard";

const todayStr = new Date().toISOString().split("T")[0];

const currentMonth = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

export default function VacacionesPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  const userBranchId = session?.user?.branchId;

  const [showForm,    setShowForm]    = useState(false);
  const [branchFilter,setBranchFilter]= useState("");
  const [statusFilter,setStatusFilter]= useState("");
  const [empFilter,   setEmpFilter]   = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);

  const sessionReady    = status === "authenticated";
  const canCreate       = role ? can.createVacation(role) : false;
  const isBranchManager = role === "BRANCH_MANAGER";

  const { data: listRes, isLoading } = useQuery({
    queryKey: ["vacations", { branchFilter, statusFilter, empFilter, monthFilter, pendingOnly }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "100",
        ...(isBranchManager && userBranchId ? { branchId: userBranchId }
            : branchFilter ? { branchId: branchFilter } : {}),
        ...(statusFilter && { status: statusFilter }),
        ...(empFilter    && { employeeId: empFilter }),
        ...(monthFilter  && { month: monthFilter }),
        ...(pendingOnly  && { pendingOnly: "true" }),
      });
      const res = await fetch(`/api/vacations?${p}`);
      if (!res.ok) throw new Error("Error al cargar vacaciones");
      return res.json();
    },
    enabled: sessionReady,
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
    enabled:  sessionReady,
  });

  const branches  = branchRes?.data ?? [];
  const vacations = listRes?.data   ?? [];
  const total     = listRes?.meta?.total ?? 0;

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["vacations"] });
  };

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Vacaciones</h2>
          <p className="text-sm text-gray-500 mt-0.5">{total} solicitudes</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus className="w-4 h-4" />Solicitar vacaciones
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <VacationFormPanel
          branches={branches}
          isBranchManager={isBranchManager}
          userBranchId={userBranchId ?? null}
          onClose={() => setShowForm(false)}
          onCreated={() => { reload(); setShowForm(false); }}
        />
      )}

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
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input
          type="month"
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          className="input w-auto"
          placeholder="Mes" />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} className="rounded" />
          Solo pendientes
        </label>
        {monthFilter && (
          <button onClick={() => setMonthFilter("")} className="text-xs text-gray-400 hover:text-gray-600 underline">
            Limpiar mes
          </button>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
      ) : vacations.length === 0 ? (
        <div className="card p-10 text-center">
          <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No hay solicitudes con los filtros aplicados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vacations.map((v: any) => (
            <VacationCard key={v.id} vacation={v} role={role} userId={session?.user?.id} onChange={reload} />
          ))}
        </div>
      )}
    </div>
  );
}
