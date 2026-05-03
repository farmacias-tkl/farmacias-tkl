/**
 * DELETE /api/positions/[id]/permissions/[permissionId]
 *   Revoca un permiso de un puesto.
 *
 * Solo OWNER + ADMIN. Registra SecurityEvent POSITION_PERMISSION_REVOKED.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCan, can } from "@/lib/permissions";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; permissionId: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.managePositionPermissions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  // Verificar existencia + traer info para el evento
  const existing = await prisma.positionPermission.findUnique({
    where: { positionId_permissionId: { positionId: params.id, permissionId: params.permissionId } },
    include: {
      position:   { select: { id: true, name: true } },
      permission: { select: { id: true, key: true, module: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Asignacion no encontrada" }, { status: 404 });
  }

  await prisma.positionPermission.delete({
    where: { positionId_permissionId: { positionId: params.id, permissionId: params.permissionId } },
  });

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  await prisma.securityEvent.create({
    data: {
      userId:    session!.user.id,
      actorId:   session!.user.id,
      type:      "POSITION_PERMISSION_REVOKED",
      detail:    {
        positionId:    existing.position.id,
        positionName:  existing.position.name,
        permissionKey: existing.permission.key,
        scope:         existing.scope,
      },
      ip:        ip ?? null,
      userAgent: ua ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
