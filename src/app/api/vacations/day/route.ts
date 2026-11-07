/**
 * GET /api/vacations/day?date=YYYY-MM-DD[&filtros de la lista]
 *
 * Detalle de un día del calendario: todas las solicitudes que lo incluyen, sin
 * el tope de filas de la lista, con los mismos filtros (vacationFilterWhere).
 * Roles: can.viewVacationDetail; el resto recibe 403.
 * BRANCH_MANAGER: forzado a su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { buildVacationDay, isIsoDay, loadVacationDay } from "@/lib/vacations/day-detail";
import { vacationFilterWhere } from "@/lib/vacations/list-where";

export async function GET(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.viewVacationDetail, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  if (!isIsoDay(date)) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });

  const where = vacationFilterWhere(sp, session!.user);
  const data = where ? await loadVacationDay(prisma, date, where) : buildVacationDay(date, [], {});
  return NextResponse.json({ data });
}
