import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { AccessosClient } from "./accesos-client";

export default async function OwnerAccessosPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessOwnerPanel(session.user)) redirect("/sin-acceso");

  return <AccessosClient currentUserId={session.user.id} />;
}
