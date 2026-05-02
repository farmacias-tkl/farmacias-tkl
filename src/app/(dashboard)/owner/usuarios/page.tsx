import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { UsuariosClient } from "./usuarios-client";

export default async function OwnerUsuariosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessOwnerPanel(session.user)) redirect("/sin-acceso");

  return <UsuariosClient currentUserId={session.user.id} />;
}
