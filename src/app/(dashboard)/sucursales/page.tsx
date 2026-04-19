import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { MapPin, Phone, CheckCircle2, XCircle, ChevronRight, UserMinus, Users, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

function getDotacion(total: number, absent: number) {
  if (total === 0) return { label: "Sin personal", color: "text-gray-500", bg: "bg-gray-100" };
  const ratio = absent / total;
  if (ratio >= 0.2 || (absent > 0 && total <= 3)) {
    return { label: "Crítica", color: "text-red-700", bg: "bg-red-50" };
  }
  if (ratio > 0) return { label: "Justa", color: "text-amber-700", bg: "bg-amber-50" };
  return { label: "OK", color: "text-green-700", bg: "bg-green-50" };
}

export default async function SucursalesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { employees: { where: { active: true } } } },
      absenceRecords: {
        where: { startDate: { lte: todayEnd }, endDate: { gte: today } },
        include: { employee: { select: { position: { select: { requiresCoverage: true } } } } },
      },
    },
  });

  const activas   = branches.filter(b => b.active);
  const inactivas = branches.filter(b => !b.active);
  const totalAbsentHoy = activas.reduce((s, b) => s + b.absenceRecords.length, 0);
  const totalCriticos  = activas.reduce((s, b) => s + b.absenceRecords.filter(a => a.employee.position.requiresCoverage).length, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Sucursales</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {activas.length} activas
            {totalAbsentHoy > 0 && <span className="ml-2 text-red-500 font-medium">· {totalAbsentHoy} ausente{totalAbsentHoy > 1 ? "s" : ""} hoy</span>}
            {totalCriticos > 0 && <span className="ml-1 text-red-600 font-semibold">({totalCriticos} crítico{totalCriticos > 1 ? "s" : ""})</span>}
          </p>
        </div>
      </div>

      {totalCriticos > 0 && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">
            <strong>{totalCriticos} puesto{totalCriticos > 1 ? "s" : ""} crítico{totalCriticos > 1 ? "s" : ""}</strong> sin cobertura hoy. Revisá el detalle de cada sucursal.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activas.map(b => {
          const absent   = b.absenceRecords.length;
          const critical = b.absenceRecords.filter(a => a.employee.position.requiresCoverage).length;
          const dot      = getDotacion(b._count.employees, absent);
          return (
            <Link key={b.id} href={`/sucursales/${b.id}`}
              className="card p-4 hover:shadow-md transition-all hover:border-blue-200 group block">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900 text-sm group-hover:text-blue-700 transition-colors">{b.name}</h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", dot.bg, dot.color)}>{dot.label}</span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
                </div>
              </div>
              {b.address && (
                <div className="flex items-start gap-1.5 text-xs text-gray-500 mt-1">
                  <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{b.address}</span>
                </div>
              )}
              <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Users className="w-3.5 h-3.5" />{b._count.employees} empleados
                </span>
                <div className="flex items-center gap-2">
                  {critical > 0 && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
                      <AlertTriangle className="w-3 h-3" />{critical} crítico{critical > 1 ? "s" : ""}
                    </span>
                  )}
                  {absent > 0 && (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      <UserMinus className="w-3 h-3" />{absent} ausente{absent > 1 ? "s" : ""}
                    </span>
                  )}
                  {absent === 0 && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 className="w-3 h-3" />Sin ausencias
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {inactivas.length > 0 && (
        <div className="opacity-50">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Inactivas</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inactivas.map(b => (
              <div key={b.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-700 text-sm">{b.name}</h3>
                  <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    <XCircle className="w-3 h-3" />Inactiva
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
