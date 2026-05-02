import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { EditarUsuarioClient } from "./editar-client";

export default async function OwnerEditarUsuarioPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessOwnerPanel(session.user)) redirect("/sin-acceso");

  return <EditarUsuarioClient userId={params.id} currentUserId={session.user.id} />;
}
