import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS, can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";
import {
  Users, MapPin, Wrench, ClipboardList, AlertTriangle,
  Eye, CalendarDays, UserMinus, CheckCircle2, BellDot,
  ChevronRight, RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

function ClockIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, branchId, name } = session.user;
  const firstName       = name.split(" ")[0];
  const isBranchManager = role === "BRANCH_MANAGER" && !!branchId;

  const today    = new Date(); today.setHours(0,0,0,0);
  const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);

  // Filtros según rol
  const absWhere: any = { startDate: { lte: todayEnd }, endDate: { gte: today } };
  const empWhere: any = { active: true };
  if (isBranchManager) {
    absWhere.branchId      = branchId;
    empWhere.currentBranchId = branchId;
  }

  // Ausencias activas hoy con detalle
  const absencesHoy = await prisma.absenceRecord.findMany({
    where: absWhere,
    include: {
      employee: {
        select: {
          firstName: true, lastName: true,
          position: { select: { name: true, requiresCoverage: true } },
        },
      },
      branch: { select: { name: true } },
    },
    take: 10,
    orderBy: { startDate: "desc" },
  });

  // Desglose: ausencias puntuales vs licencias
  const ausenciasPuntuales = absencesHoy.filter(
    a => !["MEDICAL_LEAVE","SPECIAL_LEAVE"].includes((a as any).absenceType)
  );
  const licencias = absencesHoy.filter(
    a => ["MEDICAL_LEAVE","SPECIAL_LEAVE"].includes((a as any).absenceType)
  );
  // Vacaciones — cuando exista VacationRequest se agrega aquí
  const vacaciones: any[] = [];

  const totalFuera      = absencesHoy.length; // + vacaciones.length cuando exista
  const criticalUncov   = absencesHoy.filter(a => a.employee.position.requiresCoverage);
  const sinRevisar      = await prisma.absenceRecord.count({ where: { ...absWhere, status: "REPORTED" } });

  const [totalEmployees, totalBranches] = await Promise.all([
    prisma.employee.count({ where: empWhere }),
    prisma.branch.count({ where: { active: true, showInOperative: true } }),
  ]);

  const todayFormatted = today.toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });

  const hasAlerts = totalFuera > 0 || criticalUncov.length > 0 || sinRevisar > 0;

  return (
    <div className="space-y-6">

      {/* Saludo */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Buen dia, {firstName}</h2>
          <p className="text-sm text-gray-500 capitalize mt-0.5">{todayFormatted}</p>
        </div>
        <span className="text-xs text-gray-400 hidden sm:block">
          {ROLE_LABELS[role as UserRole]}
          {isBranchManager && branchId && (
            <span className="ml-1 text-amber-600">· solo tu sucursal</span>
          )}
        </span>
      </div>

      {/* OWNER aviso */}
      {role === "OWNER" && (
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <Eye className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-sm text-slate-600">
            Acceso operativo ampliado. Podes ver todo, crear ausencias y reportar tickets.
          </p>
        </div>
      )}

      {/* BRANCH_MANAGER aviso */}
      {isBranchManager && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            Ves solo la informacion de tu sucursal.
          </p>
        </div>
      )}

      {/* Alertas del dia */}
      {hasAlerts && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BellDot className="w-4 h-4 text-red-500" />Alertas del dia
          </h3>
          <div className="space-y-2">
            {criticalUncov.map(a => (
              <AlertBanner key={a.id} level="critical">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>{a.employee.position.name}</strong> descubierto en{" "}
                  <strong>{a.branch.name}</strong> —{" "}
                  {a.employee.firstName} {a.employee.lastName} ausente hoy.
                </span>
                <Link href="/ausencias" className="ml-auto text-xs underline shrink-0">Ver</Link>
              </AlertBanner>
            ))}
            {sinRevisar > 0 && (
              <AlertBanner level="warning">
                <ClockIcon className="w-4 h-4 shrink-0" />
                <span>{sinRevisar} ausencia{sinRevisar > 1 ? "s" : ""} sin revisar.</span>
                <Link href="/ausencias?status=REPORTED" className="ml-auto text-xs underline shrink-0">Revisar</Link>
              </AlertBanner>
            )}
            {totalFuera > 0 && criticalUncov.length === 0 && (
              <AlertBanner level="info">
                <UserMinus className="w-4 h-4 shrink-0" />
                <span>{totalFuera} empleado{totalFuera > 1 ? "s" : ""} fuera hoy.</span>
                <Link href="/ausencias?activeOnly=true" className="ml-auto text-xs underline shrink-0">Ver detalle</Link>
              </AlertBanner>
            )}
          </div>
        </section>
      )}

      {!hasAlerts && (
        <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <p className="text-sm text-green-800 font-medium">Sin alertas operativas hoy.</p>
        </div>
      )}

      {/* Stats */}
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Resumen operativo
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {role !== "MAINTENANCE" && (
            <StatCard label="Empleados activos" value={totalEmployees}
              sub={isBranchManager ? "En tu sucursal" : "En toda la cadena"}
              icon={Users} color="blue" href="/empleados" />
          )}
          {!isBranchManager && can.viewAllBranches(role as UserRole) && (
            <StatCard label="Sucursales" value={totalBranches} sub="Activas"
              icon={MapPin} color="teal" href="/sucursales" />
          )}

          {/* Desglose fuera hoy */}
          <StatCard
            label="Ausentes hoy"
            value={ausenciasPuntuales.length}
            sub={criticalUncov.length > 0 ? `${criticalUncov.length} critico${criticalUncov.length > 1 ? "s" : ""}` : ausenciasPuntuales.length === 0 ? "Sin ausencias" : "Sin criticos"}
            icon={UserMinus}
            color={ausenciasPuntuales.length === 0 ? "green" : criticalUncov.length > 0 ? "red" : "orange"}
            href="/ausencias"
          />
          <StatCard
            label="Con licencia"
            value={licencias.length}
            sub={licencias.length === 0 ? "Sin licencias" : "Medicas / especiales"}
            icon={ClockIcon}
            color={licencias.length === 0 ? "green" : "blue"}
            href="/ausencias"
          />
          <StatCard
            label="Sin revisar"
            value={sinRevisar}
            sub={sinRevisar === 0 ? "Al dia" : "Pendientes de revision"}
            icon={BellDot}
            color={sinRevisar === 0 ? "green" : "amber"}
            href="/ausencias"
          />
          {role !== "HR" && role !== "MAINTENANCE" && (
            <StatCard label="Tickets abiertos" value={0} sub="Sin tickets"
              icon={Wrench} color="green" href="/mantenimiento" isComingSoon />
          )}
          {role !== "MAINTENANCE" && (
            <StatCard label="Tareas vencidas" value={0} sub="Al dia"
              icon={ClipboardList} color="green" href="/tareas" isComingSoon />
          )}
        </div>
      </section>

      {/* Detalle ausentes hoy */}
      {absencesHoy.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Fuera hoy — desglose
            </h3>
            <Link href="/ausencias?activeOnly=true"
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
              Ver todos <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Ausencias puntuales */}
          {ausenciasPuntuales.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5 font-medium">
                Ausencias ({ausenciasPuntuales.length})
              </p>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {ausenciasPuntuales.map(a => (
                      <AbsenceRow key={a.id} a={a} showBranch={!isBranchManager} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Licencias */}
          {licencias.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5 font-medium">
                Licencias ({licencias.length})
              </p>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {licencias.map(a => (
                      <AbsenceRow key={a.id} a={a} showBranch={!isBranchManager} isLeave />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Vacaciones — placeholder para Etapa 5 */}
          {vacaciones.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5 font-medium">Vacaciones ({vacaciones.length})</p>
            </div>
          )}
        </section>
      )}

      {/* Modulos proximos */}
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Proximos modulos
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {UPCOMING_MODULES
            .filter(m => m.roles.includes(role as UserRole) || m.roles.includes("ALL" as UserRole))
            .map(m => <UpcomingModuleCard key={m.label} module={m} />)}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function AlertBanner({ level, children }: { level: "critical"|"warning"|"info"; children: React.ReactNode }) {
  const styles = {
    critical: "bg-red-50 border-red-200 text-red-800",
    warning:  "bg-amber-50 border-amber-200 text-amber-800",
    info:     "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", styles[level])}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color, href, isComingSoon }: {
  label: string; value: number; sub?: string;
  icon: React.ElementType; color: string;
  href?: string; isComingSoon?: boolean;
}) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    blue:   { bg: "bg-blue-50",   text: "text-blue-600"   },
    teal:   { bg: "bg-teal-50",   text: "text-teal-600"   },
    orange: { bg: "bg-orange-50", text: "text-orange-500" },
    red:    { bg: "bg-red-50",    text: "text-red-500"    },
    green:  { bg: "bg-green-50",  text: "text-green-600"  },
    amber:  { bg: "bg-amber-50",  text: "text-amber-600"  },
    violet: { bg: "bg-violet-50", text: "text-violet-600" },
  };
  const c = colorMap[color] ?? colorMap.blue;
  const content = (
    <div className={cn("card p-5 hover:shadow-md transition-shadow", isComingSoon && "opacity-70")}>
      <div className={cn("inline-flex p-2 rounded-lg mb-3", c.bg)}>
        <Icon className={cn("w-5 h-5", c.text)} />
      </div>
      <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
      <p className="text-sm font-medium text-gray-700 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {isComingSoon && (
        <span className="inline-block mt-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">
          Proximamente
        </span>
      )}
    </div>
  );
  if (href && !isComingSoon) return <Link href={href}>{content}</Link>;
  return content;
}

