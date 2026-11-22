import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics, canConfigureCallCenterMetrics } from "@/lib/permissions";
import NowPanel from "./NowPanel";

export const metadata = { title: "Call Center — Métricas" };
export const dynamic = "force-dynamic";

// Métricas del Call Center. Gate propio: entrar a la bandeja no alcanza (un usuario que
// entra solo por el flag callCenterAccess no ve esta pantalla).
// Por ahora tiene un solo bloque, "Ahora"; los demás se suman como pestañas.
export default async function CallCenterMetricsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewCallCenterMetrics(session.user)) redirect("/sin-acceso");

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/call-center" className="text-xs text-gray-500 hover:text-gray-800">← Volver a conversaciones</Link>
        {canConfigureCallCenterMetrics(session.user) && (
          <Link href="/call-center/metricas/configuracion" className="text-xs font-medium text-[#1E2D5A] hover:underline">Configuración</Link>
        )}
      </div>
      <h1 className="mt-3 text-xl font-bold text-gray-900">Métricas del Call Center</h1>
      <NowPanel />
    </main>
  );
}
