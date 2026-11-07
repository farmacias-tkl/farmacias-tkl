"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, MoreHorizontal, X } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { visibleMenu, ROLE_COLORS, ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { isRouteActive, ROUTE_META } from "./menu-meta";

/** Las secciones que van siempre a mano; el resto queda en "Más". */
const PRIMARY = ["/dashboard", "/vacaciones", "/empleados", "/ausencias"];

interface Props {
  user: { name: string; role: UserRole };
}

/** Navegación de celular y tablet: barra inferior fija. En escritorio, el Sidebar. */
export function BottomNav({ user }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const menu    = visibleMenu(user.role);
  const primary = PRIMARY.filter(r => menu.includes(r));
  const rest    = menu.filter(r => !PRIMARY.includes(r));
  const moreActive = rest.some(r => isRouteActive(r, pathname));

  // Al cambiar de pantalla se cierra "Más".
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const itemClass = (active: boolean) => cn(
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 h-14 text-[13px] tracking-tight transition-colors",
    active ? "text-blue-700 font-semibold" : "text-gray-500",
  );

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Más secciones">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{user.name}</p>
                <span className={cn("mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium", ROLE_COLORS[user.role])}>
                  {ROLE_LABELS[user.role]}
                </span>
              </div>
              <button onClick={() => setMoreOpen(false)} aria-label="Cerrar"
                className="flex items-center justify-center text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="py-1" aria-label="Más secciones">
              {rest.map(route => {
                const meta = ROUTE_META[route];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <Link key={route} href={route} onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex h-12 items-center gap-3 px-4 text-sm",
                      isRouteActive(route, pathname) ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700",
                    )}>
                    <Icon className="h-5 w-5 shrink-0" />
                    {meta.label}
                  </Link>
                );
              })}
              <button onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex h-12 w-full items-center gap-3 border-t border-gray-100 px-4 text-sm text-gray-700">
                <LogOut className="h-5 w-5 shrink-0" />
                Cerrar sesion
              </button>
            </nav>
          </div>
        </div>
      )}

      <nav aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {primary.map(route => {
          const meta = ROUTE_META[route];
          const Icon = meta.icon;
          const active = isRouteActive(route, pathname);
          return (
            <Link key={route} href={route} aria-current={active ? "page" : undefined} className={itemClass(active)}>
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate">{meta.label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen} className={itemClass(moreActive || moreOpen)}>
          <MoreHorizontal className="h-5 w-5 shrink-0" />
          <span>Más</span>
        </button>
      </nav>
    </>
  );
}
