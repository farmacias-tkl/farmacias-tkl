/**
 * GET /api/call-center/metrics/kinds/cases?motive=…&from=YYYY-MM-DD&to=YYYY-MM-DD — las
 * conversaciones de un motivo de contacto, para revisar si están bien clasificadas.
 *
 * motive: PEDIDO, CONSULTA, SEGUIMIENTO, RECLAMO, SALUDO o NO_IDENTIFICADO. Solo lectura.
 *
 * Gate: canViewCallCenterMetrics. Cada fila lleva el id interno de la conversación (para el
 * enlace), la fecha y marcas; nunca teléfono, nombre ni texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getMotiveCases } from "@/lib/call-center/metrics/kinds";
import { isMotive } from "@/lib/call-center/metrics/motives-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenterMetrics(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const motive = params.get("motive");
  if (!isMotive(motive)) return NextResponse.json({ error: "Motivo desconocido" }, { status: 400 });
  const now = new Date();
  const period = resolvePeriod({ from: params.get("from"), to: params.get("to") }, arDayISO(now));
  if (!period.ok) return NextResponse.json({ error: period.error }, { status: 400 });

  try {
    const data = await getMotiveCases(period.from, period.to, motive, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/kinds/cases]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
