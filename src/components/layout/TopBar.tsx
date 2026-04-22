"use client";
import Link from "next/link";
import { Menu, Bell, BarChart3 } from "lucide-react";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":     "Dashboard",
  "/sucursales":    "Sucursales",
  "/empleados":     "Empleados",
  "/ausencias":     "Ausencias",
  "/vacaciones":    "Vacaciones",
  "/rotativas":     "Rotativas",
  "/mantenimiento": "Mantenimiento",
  "/tareas":        "Tareas de supervisión",
  "/whatsapp":      "WhatsApp",
  "/alertas":       "Centro de alertas",
  "/admin":         "Administración",
};

interface Props {
  onMenuClick: () => void;
  userRole:    UserRole;
}

export function TopBar({ onMenuClick, userRole }: Props) {
  const pathname = usePathname();
  const title = Object.entries(PAGE_TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([route]) => pathname === route || pathname.startsWith(route + "/"))?.[1] ?? "TKL";

  const showExec = userRole === "OWNER" || userRole === "ADMIN";
  const execUrl  = process.env.NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL || "/executive";

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-6">
      <button onClick={onMenuClick} className="lg:hidden p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100">
        <Menu className="w-5 h-5" />
      </button>
      <h1 className="flex-1 text-sm font-semibold text-gray-800 truncate">{title}</h1>
      {showExec && (
        <Link
          href={execUrl}
          className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-[#1E2D5A] hover:text-[#D4632A] transition-colors border border-[#1E2D5A]/20 hover:border-[#D4632A] rounded-lg px-3 py-1.5"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Dashboard Ejecutivo →
        </Link>
      )}
      <button className="relative p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100">
        <Bell className="w-5 h-5" />
      </button>
    </header>
  );
}
