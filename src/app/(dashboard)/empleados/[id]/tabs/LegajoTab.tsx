"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pencil } from "lucide-react";
import { can } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";

import type { SerializedEmployee as Employee } from "../EmployeeHeader";
import EmployeeForm from "../../EmployeeForm";

async function fetchList(url: string) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Error al cargar datos");
  return json.data ?? [];
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex py-3 border-b border-gray-100 last:border-0 gap-4">
      <dt className="text-xs font-medium text-gray-500 w-44 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-900 flex-1">
        {value ?? <span className="text-gray-400 italic text-xs">Sin datos</span>}
      </dd>
    </div>
  );
}

export default function LegajoTab({ employee: e }: { employee: Employee }) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role as UserRole | undefined;
  const canEdit = role ? can.manageEmployees(role) : false;
  const [editing, setEditing] = useState(false);
  const { data: branches } = useQuery({ queryKey: ["branches-list"], queryFn: () => fetchList("/api/branches"), enabled: editing });
  const { data: positions } = useQuery({ queryKey: ["positions-list"], queryFn: () => fetchList("/api/positions"), enabled: editing });

  const hireDateFmt = e.hireDate
    ? new Date(e.hireDate).toLocaleDateString("es-AR", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-400" />
          Datos del legajo
        </h3>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1.5 px-3">
            <Pencil className="w-3.5 h-3.5" />Editar
          </button>
        )}
      </div>
      {editing && (!branches || !positions) && (
        <div className="card p-5 text-xs text-gray-400">Cargando...</div>
      )}
      {editing && branches && positions && (
        <div className="card p-5">
          <EmployeeForm
            initial={{
              id: e.id,
              firstName: e.firstName,
              lastName: e.lastName,
              positionId: e.position?.id ?? null,
              secondaryPositionId: e.secondaryPosition?.id ?? null,
              contractBranchId: e.contractBranch?.id ?? null,
              currentBranchId: e.currentBranchId,
              isTechnicalDirector: e.isTechnicalDirector,
              isRotating: e.isRotating,
              weeklyHours: e.weeklyHours,
              extraTasks: e.extraTasks,
              hireDate: e.hireDate,
              workScheduleNotes: e.workScheduleNotes,
              notes: e.notes,
            }}
            branches={branches}
            positions={positions}
            lockBranchId={role === "BRANCH_MANAGER" ? session?.user?.branchId ?? null : null}
            onDone={() => { setEditing(false); router.refresh(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
      <div className="card p-4">
        <dl>
          <Row label="Nombre completo" value={`${e.firstName} ${e.lastName}`} />
          <Row label="Puesto" value={e.position?.name} />
          <Row
            label="Puesto crítico"
            value={e.position
              ? (e.position.requiresCoverage ? "Sí — requiere cobertura" : "No")
              : undefined}
          />
          <Row label="Puesto secundario" value={e.secondaryPosition?.name ?? "—"} />
          <Row label="Director/a técnico/a" value={e.isTechnicalDirector ? "Sí" : "No"} />
          <Row label="Sucursal donde trabaja" value={e.currentBranch?.name} />
          <Row label="Sucursal de contrato" value={e.contractBranch?.name} />
          <Row label="Fecha de ingreso" value={hireDateFmt} />
          <Row label="Estado en nómina" value={e.active ? "Activo" : "Inactivo"} />
          <Row label="Personal rotativo" value={e.isRotating ? "Sí" : "No"} />
          {e.weeklyHours !== null && (
            <Row label="Horas semanales declaradas" value={`${e.weeklyHours} h`} />
          )}
          {e.extraTasks && <Row label="Tareas adicionales" value={e.extraTasks} />}
          {e.workScheduleNotes && (
            <Row label="Horario habitual" value={e.workScheduleNotes} />
          )}
          {e.notes && (
            <Row label="Observaciones" value={
              <span className="italic text-gray-700">{e.notes}</span>
            } />
          )}
        </dl>
      </div>
    </div>
  );
}
