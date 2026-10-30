/**
 * GET /api/vacations/metrics
 *
 * Los 4 indicadores de la pantalla Vacaciones (definición en
 * src/lib/vacations/kpis.ts): solicitadas, aprobadas (en curso o futuras),
 * rechazadas este mes y de vacaciones hoy.
 * Filtros: branchId opcional. BRANCH_MANAGER forzado a su sucursal.
 *
 * rrhhStep: si el paso de RRHH está activo (VACATIONS_RRHH_STEP=true), para
 * que la pantalla muestre o no PENDING_RRHH en el filtro de estados.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { countVacationKpis } from "@/lib/vacations/kpis";
import { isRrhhStepEnabled } from "@/lib/vacations/config";

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const rrhhStep = isRrhhStepEnabled();
  let branchId = req.nextUrl.searchParams.get("branchId") ?? undefined;
  if (session!.user.role === "BRANCH_MANAGER") {
    branchId = session!.user.branchId ?? undefined;
    if (!branchId) {
      return NextResponse.json({ data: { solicitadas: 0, aprobadas: 0, rechazadas: 0, hoy: 0, rrhhStep } });
    }
  }

  const counts = await countVacationKpis(prisma, { branchId });
  return NextResponse.json({ data: { ...counts, rrhhStep } });
}
