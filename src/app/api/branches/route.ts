/**
 * GET  /api/branches
 * POST /api/branches
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  name:    z.string().min(1).max(100),
  address: z.string().optional(),
  phone:   z.string().optional(),
  notes:   z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";

  const branches = await prisma.branch.findMany({
    where: includeInactive
      ? { showInOperative: true }
      : { active: true, showInOperative: true },
    orderBy: { name: "asc" },
    select:  { id: true, name: true, address: true, phone: true, active: true, notes: true },
  });

  return NextResponse.json({ data: branches });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.manageBranches, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.branch.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ error: `Ya existe la sucursal "${parsed.data.name}"` }, { status: 409 });
  }

  const branch = await prisma.branch.create({ data: { ...parsed.data, active: true } });

  await prisma.auditLog.create({
    data: { userId: session!.user.id, action: "CREATE", entity: "Branch", entityId: branch.id, detail: { name: branch.name } },
  }).catch(() => {});

  return NextResponse.json({ data: branch }, { status: 201 });
}
