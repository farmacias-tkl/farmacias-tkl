/**
 * GET /api/call-center/metrics/now — bloque "Ahora" de las métricas del Call Center.
 *
 * Quién espera una respuesta en este momento (abiertas con hasta 72 horas de espera), las
 * abiertas más viejas para cerrar en Emozion, las cerradas sin responder de los últimos 7
 * días y los datos de la pestaña "Calidad de datos". Solo lectura.
 *
 * Gate: canViewCallCenterMetrics (Dirección, Administrador y Supervisión). Entrar a la
 * bandeja por el flag callCenterAccess NO alcanza. La respuesta lleva ids internos de
 * conversación, horas y marcas; nunca teléfono, nombre ni texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { getNowPayload } from "@/lib/call-center/metrics/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenterMetrics(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  try {
    return NextResponse.json({ data: await getNowPayload() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/now]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
