import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/cambiar-password");

  return (
    <DashboardShell user={{
      name:     session.user.name,
      email:    session.user.email,
      role:     session.user.role,
      branchId: session.user.branchId,
    }}>
      {children}
    </DashboardShell>
  );
}
