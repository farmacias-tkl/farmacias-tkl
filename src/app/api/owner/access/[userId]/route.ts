/**
 * PATCH /api/owner/access/[userId] — body: { executiveAccess: boolean }
 * Solo OWNER. Registra SecurityEvent.
 *
 * Guards:
 *  - El OWNER no puede modificar su propio acceso (siempre tiene acceso).
 *  - No se modifica el flag de un usuario con role OWNER (semánticamente
 *    siempre true, no revocable).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ executiveAccess: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canAccessOwnerPanel(session.user)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Guard self-modification
  if (params.userId === session.user.id) {
    return NextResponse.json(
      { error: "No podés modificar tu propio acceso ejecutivo." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where:  { id: params.userId },
    select: { id: true, name: true, email: true, role: true, executiveAccess: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Guard OWNER target
  if (target.role === "OWNER") {
    return NextResponse.json(
      { error: "Los usuarios OWNER tienen acceso siempre — no se puede modificar." },
      { status: 400 },
    );
  }

  // No-op si ya está en el valor pedido (evita SecurityEvent vacío)
  if (target.executiveAccess === parsed.data.executiveAccess) {
    return NextResponse.json({ data: target, noop: true });
  }

  const updated = await prisma.user.update({
    where: { id: params.userId },
    data:  { executiveAccess: parsed.data.executiveAccess },
    select: { id: true, name: true, email: true, role: true, executiveAccess: true },
  });

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");

  await prisma.securityEvent.create({
    data: {
      userId:  updated.id,
      actorId: session.user.id,
      type:    parsed.data.executiveAccess ? "EXECUTIVE_ACCESS_GRANTED" : "EXECUTIVE_ACCESS_REVOKED",
      detail:  { targetEmail: updated.email, targetRole: updated.role },
      ip:      ip ?? null,
      userAgent: ua ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}
