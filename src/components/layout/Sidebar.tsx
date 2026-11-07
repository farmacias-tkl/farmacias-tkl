"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, ChevronRight, User } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { visibleMenu, ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { isRouteActive, ROUTE_META } from "./menu-meta";

interface SidebarProps {
  user: { name: string; email: string; role: UserRole; branchId: string | null };
}

/** Menú lateral de escritorio. En celular y tablet navega BottomNav. */
export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  // Rutas del menú excluyendo /perfil (va en zona de usuario)
  const menu       = visibleMenu(user.role);
  const menuRoutes = menu.filter(r => r !== "/perfil");
  const hasPerfil  = menu.includes("/perfil");

  const isActive = (route: string) => isRouteActive(route, pathname);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#1e2433] lg:flex">
        {/* Logo */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-[#2d3548]">
          <div>
            <span className="text-white font-semibold text-sm tracking-wide">Farmacias TKL</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">Supervision operativa</span>
          </div>
        </div>

        {/* Usuario + acceso a perfil */}
        <Link href="/perfil"
          className={cn(
            "px-4 py-3 border-b border-[#2d3548] group transition-colors",
            hasPerfil ? "hover:bg-[#2d3548] cursor-pointer" : "cursor-default"
          )}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 group-hover:bg-blue-500 transition-colors">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate leading-tight">{user.name}</p>
              <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5", ROLE_COLORS[user.role])}>
                {ROLE_LABELS[user.role]}
              </span>
            </div>
            {hasPerfil && (
              <User className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0 transition-colors" />
            )}
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {menuRoutes.map((route) => {
            const meta = ROUTE_META[route];
            if (!meta) return null;
            const Icon   = meta.icon;
            const active = isActive(route);
            return (
              <Link key={route} href={route}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm mb-0.5 transition-colors",
                  active
                    ? "bg-blue-600/20 text-white"
                    : "text-slate-400 hover:bg-[#2d3548] hover:text-white"
                )}>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{meta.label}</span>
                {active && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
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
            Cerrar sesion
          </button>
        </div>
      </aside>
    </>
  );
}

