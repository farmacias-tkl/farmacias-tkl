import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import EmployeeHeader from "./EmployeeHeader";
import EmployeeSummaryCards from "./EmployeeSummaryCards";
import EmployeeTabs from "./EmployeeTabs";

export default async function EmpleadoDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const now      = new Date();

  const [
    employee,
    activeAbsences,
    openPlansCount,
    overdueCount,
    totalAbsences,
    totalOvertime,
    totalAssignments,
  ] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        position:      { select: { id: true, name: true, requiresCoverage: true } },
        currentBranch: { select: { id: true, name: true } },
      },
    }),
    prisma.absenceRecord.findMany({
      where: {
        employeeId: params.id,
        startDate:  { lte: todayEnd },
        endDate:    { gte: today },
        status:     { not: "CLOSED" },
      },
      select: {
        id: true, absenceType: true, status: true,
        startDate: true, endDate: true,
        branch: { select: { name: true } },
      },
    }),
    prisma.actionPlan.count({
      where: {
        employeeId: params.id,
        status:     { in: ["OPEN", "IN_PROGRESS"] },
      },
    }),
    prisma.actionPlan.count({
      where: {
        employeeId: params.id,
        deadline:   { lt: now },
        status:     { notIn: ["COMPLETED", "CLOSED", "CANCELLED"] },
      },
    }),
    prisma.absenceRecord.count({ where: { employeeId: params.id } }),
    prisma.overtimeRecord.count({ where: { employeeId: params.id } }),
    prisma.employeeBranchAssignment.count({ where: { employeeId: params.id } }),
  ]);

  if (!employee) notFound();

  if (
    session.user.role === "BRANCH_MANAGER" &&
    employee.currentBranchId !== session.user.branchId
  ) {
    redirect("/empleados");
  }

  const canCreate = can.createActionPlan(session.user.role);

  // Serializar para client components (Date → ISO string)
  const employeeData = {
    id:                employee.id,
    firstName:         employee.firstName,
    lastName:          employee.lastName,
    active:            employee.active,
    isRotating:        employee.isRotating,
    hireDate:          employee.hireDate?.toISOString() ?? null,
    workScheduleNotes: employee.workScheduleNotes ?? null,
    notes:             employee.notes ?? null,
    currentBranchId:   employee.currentBranchId ?? null,
    currentBranch:     employee.currentBranch ?? null,
    position:          employee.position ?? null,
  };

  const activeAbsencesData = activeAbsences.map(a => ({
    id:          a.id,
    absenceType: a.absenceType as string,
    status:      a.status as string,
    startDate:   a.startDate.toISOString(),
    endDate:     a.endDate.toISOString(),
    branchName:  a.branch.name,
  }));

  return (
    <div className="space-y-5">

      {/* Back + cabecera */}
      <div>
        <Link
          href="/empleados"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />Empleados
        </Link>
        <EmployeeHeader
          employee={employeeData}
          activeAbsences={activeAbsencesData}
          overdueCount={overdueCount}
        />
      </div>

      {/* Cards de resumen */}
      <EmployeeSummaryCards
        counts={{
          totalAbsences,
          openPlansCount,
          overdueCount,
          totalOvertime,
          totalAssignments,
        }}
      />

      {/* Tabs — Suspense requerido por useSearchParams */}
      <Suspense fallback={
        <div className="card p-4 h-12 animate-pulse bg-gray-50 rounded-xl" />
      }>
        <EmployeeTabs employee={employeeData} canCreate={canCreate} />
      </Suspense>

    </div>
  );
}