function AbsenceRow({ a, showBranch, isLeave }: { a: any; showBranch: boolean; isLeave?: boolean }) {
  const TYPE_LABELS: Record<string, string> = {
    SICKNESS: "Enfermedad", PERSONAL_REASON: "Personal",
    NO_SHOW: "Sin aviso", LATE_NOTICE: "Aviso tarde",
    MEDICAL_LEAVE: "Lic. medica", SPECIAL_LEAVE: "Lic. especial", OTHER: "Otro",
  };
  return (
    <tr className={cn("hover:bg-gray-50", a.employee.position.requiresCoverage && "bg-red-50/30")}>
      <td className="px-4 py-2.5">
        <p className="font-medium text-gray-900 text-sm">
          {a.employee.firstName} {a.employee.lastName}
        </p>
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <span className="text-sm text-gray-600">{a.employee.position.name}</span>
        {a.employee.position.requiresCoverage && (
          <span className="ml-1.5 text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded font-medium">critico</span>
        )}
      </td>
      {showBranch && (
        <td className="px-4 py-2.5 text-sm text-gray-500 hidden md:table-cell">{a.branch.name}</td>
      )}
      <td className="px-4 py-2.5">
        <span className={cn(
          "text-[10px] font-medium px-1.5 py-0.5 rounded",
          isLeave ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"
        )}>
          {TYPE_LABELS[(a as any).absenceType] ?? (a as any).absenceType}
        </span>
      </td>
    </tr>
  );
}

