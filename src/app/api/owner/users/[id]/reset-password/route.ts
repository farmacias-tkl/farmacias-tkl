/**
 * POST /api/owner/users/[id]/reset-password
 *
 * Genera contrasena temporal aleatoria, la hashea, activa mustChangePassword.
 * Devuelve la contrasena en claro UNA SOLA VEZ.
 *
 * Solo OWNER. Sin restriccion de rol del target (puede resetear OWNER, ADMIN,
 * o cualquier otro). El OWNER tambien puede resetear su propia password.
 *
 * SecurityEvent: USER_PASSWORD_RESET.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { generatePassword } from "@/lib/passwords";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessOwnerPanel(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const user = await prisma.user.findUnique({
    where:  { id: params.id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (!user.active) {
    return NextResponse.json(
      { error: "No se puede resetear la contrasena de un usuario inactivo" },
      { status: 400 },
    );
  }

  const plainPassword = generatePassword();
  const passwordHash  = await bcrypt.hash(plainPassword, 12);

  await prisma.user.update({
    where: { id: params.id },
    data:  { passwordHash, mustChangePassword: true },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session.user.id,
      action:   "RESET_PASSWORD",
      entity:   "User",
      entityId: params.id,
      detail:   { targetEmail: user.email, targetRole: user.role },
    },
  }).catch(() => {});

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  await prisma.securityEvent.create({
    data: {
      userId:    user.id,
      actorId:   session.user.id,
      type:      "USER_PASSWORD_RESET",
      detail:    { email: user.email, role: user.role, isOwner: user.role === "OWNER" },
      ip:        ip ?? null,
      userAgent: ua ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({
    data: { id: user.id, name: user.name, email: user.email },
    temporaryPassword: plainPassword,
  });
}
