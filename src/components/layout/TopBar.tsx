"use client";
import { Menu, Bell } from "lucide-react";
import { usePathname } from "next/navigation";

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

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const title = Object.entries(PAGE_TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([route]) => pathname === route || pathname.startsWith(route + "/"))?.[1] ?? "TKL";

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-6">
      <button onClick={onMenuClick} className="lg:hidden p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100">
        <Menu className="w-5 h-5" />
      </button>
      <h1 className="flex-1 text-sm font-semibold text-gray-800 truncate">{title}</h1>
      <button className="relative p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100">
        <Bell className="w-5 h-5" />
      </button>
    </header>
  );
}
