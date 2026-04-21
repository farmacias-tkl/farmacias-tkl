"use client";
import {
  Briefcase, Building2, Calendar, CheckCircle2, XCircle,
  RotateCcw, AlertTriangle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActiveAbsence {
  id: string;
  absenceType: string;
  status: string;
  startDate: string;
  endDate: string;
  branchName: string;
}

export interface SerializedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  active: boolean;
  isRotating: boolean;
  hireDate: string | null;
  workScheduleNotes: string | null;
  notes: string | null;
  currentBranchId: string | null;
  currentBranch: { id: string; name: string } | null;
  position: { id: string; name: string; requiresCoverage: boolean } | null;
}

interface Props {
  employee:       SerializedEmployee;
  activeAbsences: ActiveAbsence[];
  overdueCount:   number;
}

function seniority(iso: string): string {
  const ms    = Date.now() - new Date(iso).getTime();
  const years = Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
  if (years === 0) {
    const months = Math.floor(ms / (30.44 * 24 * 60 * 60 * 1000));
    return months <= 1 ? "menos de 1 mes" : `${months} meses`;
  }
  return years === 1 ? "1 año" : `${years} años`;
}

export default function EmployeeHeader({ employee: e, activeAbsences, overdueCount }: Props) {
  const hasSuspension = activeAbsences.some(a => a.absenceType === "SUSPENSION");
  const hasLicense    = activeAbsences.some(a =>
    ["MEDICAL_LEAVE", "SPECIAL_LEAVE"].includes(a.absenceType)
  );
  const hasAbsence    = activeAbsences.some(a =>
    !["SUSPENSION", "MEDICAL_LEAVE", "SPECIAL_LEAVE"].includes(a.absenceType)
  );

  return (
    <div className="space-y-3">
      {/* Avatar + datos principales */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className={cn(
          "w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0",
          e.isRotating ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700",
          !e.active && "bg-gray-100 text-gray-400",
        )}>
          {e.isRotating
            ? <RotateCcw className="w-6 h-6" />
            : `${e.firstName[0]}${e.lastName[0]}`}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-gray-900">
              {e.firstName} {e.lastName}
            </h2>
            {e.active
              ? <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" />Activo
                </span>
              : <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  <XCircle className="w-3 h-3" />Inactivo
                </span>
            }
            {e.isRotating && (
              <span className="flex items-center gap-1 text-xs text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                <RotateCcw className="w-3 h-3" />Rotativo
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-1.5 flex-wrap text-xs text-gray-500">
            {e.position && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                {e.position.name}
                {e.position.requiresCoverage && (
                  <span className="ml-1 text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-medium">
                    req. cobertura
                  </span>
                )}
              </span>
            )}
            {e.currentBranch && (
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />{e.currentBranch.name}
              </span>
            )}
            {e.hireDate ? (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(e.hireDate).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
                <span className="text-gray-400">· {seniority(e.hireDate)} de antigüedad</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-400">
                <Calendar className="w-3 h-3" />Sin fecha de ingreso
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Banners de alerta */}
      {hasAbsence && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-800 font-medium">Ausencia activa hoy</p>
        </div>
      )}
      {hasSuspension && (
        <div className="flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
          <p className="text-sm text-orange-800 font-medium">Suspensión disciplinaria activa</p>
        </div>
      )}
      {hasLicense && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
          <Clock className="w-4 h-4 text-blue-500 shrink-0" />
          <p className="text-sm text-blue-800 font-medium">Licencia activa</p>
        </div>
      )}
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-800 font-medium">
            {overdueCount === 1
              ? "1 plan de acción vencido"
              : `${overdueCount} planes de acción vencidos`}
          </p>
        </div>
      )}
    </div>
  );
}
