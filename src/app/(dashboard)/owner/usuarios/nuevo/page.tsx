import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { NuevoUsuarioClient } from "./nuevo-client";

export default async function OwnerNuevoUsuarioPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessOwnerPanel(session.user)) redirect("/sin-acceso");

  return <NuevoUsuarioClient />;
}
