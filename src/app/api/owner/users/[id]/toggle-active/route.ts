/**
 * PATCH /api/owner/users/[id]/toggle-active  — body { active: boolean }
 *
 * Solo OWNER. Mismos guards que PATCH /[id]:
 *  - No podes desactivar tu propio usuario.
 *  - Debe quedar al menos 1 OWNER activo.
 *
 * SecurityEvent: USER_DEACTIVATED o USER_REACTIVATED.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ active: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessOwnerPanel(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 });
  }
  const { active } = parsed.data;

  // Self-protection
  if (params.id === session.user.id && active === false) {
    return NextResponse.json(
      { error: "No podes desactivar tu propio usuario." },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where:  { id: params.id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // Mantener al menos 1 OWNER activo
  if (target.role === "OWNER" && active === false) {
    const remainingActiveOwners = await prisma.user.count({
      where: { role: "OWNER", active: true, id: { not: params.id } },
    });
    if (remainingActiveOwners === 0) {
      return NextResponse.json(
        { error: "Debe quedar al menos 1 usuario OWNER activo en el sistema." },
        { status: 400 },
      );
    }
  }

  // No-op idempotente
  if (target.active === active) {
    return NextResponse.json({ data: target, noop: true });
  }

  const updated = await prisma.user.update({
    where:  { id: params.id },
    data:   { active },
    select: { id: true, name: true, email: true, role: true, active: true },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session.user.id,
      action:   "UPDATE",
      entity:   "User",
      entityId: params.id,
      detail:   { changes: { active } },
    },
  }).catch(() => {});

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  await prisma.securityEvent.create({
    data: {
      userId:    updated.id,
      actorId:   session.user.id,
      type:      active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      detail:    { email: updated.email, role: updated.role, isOwner: updated.role === "OWNER" },
      ip:        ip ?? null,
      userAgent: ua ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}
