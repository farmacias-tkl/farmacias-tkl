/**
 * GET /api/call-center/metrics/detected?from=YYYY-MM-DD&to=YYYY-MM-DD — bloque "Reclamos y
 * pérdidas" de las métricas del Call Center.
 *
 * Conversaciones creadas en el período con mensajes del cliente que coinciden con los
 * patrones de ventas (pérdida confirmada, no dice dónde, compró en TKL) y de reclamos (Call
 * Center, envíos, tienda online). Es nivel Detectado. Sin parámetros: los últimos 7 días.
 * Solo lectura.
 *
 * Gate: canViewCallCenterMetrics. La respuesta lleva el id interno de la conversación (para
 * el enlace), la fecha, el motivo y el estado; nunca teléfono, nombre ni texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getDetectedPayload } from "@/lib/call-center/metrics/detected";

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
    const data = await getDetectedPayload(period.from, period.to, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/detected]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
