"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  UserMinus, ExternalLink, AlertTriangle,
  CheckCircle2, XCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";

function ClockIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

const ABSENCE_TYPES: Record<string, string> = {
  SICKNESS: "Enfermedad", PERSONAL_REASON: "Razón personal",
  NO_SHOW: "No se presentó", LATE_NOTICE: "Aviso tarde",
  MEDICAL_LEAVE: "Licencia médica", SPECIAL_LEAVE: "Licencia especial",
  SUSPENSION: "Suspensión", OTHER: "Otro",
};

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  REPORTED:     { label: "Reportada",     color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: ClockIcon },
  JUSTIFIED:    { label: "Justificada",   color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  UNJUSTIFIED:  { label: "Injustificada", color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  UNDER_REVIEW: { label: "En revisión",   color: "bg-blue-50 text-blue-800 border-blue-200",      icon: ClockIcon },
  CLOSED:       { label: "Cerrada",       color: "bg-gray-50 text-gray-600 border-gray-200",      icon: CheckCircle2 },
};

export default function AusenciasTab({ employeeId }: { employeeId: string }) {
  const { data: session } = useSession();
  const qc         = useQueryClient();
  const canJustify = session?.user?.role ? can.justifyAbsence(session.user.role as UserRole) : false;

  const { data, isLoading, error } = useQuery({
    queryKey: ["absences-tab", employeeId],
    queryFn:  () => fetch(`/api/absences?employeeId=${employeeId}&limit=50`).then(r => r.json()),
  });

  const absences = data?.data       ?? [];
  const total    = data?.meta?.total ?? 0;

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/absences/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    qc.invalidateQueries({ queryKey: ["absences-tab", employeeId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Ausencias y licencias
          {total > 0 && <span className="ml-1.5 font-normal text-gray-400">({total})</span>}
        </h3>
        <Link href="/ausencias" className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
          <ExternalLink className="w-3.5 h-3.5" />Registrar ausencia
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">Error al cargar ausencias</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i =>
          <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />
        )}</div>
      ) : absences.length === 0 ? (
        <div className="card p-10 text-center">
          <UserMinus className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Sin ausencias registradas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {absences.map((a: any) => (
            <AbsenceCard key={a.id} absence={a} canJustify={canJustify} onUpdate={updateStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function AbsenceCard({ absence: a, canJustify, onUpdate }: {
  absence: any;
  canJustify: boolean;
  onUpdate: (id: string, status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[a.status] ?? STATUS_META.REPORTED;
  const SI   = meta.icon;

  const start = new Date(a.startDate);
  const end   = new Date(a.endDate);
  const same  = start.toDateString() === end.toDateString();
  const fmt   = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className={cn("card overflow-hidden",
      a.isActiveToday && "border-red-200",
      a.absenceType === "SUSPENSION" && "border-orange-200",
    )}>
      <div className="px-4 py-3 cursor-pointer flex items-start gap-3" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">
              {ABSENCE_TYPES[a.absenceType] ?? a.absenceType}
            </span>
            {a.isActiveToday && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Hoy</span>
            )}
            {a.absenceType === "SUSPENSION" && (
              <span className="text-xs font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                Suspensión
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {same ? fmt(start) : `${fmt(start)} → ${fmt(end)} (${a.totalDays}d)`}
            {a.branch?.name ? ` · ${a.branch.name}` : ""}
          </p>
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
          {a.reasonDetail && <p className="text-xs text-gray-600">Motivo: {a.reasonDetail}</p>}
          {a.notes && <p className="text-xs text-gray-600 italic">{a.notes}</p>}
          {a.hasCertificate && <p className="text-xs text-blue-600 font-medium">Con certificado</p>}
          {canJustify && a.status !== "CLOSED" && (
            <div className="flex flex-wrap gap-2 pt-1">
              {a.status !== "JUSTIFIED" && (
                <button onClick={() => onUpdate(a.id, "JUSTIFIED")}
                  className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                  Justificar
                </button>
              )}
              {a.status !== "UNJUSTIFIED" && (
                <button onClick={() => onUpdate(a.id, "UNJUSTIFIED")}
                  className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                  Injustificada
                </button>
              )}
              {a.status !== "UNDER_REVIEW" && (
                <button onClick={() => onUpdate(a.id, "UNDER_REVIEW")}
                  className="btn-secondary text-xs py-1.5 px-3">En revisión</button>
              )}
              <button onClick={() => onUpdate(a.id, "CLOSED")}
                className="btn-secondary text-xs py-1.5 px-3">Cerrar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
