/**
 * POST /api/vacations/[id]/undo-approval
 *
 * Deshacer aprobación (adenda B.2): APPROVED → PENDING_SUPERVISOR.
 * Devuelve los días a los mismos años, libera la cobertura vinculada y queda
 * en VacationStateHistory + AuditLog (VACATION_APPROVAL_UNDONE). Nota obligatoria.
 * Para rechazar una aprobada: primero deshacer, después supervisor-reject.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { undoApproval } from "@/lib/vacations/actions";

const schema = z.object({ note: z.string().trim().min(1, "Nota obligatoria") });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.approveVacation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nota obligatoria para deshacer la aprobación" }, { status: 400 });
  }

  const result = await undoApproval(prisma, { id: params.id, userId: session!.user.id, note: parsed.data.note });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
