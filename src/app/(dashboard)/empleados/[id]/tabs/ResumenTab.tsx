"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, UserMinus, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  SICKNESS: "Enfermedad", PERSONAL_REASON: "Razón personal",
  NO_SHOW: "No se presentó", LATE_NOTICE: "Aviso tarde",
  MEDICAL_LEAVE: "Licencia médica", SPECIAL_LEAVE: "Licencia especial",
  SUSPENSION: "Suspensión", OTHER: "Otro",
};

const PLAN_STATUS_META: Record<string, { label: string; color: string }> = {
  OPEN:        { label: "Abierto",    color: "bg-blue-50 text-blue-800" },
  IN_PROGRESS: { label: "En curso",   color: "bg-amber-50 text-amber-800" },
  COMPLETED:   { label: "Completado", color: "bg-green-50 text-green-800" },
  CLOSED:      { label: "Cerrado",    color: "bg-gray-50 text-gray-600" },
  CANCELLED:   { label: "Cancelado",  color: "bg-gray-50 text-gray-400" },
};

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

interface Props {
  employeeId: string;
  branchId:   string | null;
  onNavigate: (tab: string) => void;
}

export default function ResumenTab({ employeeId, onNavigate }: Props) {
  const { data: absData } = useQuery({
    queryKey: ["absences-resumen", employeeId],
    queryFn:  () => fetch(`/api/absences?employeeId=${employeeId}&limit=5`).then(r => r.json()),
  });
  const { data: plansData } = useQuery({
    queryKey: ["plans-resumen", employeeId],
    queryFn:  () => fetch(`/api/action-plans?employeeId=${employeeId}&limit=5`).then(r => r.json()),
  });
  const { data: otData } = useQuery({
    queryKey: ["overtime-resumen", employeeId],
    queryFn:  () => fetch(`/api/overtime?employeeId=${employeeId}&limit=5`).then(r => r.json()),
  });

  const absences = absData?.data    ?? [];
  const plans    = plansData?.data  ?? [];
  const overtime = otData?.data     ?? [];
  const abTotal  = absData?.meta?.total   ?? 0;
  const plTotal  = plansData?.meta?.total ?? 0;
  const otTotal  = otData?.meta?.total    ?? 0;

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

      {/* Ausencias */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <UserMinus className="w-4 h-4" />Ausencias ({abTotal})
          </h4>
          {abTotal > 0 && (
            <button onClick={() => onNavigate("ausencias")}
              className="text-xs text-blue-600 hover:underline">Ver todo →</button>
          )}
        </div>
        {absences.length === 0 ? (
          <div className="card p-4 text-center">
            <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Sin ausencias registradas</p>
          </div>
        ) : (
          <div className="space-y-2">
            {absences.map((a: any) => (
              <div key={a.id} className={cn("card p-3", a.isActiveToday && "border-red-200 bg-red-50/20")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-900 truncate">
                    {ABSENCE_TYPE_LABELS[a.absenceType] ?? a.absenceType}
                  </p>
                  {a.isActiveToday && (
                    <span className="text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded shrink-0">
                      Hoy
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{fmt(a.startDate)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Planes de acción */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />Planes ({plTotal})
          </h4>
          {plTotal > 0 && (
            <button onClick={() => onNavigate("planes")}
              className="text-xs text-blue-600 hover:underline">Ver todo →</button>
          )}
        </div>
        {plans.length === 0 ? (
          <div className="card p-4 text-center">
            <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Sin planes registrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((p: any) => {
              const sm = PLAN_STATUS_META[p.status] ?? PLAN_STATUS_META.OPEN;
              return (
                <div key={p.id} className={cn("card p-3", p.isOverdue && "border-red-200")}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", sm.color)}>
                      {sm.label}
                    </span>
                    {p.isOverdue && (
                      <span className="text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />Vencido
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-gray-900 mt-1 truncate">{p.reason}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Plazo: {fmt(p.deadline)}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Horas extras */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4" />Horas extras ({otTotal})
          </h4>
          {otTotal > 0 && (
            <button onClick={() => onNavigate("horas-extras")}
              className="text-xs text-blue-600 hover:underline">Ver todo →</button>
          )}
        </div>
        {overtime.length === 0 ? (
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-400">Sin horas extras</p>
          </div>
        ) : (
          <div className="space-y-2">
            {overtime.map((r: any) => (
              <div key={r.id} className="card p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{fmt(r.date)}</p>
                  <p className="text-sm font-bold text-gray-800">{r.hours}hs</p>
                </div>
                {r.branch?.name && <p className="text-xs text-gray-400 mt-0.5">{r.branch.name}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
