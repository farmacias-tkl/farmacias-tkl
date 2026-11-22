/**
 * GET /api/call-center/metrics/accounts?from=YYYY-MM-DD&to=YYYY-MM-DD — bloque "Operadores"
 * de las métricas del Call Center.
 *
 * Por CUENTA de Emozion (una cuenta no es una persona): conversaciones con participación,
 * primeras respuestas, respuestas posteriores, notas internas y actividad observada, más el
 * total del equipo. Sin parámetros: los últimos 7 días. Solo lectura.
 *
 * Gate: canViewCallCenterMetrics (Dirección, Administrador y Supervisión). Entrar a la
 * bandeja por el flag callCenterAccess NO alcanza. La respuesta lleva el número de cuenta y
 * el alias de la configuración; ninguna fila por conversación, ni teléfono, nombre o texto
 * del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getAccountsPayload } from "@/lib/call-center/metrics/accounts-service";

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
    const data = await getAccountsPayload(period.from, period.to, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/accounts]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
