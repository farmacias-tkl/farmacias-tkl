/**
 * PATCH /api/overtime/[id] — resolver una hora extra (supervisión).
 *   { action: "approve", destination: "PAY" | "BANK" }
 *       Aprueba y define el destino, caso por caso. Con BANK suma las horas al
 *       banco de horas de la persona.
 *   { action: "reject", rejectionReason }
 *   { action: "set-destination", destination }
 *       Para una hora extra que quedó aprobada sin destino.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { decideOvertime, setOvertimeDestination } from "@/lib/hour-bank/actions";

const destination = z.enum(["PAY", "BANK"]);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), destination }),
  z.object({ action: z.literal("reject"), rejectionReason: z.string().max(500) }),
  z.object({ action: z.literal("set-destination"), destination }),
]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.approveOvertime, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const actor = session!.user;
  const result = d.action === "set-destination"
    ? await setOvertimeDestination(prisma, actor, { id: params.id, destination: d.destination })
    : await decideOvertime(prisma, actor, { id: params.id, ...d });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
