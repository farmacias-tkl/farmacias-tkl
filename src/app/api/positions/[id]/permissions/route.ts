/**
 * GET  /api/positions/[id]/permissions  — lista de permisos asignados al puesto.
 * POST /api/positions/[id]/permissions  — upsert por (positionId, permissionId).
 *                                         Si scope cambia, actualiza. Si no, no-op.
 *
 * Solo OWNER + ADMIN (managePositionPermissions).
 *
 * SecurityEvent emitido:
 *  - POSITION_PERMISSION_GRANTED         cuando se crea por primera vez
 *  - POSITION_PERMISSION_SCOPE_CHANGED   cuando ya existia con otro scope
 *
 * userId del evento = actor.id (no hay User-sujeto natural; el sujeto es la
 * Position y va en detail).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCan, can } from "@/lib/permissions";
import { z } from "zod";

const postSchema = z.object({
  permissionId: z.string().min(1, "permissionId obligatorio"),
  scope:        z.enum(["OWN_BRANCH", "ALL_BRANCHES"]),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.managePositionPermissions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const position = await prisma.position.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, active: true },
  });
  if (!position) return NextResponse.json({ error: "Puesto no encontrado" }, { status: 404 });

  const rows = await prisma.positionPermission.findMany({
    where: { positionId: params.id },
    include: { permission: { select: { id: true, key: true, module: true, description: true, active: true } } },
    orderBy: [{ permission: { module: "asc" } }, { permission: { key: "asc" } }],
  });

  return NextResponse.json({
    data: rows.map(r => ({
      permissionId:    r.permissionId,
      key:             r.permission.key,
      module:          r.permission.module,
      description:     r.permission.description,
      permissionActive: r.permission.active,
      scope:           r.scope,
      grantedByUserId: r.grantedByUserId,
      createdAt:       r.createdAt,
      updatedAt:       r.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const permErr = requireCan(can.managePositionPermissions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const { permissionId, scope } = parsed.data;

  // Validar position
  const position = await prisma.position.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, active: true },
  });
  if (!position) return NextResponse.json({ error: "Puesto no encontrado" }, { status: 404 });
  if (!position.active) return NextResponse.json({ error: "Puesto inactivo" }, { status: 400 });

  // Validar permission
  const permission = await prisma.permission.findUnique({
    where:  { id: permissionId },
    select: { id: true, key: true, module: true, active: true },
  });
  if (!permission) return NextResponse.json({ error: "Permiso no encontrado" }, { status: 404 });
  if (!permission.active) return NextResponse.json({ error: "Permiso inactivo" }, { status: 400 });

  // Detectar si ya existia para discriminar evento
  const existing = await prisma.positionPermission.findUnique({
    where: { positionId_permissionId: { positionId: params.id, permissionId } },
    select: { id: true, scope: true },
  });

  // No-op: mismo scope
  if (existing && existing.scope === scope) {
    return NextResponse.json({ data: { positionId: params.id, permissionId, scope }, noop: true });
  }

  // Upsert
  const result = await prisma.positionPermission.upsert({
    where: { positionId_permissionId: { positionId: params.id, permissionId } },
    update: { scope, grantedByUserId: session!.user.id },
    create: { positionId: params.id, permissionId, scope, grantedByUserId: session!.user.id },
    select: { positionId: true, permissionId: true, scope: true, createdAt: true, updatedAt: true },
  });

  // SecurityEvent
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");

  if (existing) {
    await prisma.securityEvent.create({
      data: {
        userId:    session!.user.id,
        actorId:   session!.user.id,
        type:      "POSITION_PERMISSION_SCOPE_CHANGED",
        detail:    { positionId: position.id, positionName: position.name, permissionKey: permission.key, oldScope: existing.scope, newScope: scope },
        ip:        ip ?? null,
        userAgent: ua ?? null,
      },
    }).catch(() => {});
  } else {
    await prisma.securityEvent.create({
      data: {
        userId:    session!.user.id,
        actorId:   session!.user.id,
        type:      "POSITION_PERMISSION_GRANTED",
        detail:    { positionId: position.id, positionName: position.name, permissionKey: permission.key, scope },
        ip:        ip ?? null,
        userAgent: ua ?? null,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ data: result });
}
