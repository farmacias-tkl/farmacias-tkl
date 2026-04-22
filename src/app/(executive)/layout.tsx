import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Dashboard Ejecutivo — Farmacias TKL",
  robots: "noindex, nofollow",
};

export default async function ExecutiveLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["OWNER", "ADMIN", "SUPERVISOR"].includes(session.user.role)) redirect("/sin-acceso");

  // No emitimos <html>/<body> — el root layout ya los provee. Aplicamos la identidad TKL con un wrapper.
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F4F5F7", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {children}
    </div>
  );
}
