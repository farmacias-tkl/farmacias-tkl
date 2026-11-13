/**
 * DELETE /api/time-events/compensations/[id]          deshace esa compensación
 * DELETE /api/time-events/compensations/[id]?batch=1  [id] es el batchId: deshace
 *        toda una compensación cargada por persona (todas las deudas que tocó)
 *
 * La deuda recupera los minutos. Queda registrado en AuditLog.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { undoCompensation } from "@/lib/time-events/actions";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.addCompensation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const batch = req.nextUrl.searchParams.get("batch") === "1";
  const r = await undoCompensation(prisma, session!.user, batch ? { batchId: params.id } : { compensationId: params.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ data: r.data });
}
