/**
 * GET /api/time-events/balance?branchId=
 *
 * Total por persona ("Saldo por empleado"): adeudado, compensado y pendiente,
 * y cuánto está en revisión, a compensar y enviado a descuento. Incluye lo que
 * todavía está pendiente de revisión. Ordenado de mayor a menor pendiente.
 *
 * BRANCH_MANAGER: solo su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { loadBalances } from "@/lib/time-events/actions";

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });
  const data = await loadBalances(prisma, session!.user, { branchId: req.nextUrl.searchParams.get("branchId") });
  return NextResponse.json({ data });
}
