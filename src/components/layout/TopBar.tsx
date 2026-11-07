"use client";
import { Bell, LineChart, Headset } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":     "Dashboard",
  "/sucursales":    "Sucursales",
  "/empleados":     "Empleados",
  "/vacaciones":    "Vacaciones",
  "/rotativas":     "Rotativas",
  "/mantenimiento": "Mantenimiento",
  "/tareas":        "Tareas de supervisión",
  "/whatsapp":      "WhatsApp",
  "/alertas":       "Centro de alertas",
  "/horas-extras":  "Horas extras",
  "/planes-accion": "Planes de acción",
  "/puestos":       "Puestos",
  "/perfil":        "Mi perfil",
  "/owner":         "Panel Dirección",
  "/admin":         "Administración",
};

export function TopBar({ canExecutive, canCallCenter }: { canExecutive: boolean; canCallCenter: boolean }) {
  const pathname = usePathname();
  // Páginas no listadas (incluyendo /ausencias) muestran la barra sin título
  // porque el título ya aparece en el contenido de la página.
  const title = Object.entries(PAGE_TITLES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([route]) => pathname === route || pathname.startsWith(route + "/"))?.[1] ?? "";

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-4 sm:gap-3 lg:px-6">
      {/* min-w-0: el título se corta antes de meterse debajo de los botones. */}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{title}</h1>
      {canCallCenter && (
        <Link
          href="/call-center"
          title="Call Center"
          aria-label="Call Center"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-[#1E2D5A] hover:bg-[#1E2D5A] hover:text-white transition-colors sm:h-auto sm:w-auto sm:border sm:border-[#1E2D5A] sm:bg-white sm:px-2.5 sm:py-1"
        >
          <Headset className="w-5 h-5 shrink-0 sm:w-3.5 sm:h-3.5" />
          <span className="hidden sm:inline">Call Center</span>
        </Link>
      )}
      {canExecutive && (
        <Link
          href="/executive"
          title="Dashboard Ejecutivo"
          aria-label="Dashboard Ejecutivo"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-[#1E2D5A] hover:bg-[#1E2D5A] hover:text-white transition-colors sm:h-auto sm:w-auto sm:border sm:border-[#1E2D5A] sm:bg-white sm:px-2.5 sm:py-1"
        >
          <LineChart className="w-5 h-5 shrink-0 sm:w-3.5 sm:h-3.5" />
          <span className="hidden sm:inline">Dashboard Ejecutivo</span>
        </Link>
      )}
      <button aria-label="Notificaciones" className="relative flex h-11 w-11 shrink-0 items-center justify-center text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100 sm:h-auto sm:w-auto sm:p-1.5">
        <Bell className="w-5 h-5" />
      </button>
    </header>
  );
}
