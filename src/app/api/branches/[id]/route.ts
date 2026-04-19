/**
 * GET   /api/branches/[id]
 * PATCH /api/branches/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const patchSchema = z.object({
  name:    z.string().min(1).max(100).optional(),
  address: z.string().optional().nullable(),
  phone:   z.string().optional().nullable(),
  notes:   z.string().optional().nullable(),
  active:  z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const branch = await prisma.branch.findUnique({ where: { id: params.id } });
  if (!branch) return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });

  return NextResponse.json({ data: branch });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.manageBranches, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.name) {
    const dup = await prisma.branch.findFirst({
      where: { name: parsed.data.name, NOT: { id: params.id } },
    });
    if (dup) return NextResponse.json({ error: `Ya existe la sucursal "${parsed.data.name}"` }, { status: 409 });
  }

  const branch = await prisma.branch.update({ where: { id: params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: { userId: session!.user.id, action: "UPDATE", entity: "Branch", entityId: branch.id, detail: parsed.data },
  }).catch(() => {});

  return NextResponse.json({ data: branch });
}
