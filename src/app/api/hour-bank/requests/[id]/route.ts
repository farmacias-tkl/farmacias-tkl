/**
 * PATCH /api/hour-bank/requests/[id]
 *   { action: "approve", hours?, coveredByEmployeeId?, coverageNote?, note? }
 *       Supervisión autoriza: descuenta las horas del banco. Puede corregir las
 *       horas y quién cubre.
 *   { action: "reject", note }   Supervisión rechaza (motivo obligatorio).
 *   { action: "cancel", note? }  Pendiente: quien puede pedir (encargado/a, su
 *       sucursal). Ya autorizado: solo supervisión, con motivo; vuelven las horas.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { cancelRequest, decideRequest } from "@/lib/hour-bank/actions";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    hours: z.number().positive().max(2000).nullable().optional(),
    coveredByEmployeeId: z.string().min(1).nullable().optional(),
    coverageNote: z.string().max(300).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  }),
  z.object({ action: z.literal("reject"), note: z.string().max(500).nullable().optional() }),
  z.object({ action: z.literal("cancel"), note: z.string().max(500).nullable().optional() }),
]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const permErr = requireCan(d.action === "cancel" ? can.requestHourBank : can.authorizeHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const actor = session!.user;

  const result = d.action === "cancel"
    ? await cancelRequest(prisma, actor, { id: params.id, note: d.note, canAuthorize: can.authorizeHourBank(actor.role) })
    : await decideRequest(prisma, actor, { id: params.id, ...d });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
