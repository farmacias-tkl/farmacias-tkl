/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Genera una contraseña temporal aleatoria, la hashea y la guarda.
 * Activa mustChangePassword = true.
 * Devuelve la contraseña en claro UNA SOLA VEZ.
 *
 * Solo ADMIN.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCan, can } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import crypto from "crypto";

function generatePassword(): string {
  const upper  = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower  = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special= "!@#$";
  const all    = upper + lower + digits + special;

  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    special[crypto.randomInt(special.length)],
  ];
  const rest = Array.from({ length: 8 }, () => all[crypto.randomInt(all.length)]);
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const permErr = requireCan(can.manageUsers, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (!user.active) {
    return NextResponse.json(
      { error: "No se puede resetear la contraseña de un usuario inactivo" },
      { status: 400 }
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
      userId:   session!.user.id,
      action:   "RESET_PASSWORD",
      entity:   "User",
      entityId: params.id,
      detail:   { targetEmail: user.email },
    },
  }).catch(() => {});

  return NextResponse.json({
    data: { id: user.id, name: user.name, email: user.email },
    temporaryPassword: plainPassword,
  });
}

