import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import NuevoPlanForm from "./NuevoPlanForm";

export default async function NuevoPlanPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can.createActionPlan(session.user.role)) redirect(`/empleados/${params.id}?tab=planes`);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: {
      position:      { select: { id: true, name: true } },
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

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href={`/empleados/${params.id}?tab=planes`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />Volver a planes de acción
        </Link>
        <h2 className="text-xl font-bold text-gray-900">Nuevo plan de acción</h2>
        <p className="text-sm text-gray-500 mt-1">
          {employee.firstName} {employee.lastName}
          {employee.currentBranch && ` — ${employee.currentBranch.name}`}
        </p>
      </div>

      <NuevoPlanForm
        employeeId={employee.id}
        branchId={employee.currentBranchId ?? null}
        encargado={session.user.name ?? "—"}
        createdByUserId={session.user.id}
      />
    </div>
  );
}
