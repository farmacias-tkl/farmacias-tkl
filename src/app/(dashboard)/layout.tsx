import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/cambiar-password");

  // La sesión ya está leída: useSession no espera un viaje a /api/auth/session,
  // y las pantallas piden sus datos desde el primer render.
  return (
    <SessionProvider session={session}>
      <DashboardShell user={{
        name:     session.user.name,
        email:    session.user.email,
        role:     session.user.role,
        branchId: session.user.branchId,
        executiveAccess: session.user.executiveAccess ?? false,
        callCenterAccess: session.user.callCenterAccess ?? false,
      }}>
        {children}
      </DashboardShell>
    </SessionProvider>
  );
}
