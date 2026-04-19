/**
 * GET  /api/positions  — lista puestos activos
 * POST /api/positions  — crea puesto (solo ADMIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  name:             z.string().min(1, "El nombre es obligatorio").max(100),
  requiresCoverage: z.boolean().default(false),
  isRotatingRole:   z.boolean().default(false),
  scope:            z.enum(["ALL", "SPECIFIC"]).default("ALL"),
  notes:            z.string().optional().nullable(),
  branchIds:        z.array(z.string()).optional(), // solo si scope=SPECIFIC
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";

  const positions = await prisma.position.findMany({
    where:   includeInactive ? undefined : { active: true },
    include: {
      branchScopes: {
        include: { branch: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: positions });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.managePositions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.position.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe el puesto "${parsed.data.name}"` },
      { status: 409 }
    );
  }

  const { branchIds, ...posData } = parsed.data;

  const position = await prisma.position.create({
    data: {
      ...posData,
      active: true,
      branchScopes:
        posData.scope === "SPECIFIC" && branchIds?.length
          ? { create: branchIds.map((branchId) => ({ branchId })) }
          : undefined,
    },
    include: {
      branchScopes: {
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "Position",
      entityId: position.id,
      detail:   { name: position.name },
    },
  }).catch(() => {});

  return NextResponse.json({ data: position }, { status: 201 });
}
