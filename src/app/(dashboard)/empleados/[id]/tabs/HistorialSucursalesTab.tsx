"use client";
import { useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  PERMANENT:          "Fijo",
  TEMPORARY_COVERAGE: "Cobertura temporal",
  ROTATION:           "Rotación",
};

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  ACTIVE:    { label: "Activa",     color: "bg-green-50 text-green-700 border-green-200", icon: CheckCircle2 },
  COMPLETED: { label: "Completada", color: "bg-gray-50 text-gray-600 border-gray-200",   icon: CheckCircle2 },
  CANCELLED: { label: "Cancelada",  color: "bg-red-50 text-red-700 border-red-200",      icon: XCircle },
};

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

export default function HistorialSucursalesTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["employee-assignments", employeeId],
    queryFn:  () => fetch(`/api/employees/${employeeId}`).then(r => r.json()),
  });

  const assignments: any[] = data?.data?.branchAssignments ?? [];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-gray-400" />
        Historial de sucursales
        {assignments.length > 0 && (
          <span className="font-normal text-gray-400">({assignments.length})</span>
        )}
      </h3>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i =>
          <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />
        )}</div>
      ) : assignments.length === 0 ? (
        <div className="card p-10 text-center">
          <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Sin asignaciones registradas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((a: any) => {
            const sm = STATUS_META[a.status] ?? STATUS_META.ACTIVE;
            const SI = sm.icon;
            return (
              <div key={a.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{a.branch?.name}</span>
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {TYPE_LABELS[a.type] ?? a.type}
                      </span>
                      {a.position?.name && (
                        <span className="text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                          {a.position.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Desde {fmt(a.startDate)}
                      {a.endDate
                        ? ` hasta ${fmt(a.endDate)}`
                        : " · Sin fecha de fin"}
                    </p>
                    {a.reason && (
                      <p className="text-xs text-gray-400 mt-0.5 italic">{a.reason}</p>
                    )}
                  </div>
                  <span className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border shrink-0",
                    sm.color,
                  )}>
                    <SI className="w-3 h-3" />{sm.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
