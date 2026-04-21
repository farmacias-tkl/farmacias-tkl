"use client";
import { FileText } from "lucide-react";

interface Employee {
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
  const hireDateFmt = e.hireDate
    ? new Date(e.hireDate).toLocaleDateString("es-AR", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <FileText className="w-4 h-4 text-gray-400" />
        Datos del legajo
      </h3>
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
          <Row label="Sucursal" value={e.currentBranch?.name} />
          <Row label="Fecha de ingreso" value={hireDateFmt} />
          <Row label="Estado en nómina" value={e.active ? "Activo" : "Inactivo"} />
          <Row label="Personal rotativo" value={e.isRotating ? "Sí" : "No"} />
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
