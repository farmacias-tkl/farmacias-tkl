import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics, canViewCallCenterSales, canConfigureCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import NowPanel from "./NowPanel";
import AttentionPanel from "./AttentionPanel";
import OperatorsPanel from "./OperatorsPanel";
import QualityPanel from "./QualityPanel";
import SalesPanel from "./SalesPanel";

export const metadata = { title: "Call Center — Métricas" };
export const dynamic = "force-dynamic";

// Bloques de la pantalla, uno por pestaña. Los que faltan se suman acá.
const BLOCKS = [
  { key: "ahora", label: "Ahora" },
  { key: "atencion", label: "Atención y demoras" },
  { key: "operadores", label: "Operadores" },
  { key: "ventas", label: "Ventas SIAF" },
  { key: "datos", label: "Calidad de datos" },
] as const;
type BlockKey = (typeof BLOCKS)[number]["key"];

// Métricas del Call Center. Gate propio: entrar a la bandeja no alcanza (un usuario que
// entra solo por el flag callCenterAccess no ve esta pantalla).
export default async function CallCenterMetricsPage({ searchParams }: { searchParams: { bloque?: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewCallCenterMetrics(session.user)) redirect("/sin-acceso");

  // Ventas SIAF tiene su propio permiso: sin él, la pestaña no existe.
  const blocks = BLOCKS.filter((b) => b.key !== "ventas" || canViewCallCenterSales(session.user));
  // Un valor desconocido, o un bloque que el usuario no puede ver, cae en "Ahora".
  const block: BlockKey = blocks.find((b) => b.key === searchParams.bloque)?.key ?? "ahora";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/call-center" className="text-xs text-gray-500 hover:text-gray-800">← Volver a conversaciones</Link>
        {canConfigureCallCenterMetrics(session.user) && (
          <Link href="/call-center/metricas/configuracion" className="text-xs font-medium text-[#1E2D5A] hover:underline">Configuración</Link>
        )}
      </div>
      <h1 className="mt-3 text-xl font-bold text-gray-900">Métricas del Call Center</h1>

      <nav aria-label="Bloques de métricas" className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
        {blocks.map((b) => {
          const active = b.key === block;
          return (
            <Link
              key={b.key}
              href={b.key === "ahora" ? "/call-center/metricas" : `/call-center/metricas?bloque=${b.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-[#1E2D5A] text-[#1E2D5A]" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            >
              {b.label}
            </Link>
          );
        })}
      </nav>

      {block === "ahora" && <NowPanel />}
      {block === "atencion" && <AttentionPanel today={arDayISO(new Date())} />}
      {block === "operadores" && <OperatorsPanel today={arDayISO(new Date())} />}
      {block === "ventas" && <SalesPanel today={arDayISO(new Date())} />}
      {block === "datos" && <QualityPanel />}
    </main>
  );
}
