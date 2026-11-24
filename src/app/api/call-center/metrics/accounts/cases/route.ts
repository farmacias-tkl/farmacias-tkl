/**
 * GET /api/call-center/metrics/accounts/cases?kind=…&from=YYYY-MM-DD&to=YYYY-MM-DD[&account=N]
 * — detalle de casos de "Operadores".
 *
 * kind: slow_followups, unanswered_blocks, several_accounts o first_response_later_day.
 * `account` (número de cuenta de Emozion) limita la lista a una cuenta. Solo lectura.
 *
 * Gate: canViewCallCenterMetrics. Cada fila lleva el id interno de la conversación (para el
 * enlace), horas y nombres de cuenta; nunca teléfono, nombre ni texto del cliente.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getOperatorCases, isOperatorCaseKind } from "@/lib/call-center/metrics/accounts-cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenterMetrics(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  if (!isOperatorCaseKind(kind)) return NextResponse.json({ error: "Indicador desconocido" }, { status: 400 });
  const account = params.get("account");
  if (account !== null && !/^\d{1,12}$/.test(account)) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
  const now = new Date();
  const period = resolvePeriod({ from: params.get("from"), to: params.get("to") }, arDayISO(now));
  if (!period.ok) return NextResponse.json({ error: period.error }, { status: 400 });

  try {
    const data = await getOperatorCases(period.from, period.to, kind, account, now);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/accounts/cases]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
