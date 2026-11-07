/**
 * GET /api/vacations/day?date=YYYY-MM-DD[&filtros de la lista]
 *
 * Detalle de un día del calendario: todas las solicitudes que lo incluyen, sin
 * el tope de filas de la lista, con los mismos filtros (vacationFilterWhere).
 * BRANCH_MANAGER: forzado a su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { buildVacationDay, isIsoDay, loadVacationDay } from "@/lib/vacations/day-detail";
import { vacationFilterWhere } from "@/lib/vacations/list-where";

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  if (!isIsoDay(date)) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });

  const where = vacationFilterWhere(sp, session!.user);
  const data = where ? await loadVacationDay(prisma, date, where) : buildVacationDay(date, [], {});
  return NextResponse.json({ data });
}
