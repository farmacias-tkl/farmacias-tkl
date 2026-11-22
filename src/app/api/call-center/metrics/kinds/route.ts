/**
 * GET /api/call-center/metrics/kinds?from=YYYY-MM-DD&to=YYYY-MM-DD — bloque "Tipos" de las
 * métricas del Call Center.
 *
 * Conversaciones creadas en el período clasificadas por tipo (reclamo, pedido, pedido sin
 * confirmar, consulta, sin contenido, sin clasificar), con subtipos, por día y por hora de
 * entrada. Es nivel Detectado hasta que llegue el tipo de cierre de Emozion. Sin
 * parámetros: los últimos 7 días. Solo lectura.
 *
 * Gate: canViewCallCenterMetrics. La respuesta lleva solo conteos: ninguna fila por
 * conversación, ni teléfono, nombre o texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getKindsPayload } from "@/lib/call-center/metrics/kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenterMetrics(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const now = new Date();
  const period = resolvePeriod({ from: params.get("from"), to: params.get("to") }, arDayISO(now));
  if (!period.ok) return NextResponse.json({ error: period.error }, { status: 400 });

  try {
    const data = await getKindsPayload(period.from, period.to, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/kinds]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
