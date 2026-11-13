/**
 * POST /api/time-events/bulk-resolve
 *
 * { ids: string[], action: "compensation" | "payroll" | "waive", note? }
 * Aplica la misma resolución a varias deudas, con una nota común. Todo o nada.
 * Motivo obligatorio para descuento y condonación. AuditLog por cada deuda.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { resolveEvents } from "@/lib/time-events/actions";

const schema = z.object({
  ids:    z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["compensation", "payroll", "waive"]),
  note:   z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.resolveTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  const r = await resolveEvents(prisma, session!.user, parsed.data);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ data: { resolved: r.data.resolved, status: r.data.status } });
}
