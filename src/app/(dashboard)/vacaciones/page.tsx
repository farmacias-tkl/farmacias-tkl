"use client";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, CalendarDays, List, LayoutGrid } from "lucide-react";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";
import {
  startOfMonth, endOfMonth, addDays, getMonthGrid, toLocalISODate,
} from "@/lib/dates/calendar";
import VacationFormPanel from "./VacationFormPanel";
import VacationCard, { STATUS_META } from "./VacationCard";
import VacationCalendar from "./VacationCalendar";
import VacationMetrics from "./VacationMetrics";
import VacationDetailModal from "./VacationDetailModal";
import EmployeeSearchInput from "./EmployeeSearchInput";

type ViewMode = "list" | "calendar";

export default function VacacionesPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  const userBranchId = session?.user?.branchId;

  const [showForm,    setShowForm]    = useState(false);
  const [viewMode,    setViewMode]    = useState<ViewMode>("list");
  const [branchFilter,setBranchFilter]= useState("");
  const [statusFilter,setStatusFilter]= useState("");
  const [empFilter,   setEmpFilter]   = useState<{ id: string; label: string } | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  // Mes visible del calendario; default hoy
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  // Modal de detalle
  const [detailId, setDetailId] = useState<string | null>(null);

  const sessionReady    = status === "authenticated";
  const canCreate       = role ? can.createVacation(role) : false;
  const isBranchManager = role === "BRANCH_MANAGER";

  // Sucursales
  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
    enabled:  sessionReady,
  });
  const branches = branchRes?.data ?? [];

  // Branch efectivo aplicado al filtro y a las queries
  const effectiveBranchId = isBranchManager ? (userBranchId ?? "") : branchFilter;

  // Rango del calendario: la grilla 7x6 cubre desde un día previo al mes
  // hasta varios después. Pedimos exactamente ese rango al backend.
  const calendarRange = useMemo(() => {
    const grid = getMonthGrid(calendarMonth.getFullYear(), calendarMonth.getMonth());
    const from = grid[0][0];
    const last = grid[grid.length - 1][6];
    return { from, to: last };
  }, [calendarMonth]);

  // Lista: filtros de la pestaña Lista
  const { data: listRes, isLoading: listLoading } = useQuery({
    queryKey: ["vacations-list", { branch: effectiveBranchId, statusFilter, emp: empFilter?.id, pendingOnly }],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "100" });
      if (effectiveBranchId) p.set("branchId", effectiveBranchId);
      if (statusFilter)      p.set("status", statusFilter);
      if (empFilter?.id)     p.set("employeeId", empFilter.id);
      if (pendingOnly)       p.set("pendingOnly", "true");
      const res = await fetch(`/api/vacations?${p}`);
      if (!res.ok) throw new Error("Error al cargar vacaciones");
      return res.json();
    },
    enabled: sessionReady && viewMode === "list",
  });

  // Calendario: trae todo el rango de la grilla visible
  const { data: calRes, isLoading: calLoading } = useQuery({
    queryKey: ["vacations-cal", { branch: effectiveBranchId, statusFilter, emp: empFilter?.id, from: toLocalISODate(calendarRange.from), to: toLocalISODate(calendarRange.to) }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "200",
        from: toLocalISODate(calendarRange.from),
        to:   toLocalISODate(calendarRange.to),
      });
      if (effectiveBranchId) p.set("branchId", effectiveBranchId);
      if (statusFilter)      p.set("status", statusFilter);
      if (empFilter?.id)     p.set("employeeId", empFilter.id);
      const res = await fetch(`/api/vacations?${p}`);
      if (!res.ok) throw new Error("Error al cargar vacaciones");
      return res.json();
    },
    enabled: sessionReady && viewMode === "calendar",
  });

  const listData = listRes?.data ?? [];
  const calData  = calRes?.data  ?? [];

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["vacations-list"] });
    qc.invalidateQueries({ queryKey: ["vacations-cal"] });
    qc.invalidateQueries({ queryKey: ["vacations-metrics"] });
    qc.invalidateQueries({ queryKey: ["vacation-detail"] });
  };

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900">Vacaciones</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus className="w-4 h-4" />Solicitar vacaciones
          </button>
        )}
      </div>

      {/* Métricas top */}
      <VacationMetrics branchId={effectiveBranchId || null} />

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

      {/* Toggle Lista / Calendario */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setViewMode("list")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            viewMode === "list" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700",
          )}
        >
          <List className="w-3.5 h-3.5" />Lista
        </button>
        <button
          onClick={() => setViewMode("calendar")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            viewMode === "calendar" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700",
          )}
        >
          <LayoutGrid className="w-3.5 h-3.5" />Calendario
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
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
        {viewMode === "list" && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} className="rounded" />
            Solo pendientes
          </label>
        )}
        <div className="ml-auto sm:ml-0 w-full sm:w-auto">
          <EmployeeSearchInput
            value={empFilter?.id ?? ""}
            valueLabel={empFilter?.label}
            onChange={(id, e) => setEmpFilter(id && e ? { id, label: `${e.firstName} ${e.lastName}` } : null)}
            branchId={effectiveBranchId || undefined}
          />
        </div>
      </div>

      {/* Vista */}
      {viewMode === "list" ? (
        listLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
        ) : listData.length === 0 ? (
          <div className="card p-10 text-center">
            <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No hay solicitudes con los filtros aplicados.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {listData.map((v: any) => (
              <VacationCard key={v.id} vacation={v} onClick={() => setDetailId(v.id)} />
            ))}
          </div>
        )
      ) : (
        <div className="relative">
          {calLoading && (
            <div className="absolute inset-0 z-20 bg-white/50 flex items-center justify-center pointer-events-none">
              <span className="text-xs text-gray-400">Cargando...</span>
            </div>
          )}
          <VacationCalendar
            events={calData}
            initialDate={calendarMonth}
            onMonthChange={setCalendarMonth}
            onEventClick={(id) => setDetailId(id)}
          />
        </div>
      )}

      {/* Modal de detalle */}
      <VacationDetailModal
        open={!!detailId}
        vacationId={detailId}
        role={role}
        userId={session?.user?.id}
        onClose={() => setDetailId(null)}
        onChanged={reload}
      />
    </div>
  );
}
