"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, CalendarDays, Users, Wrench, ClipboardList,
  MessageSquare, BellDot, Settings, LogOut, ChevronRight,
  X, MapPin, UserMinus,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { MENU_BY_ROLE, ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ROUTE_META: Record<string, { label: string; icon: React.ElementType }> = {
  "/dashboard":     { label: "Dashboard",      icon: LayoutDashboard },
  "/sucursales":    { label: "Sucursales",     icon: MapPin          },
  "/empleados":     { label: "Empleados",      icon: Users           },
  "/ausencias":     { label: "Ausencias",      icon: UserMinus       },
  "/vacaciones":    { label: "Vacaciones",     icon: CalendarDays    },
  "/rotativas":     { label: "Rotativas",      icon: Users           },
  "/mantenimiento": { label: "Mantenimiento",  icon: Wrench          },
  "/tareas":        { label: "Tareas",         icon: ClipboardList   },
  "/whatsapp":      { label: "WhatsApp",       icon: MessageSquare   },
  "/alertas":       { label: "Alertas",        icon: BellDot         },
  "/admin":         { label: "Administración", icon: Settings        },
};

interface SidebarProps {
  user: { name: string; email: string; role: UserRole; branchId: string | null };
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ user, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const menuRoutes = MENU_BY_ROLE[user.role] ?? [];

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={onClose} />
      )}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-[#1e2433] transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-[#2d3548]">
          <div>
            <span className="text-white font-semibold text-sm tracking-wide">Farmacias TKL</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">Supervisión operativa</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User */}
        <div className="px-4 py-3 border-b border-[#2d3548]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate leading-tight">{user.name}</p>
              <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5", ROLE_COLORS[user.role])}>
                {ROLE_LABELS[user.role]}
                {user.branchId && ` · ${user.branchId}`}
              </span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {menuRoutes.map((route) => {
            const meta = ROUTE_META[route];
            if (!meta) return null;
            const Icon = meta.icon;
            const isActive = route === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === route || pathname.startsWith(route + "/");
            return (
              <Link key={route} href={route} onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm mb-0.5 transition-colors",
                  isActive
                    ? "bg-blue-600/20 text-white"
                    : "text-slate-400 hover:bg-[#2d3548] hover:text-white"
                )}>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{meta.label}</span>
                {isActive && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-[#2d3548]">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-[#2d3548] hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
