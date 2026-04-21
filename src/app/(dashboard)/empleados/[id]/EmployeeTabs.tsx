"use client";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import ResumenTab from "./tabs/ResumenTab";
import AusenciasTab from "./tabs/AusenciasTab";
import ActionPlansTab from "./tabs/ActionPlansTab";
import HorasExtrasTab from "./tabs/HorasExtrasTab";
import HistorialSucursalesTab from "./tabs/HistorialSucursalesTab";
import VacacionesTab from "./tabs/VacacionesTab";
import LegajoTab from "./tabs/LegajoTab";
import type { SerializedEmployee } from "./EmployeeHeader";

const TABS = [
  { id: "resumen",      label: "Resumen" },
  { id: "ausencias",    label: "Ausencias" },
  { id: "planes",       label: "Planes de acción" },
  { id: "horas-extras", label: "Horas extras" },
  { id: "historial",    label: "Historial sucursales" },
  { id: "vacaciones",   label: "Vacaciones" },
  { id: "legajo",       label: "Legajo" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Props {
  employee:  SerializedEmployee;
  canCreate: boolean;
}

export default function EmployeeTabs({ employee, canCreate }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const activeTab    = (searchParams.get("tab") ?? "resumen") as TabId;

  const navigate = (tab: TabId) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", tab);
    router.push(`${pathname}?${p.toString()}`);
  };

  const employeeName = `${employee.firstName} ${employee.lastName}`;

  return (
    <div className="space-y-4">

      {/* Barra de tabs */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex min-w-max" aria-label="Secciones del legajo">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => navigate(t.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                activeTab === t.id
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Contenido — lazy mount por tab */}
      {activeTab === "resumen" && (
        <ResumenTab
          employeeId={employee.id}
          branchId={employee.currentBranchId}
          onNavigate={(tab) => navigate(tab as TabId)}
        />
      )}
      {activeTab === "ausencias" && (
        <AusenciasTab employeeId={employee.id} />
      )}
      {activeTab === "planes" && (
        <ActionPlansTab
          employeeId={employee.id}
          employeeName={employeeName}
          branchId={employee.currentBranchId}
          branchName={employee.currentBranch?.name ?? null}
          canCreate={canCreate}
        />
      )}
      {activeTab === "horas-extras" && (
        <HorasExtrasTab employeeId={employee.id} />
      )}
      {activeTab === "historial" && (
        <HistorialSucursalesTab employeeId={employee.id} />
      )}
      {activeTab === "vacaciones" && <VacacionesTab />}
      {activeTab === "legajo"     && <LegajoTab employee={employee} />}

    </div>
  );
}
