import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  ArrowLeft, Briefcase, Building2, Calendar,
  CheckCircle2, XCircle, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import ActionPlansSection from "./ActionPlansSection";

export default async function EmpleadoDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: {
      position:      { select: { id: true, name: true, requiresCoverage: true } },
      currentBranch: { select: { id: true, name: true } },
    },
  });

  if (!employee) notFound();

  if (
    session.user.role === "BRANCH_MANAGER" &&
    employee.currentBranchId !== session.user.branchId
  ) {
    redirect("/empleados");
  }

  const canCreate = can.createActionPlan(session.user.role);

  return (
    <div className="space-y-5">

      {/* Back + Header */}
      <div>
        <Link
          href="/empleados"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Empleados
        </Link>

        <div className="flex items-start gap-4 flex-wrap">
          {/* Avatar */}
          <div className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold shrink-0",
            employee.isRotating
              ? "bg-violet-100 text-violet-700"
              : "bg-blue-100 text-blue-700",
            !employee.active && "bg-gray-100 text-gray-400",
          )}>
            {employee.isRotating
              ? <RotateCcw className="w-5 h-5" />
              : `${employee.firstName[0]}${employee.lastName[0]}`}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">
                {employee.firstName} {employee.lastName}
              </h2>
              {employee.active
                ? <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />Activo
                  </span>
                : <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    <XCircle className="w-3 h-3" />Inactivo
                  </span>
              }
              {employee.isRotating && (
                <span className="text-xs text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                  Rotativo
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 mt-1 flex-wrap text-xs text-gray-500">
              {employee.position && (
                <span className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3" />
                  {employee.position.name}
                  {employee.position.requiresCoverage && (
                    <span className="ml-1 text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-medium">
                      req. cobertura
                    </span>
                  )}
                </span>
              )}
              {employee.currentBranch && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {employee.currentBranch.name}
                </span>
              )}
              {employee.hireDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Desde {new Date(employee.hireDate).toLocaleDateString("es-AR", {
                    month: "long", year: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notas y horario */}
      {(employee.notes || employee.workScheduleNotes) && (
        <div className="card p-4 bg-gray-50 space-y-1">
          {employee.workScheduleNotes && (
            <p className="text-xs text-gray-500">
              <span className="font-medium">Horario:</span> {employee.workScheduleNotes}
            </p>
          )}
          {employee.notes && (
            <p className="text-xs text-gray-500 italic">{employee.notes}</p>
          )}
        </div>
      )}

      {/* Planes de acción */}
      <ActionPlansSection
        employeeId={employee.id}
        employeeName={`${employee.firstName} ${employee.lastName}`}
        branchId={employee.currentBranchId ?? null}
        branchName={employee.currentBranch?.name ?? null}
        canCreate={canCreate}
      />
    </div>
  );
}
