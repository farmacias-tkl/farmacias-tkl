import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canViewCallCenter } from "@/lib/permissions";

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
      {children}
    </div>
  );
}
