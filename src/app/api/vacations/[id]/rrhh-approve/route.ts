/**
 * POST /api/vacations/[id]/rrhh-approve
 *
 * PENDING_RRHH → APPROVED y descuenta el saldo.
 * Solo se llega a PENDING_RRHH con el paso de RRHH activo
 * (VACATIONS_RRHH_STEP=true, src/lib/vacations/config.ts). Se conserva para
 * reactivarlo sin cambios de código.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { rrhhApproveVacation } from "@/lib/vacations/actions";

const schema = z.object({ note: z.string().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.confirmVacation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const note = parsed.success ? parsed.data.note : undefined;

  const result = await rrhhApproveVacation(prisma, { id: params.id, userId: session!.user.id, note });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
