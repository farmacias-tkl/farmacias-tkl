import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Phone, Users, UserMinus,
  CheckCircle2, XCircle, AlertTriangle, Phone as PhoneIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Badge de tipo de ausencia
const ABSENCE_TYPE_META: Record<string, { label: string; color: string }> = {
  SICKNESS:        { label: "Enfermedad",    color: "bg-red-50 text-red-700" },
  PERSONAL_REASON: { label: "Personal",      color: "bg-amber-50 text-amber-700" },
  NO_SHOW:         { label: "Sin aviso",     color: "bg-gray-100 text-gray-700" },
  LATE_NOTICE:     { label: "Aviso tarde",   color: "bg-orange-50 text-orange-700" },
  MEDICAL_LEAVE:   { label: "Lic. médica",   color: "bg-blue-50 text-blue-700" },
  SPECIAL_LEAVE:   { label: "Lic. especial", color: "bg-violet-50 text-violet-700" },
  OTHER:           { label: "Otro",          color: "bg-gray-100 text-gray-600" },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  REPORTED:     { label: "Reportada",     color: "bg-yellow-50 text-yellow-700" },
  JUSTIFIED:    { label: "Justificada",   color: "bg-green-50 text-green-700" },
  UNJUSTIFIED:  { label: "Injustificada", color: "bg-red-50 text-red-700" },
  UNDER_REVIEW: { label: "En revisión",   color: "bg-blue-50 text-blue-700" },
  CLOSED:       { label: "Cerrada",       color: "bg-gray-100 text-gray-600" },
};

