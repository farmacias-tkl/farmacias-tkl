import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canViewCallCenter, canSeePlatformLinkFromCallCenter, PLATFORM_HOME_ROUTE } from "@/lib/permissions";

export const metadata = {
  title: "Call Center — Farmacias TKL",
  robots: "noindex, nofollow",
};

export default async function CallCenterLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewCallCenter(session.user)) redirect("/sin-acceso");

  // Dominio separado con layout propio (espeja el Ejecutivo). El root layout ya
  // provee <html>/<body>; acá solo el wrapper de identidad.
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F4F5F7", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Vuelta a la plataforma operativa: par del botón "Call Center" de su barra superior
          (mismas clases). Vive en el layout para estar en la bandeja y en cada conversación. */}
      {canSeePlatformLinkFromCallCenter(session.user) && (
        <header className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-white px-4 lg:px-6">
          <Link
            href={PLATFORM_HOME_ROUTE}
            title="Volver a la plataforma"
            aria-label="Volver a la plataforma"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold text-[#1E2D5A] hover:bg-[#1E2D5A] hover:text-white transition-colors"
          >
            <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
            <span>Volver a la plataforma</span>
          </Link>
        </header>
      )}
      {children}
    </div>
  );
}
