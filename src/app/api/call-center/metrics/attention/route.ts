/**
 * GET /api/call-center/metrics/attention?from=YYYY-MM-DD&to=YYYY-MM-DD — bloque "Atención y
 * demoras" de las métricas del Call Center.
 *
 * Conversaciones creadas en el período (días de Buenos Aires, inclusive): entradas, tiempo en
 * el bot, primera respuesta humana, cumplimiento de la meta, pendientes y resumen por día.
 * Sin parámetros: los últimos 7 días. Solo lectura.
 *
 * Gate: canViewCallCenterMetrics (Dirección, Administrador y Supervisión). Entrar a la
 * bandeja por el flag callCenterAccess NO alcanza. La respuesta lleva solo totales: ninguna
 * fila por conversación, ni teléfono, nombre o texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getAttentionPayload } from "@/lib/call-center/metrics/attention-service";

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
    const data = await getAttentionPayload(period.from, period.to, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/attention]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