type ModuleDef = {
  label: string; icon: React.ElementType; href: string;
  actions: string[]; roles: (UserRole | "ALL")[];
};
const UPCOMING_MODULES: ModuleDef[] = [
  {
    label: "Vacaciones", icon: CalendarDays, href: "/vacaciones",
    actions: ["Solicitar y aprobar por sucursal","Ver calendario de ausencias","Detectar conflictos antes de aprobar"],
    roles: ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  },
  {
    label: "Rotativas y coberturas", icon: RotateCcw, href: "/rotativas",
    actions: ["Ver disponibilidad del plantel","Asignar rotativos a vacantes","Detectar conflictos"],
    roles: ["SUPERVISOR","HR","ADMIN"],
  },
  {
    label: "Mantenimiento", icon: Wrench, href: "/mantenimiento",
    actions: ["Registrar tickets con prioridad","Asignar al personal","Seguimiento hasta resolucion"],
    roles: ["SUPERVISOR","BRANCH_MANAGER","MAINTENANCE","OWNER","ADMIN"],
  },
  {
    label: "Tareas", icon: ClipboardList, href: "/tareas",
    actions: ["Crear tareas por sucursal","Ver tareas vencidas","Alertas por incumplimiento"],
    roles: ["SUPERVISOR","BRANCH_MANAGER","OWNER","ADMIN"],
  },
];

function UpcomingModuleCard({ module: m }: { module: ModuleDef }) {
  const Icon = m.icon;
  return (
    <div className="card p-4 border-dashed opacity-70 hover:opacity-100 transition-opacity">
      <div className="flex items-center gap-2.5 mb-2.5">
        <Icon className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700">{m.label}</span>
        <span className="ml-auto text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
          En desarrollo
        </span>
      </div>
      <ul className="space-y-1">
        {m.actions.map(a => (
          <li key={a} className="flex items-start gap-1.5 text-xs text-gray-500">
            <span className="text-gray-300 mt-0.5 shrink-0">→</span>{a}
          </li>
        ))}
      </ul>
    </div>
  );
}
