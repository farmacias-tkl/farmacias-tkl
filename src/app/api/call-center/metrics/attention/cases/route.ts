/**
 * GET /api/call-center/metrics/attention/cases?kind=…&from=YYYY-MM-DD&to=YYYY-MM-DD — detalle
 * de casos de "Atención y demoras".
 *
 * kind: pending (sin primera respuesta), overdue (sin primera respuesta y con la meta
 * vencida) o unanswered_same_day (sin respuesta el mismo día). Devuelve la lista de
 * conversaciones que cuentan en ese indicador, con el mismo período que el informe. Solo
 * lectura.
 *
 * Gate: canViewCallCenterMetrics. Cada fila lleva el id interno de la conversación (para el
 * enlace), horas y etiquetas; nunca teléfono, nombre ni texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getAttentionCases, isAttentionCaseKind } from "@/lib/call-center/metrics/attention-cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenterMetrics(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  if (!isAttentionCaseKind(kind)) return NextResponse.json({ error: "Indicador desconocido" }, { status: 400 });
  const now = new Date();
  const period = resolvePeriod({ from: params.get("from"), to: params.get("to") }, arDayISO(now));
  if (!period.ok) return NextResponse.json({ error: period.error }, { status: 400 });

  try {
    const data = await getAttentionCases(period.from, period.to, kind, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/attention/cases]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