export default async function SucursalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);

  const branch = await prisma.branch.findUnique({
    where: { id: params.id },
    include: {
      employees: {
        where: { active: true },
        include: {
          position: { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
        },
        orderBy: [{ position: { name: "asc" } }, { lastName: "asc" }],
      },
      absenceRecords: {
        where: {
          startDate: { lte: todayEnd },
          endDate:   { gte: today },
        },
        include: {
          employee: {
            select: {
              id: true, firstName: true, lastName: true,
              position: { select: { name: true, requiresCoverage: true } },
            },
          },
        },
        orderBy: { startDate: "desc" },
      },
    },
  });

  if (!branch) notFound();

  // Encargados solo ven su sucursal
  if (
    session.user.role === "BRANCH_MANAGER" &&
    session.user.branchId !== branch.id
  ) {
    redirect("/sucursales");
  }

  const absentIds     = new Set(branch.absenceRecords.map(a => a.employeeId));
  const criticalToday = branch.absenceRecords.filter(
    a => a.employee.position.requiresCoverage
  );

  // Agrupar empleados por puesto
  const byPosition = branch.employees.reduce<Record<string, typeof branch.employees>>((acc, emp) => {
    const key = emp.position.name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(emp);
    return acc;
  }, {});

  const dotacion     = branch.employees.length;
  const ausentes     = branch.absenceRecords.length;
  const disponibles  = dotacion - ausentes;
  const dotPct       = dotacion > 0 ? Math.round((disponibles / dotacion) * 100) : 100;
  const dotEstado    = dotPct >= 80 ? "OK" : dotPct >= 60 ? "Justa" : "Crítica";
  const dotColor     = dotPct >= 80
    ? "text-green-700 bg-green-50"
    : dotPct >= 60
    ? "text-amber-700 bg-amber-50"
    : "text-red-700 bg-red-50";

  return (
    <div className="space-y-5">

      {/* Back + Header */}
      <div>
        <Link href="/sucursales"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Sucursales
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">{branch.name}</h2>
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", dotColor)}>
                Dotación {dotEstado}
              </span>
              {branch.active
                ? <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />Activa
                  </span>
                : <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    <XCircle className="w-3 h-3" />Inactiva
                  </span>
              }
            </div>
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              {branch.address && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3" />{branch.address}
                </span>
              )}
              {branch.phone && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <PhoneIcon className="w-3 h-3" />{branch.phone}
                </span>
              )}
            </div>
          </div>

          {/* Métricas rápidas */}
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900">{dotacion}</p>
              <p className="text-xs text-gray-400">Activos</p>
            </div>
            <div className="text-center">
              <p className={cn("text-xl font-bold", ausentes > 0 ? "text-red-600" : "text-green-600")}>
                {ausentes}
              </p>
              <p className="text-xs text-gray-400">Ausentes</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-700">{disponibles}</p>
              <p className="text-xs text-gray-400">Disponibles</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alerta crítica */}
      {criticalToday.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800 mb-1">
              {criticalToday.length === 1
                ? "Puesto crítico descubierto hoy"
                : `${criticalToday.length} puestos críticos descubiertos hoy`}
            </p>
            <ul className="space-y-0.5">
              {criticalToday.map(a => (
                <li key={a.id} className="text-sm text-red-700">
                  <strong>{a.employee.position.name}</strong> — {a.employee.firstName} {a.employee.lastName}
                  <span className="ml-2 text-xs">
                    ({ABSENCE_TYPE_META[(a as any).absenceType]?.label ?? "Ausente"})
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-red-600 mt-1.5">
              Requiere asignación de rotativa para cobertura.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">

        {/* Ausentes hoy */}
        <div className="lg:col-span-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <UserMinus className="w-4 h-4" />
            Ausentes hoy ({ausentes})
          </h3>

          {ausentes === 0 ? (
            <div className="card p-4 text-center">
              <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto mb-1.5" />
              <p className="text-xs text-gray-500 font-medium">Sin ausencias hoy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {branch.absenceRecords.map(a => {
                const typeMeta   = ABSENCE_TYPE_META[(a as any).absenceType] ?? { label: "Otro", color: "bg-gray-100 text-gray-600" };
                const statusMeta = STATUS_META[(a as any).status] ?? { label: "Reportada", color: "bg-yellow-50 text-yellow-700" };

                const start = new Date(a.startDate);
                const end   = new Date(a.endDate);
                const isSameDay = start.toDateString() === end.toDateString();
                const fmt = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
                const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

                return (
                  <div key={a.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {a.employee.firstName} {a.employee.lastName}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {a.employee.position.name}
                          {a.employee.position.requiresCoverage && (
                            <span className="ml-1.5 text-[10px] bg-orange-50 text-orange-700 px-1 py-0.5 rounded font-medium">
                              crítico
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {isSameDay ? fmt(start) : `${fmt(start)} → ${fmt(end)} (${totalDays}d)`}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", typeMeta.color)}>
                          {typeMeta.label}
                        </span>
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", statusMeta.color)}>
                          {statusMeta.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Empleados activos por puesto */}
        <div className="lg:col-span-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Personal activo ({dotacion})
          </h3>

          {dotacion === 0 ? (
            <div className="card p-4 text-center text-xs text-gray-400">
              No hay empleados activos en esta sucursal.
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Nombre
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Puesto
                    </th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Hoy
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {branch.employees.map(emp => {
                    const absent = absentIds.has(emp.id);
                    return (
                      <tr key={emp.id}
                        className={cn("transition-colors", absent ? "bg-red-50/30" : "hover:bg-gray-50")}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-900 text-sm">
                            {emp.firstName} {emp.lastName}
                          </p>
                          {emp.hireDate && (
                            <p className="text-xs text-gray-400">
                              Desde {new Date(emp.hireDate).getFullYear()}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-sm text-gray-600">{emp.position.name}</span>
                          {emp.position.requiresCoverage && (
                            <span className="ml-1.5 text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
                              cob
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {absent ? (
                            <span className="text-xs text-red-600 font-medium">Ausente</span>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">Presente</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Notas de sucursal */}
      {branch.notes && (
        <div className="card p-4 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Notas
          </p>
          <p className="text-sm text-gray-600">{branch.notes}</p>
        </div>
      )}
    </div>
  );
}
