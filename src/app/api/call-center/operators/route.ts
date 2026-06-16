/**
 * GET /api/call-center/operators
 *
 * Usuarios ASIGNABLES para el picker de reasignar. Acceso al endpoint gateado por
 * canActOnCallCenter() (sesión actual).
 *
 * Fuente única de la regla de "asignable": un usuario es asignable si tiene acceso
 * EFECTIVO a Call Center. Reutilizamos canViewCallCenter(user) tal cual (es puro y
 * recibe el user por parámetro) en lugar de reexpresar la regla en un WHERE de Prisma
 * — la regla vive en una sola función. El universo de usuarios es chico, así que filtrar
 * en memoria es barato. Solo se prefiltra por active en la query.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canActOnCallCenter, canViewCallCenter } from "@/lib/permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canActOnCallCenter(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true, callCenterAccess: true },
    orderBy: { name: "asc" },
  });

  const operators = users
    .filter(canViewCallCenter)
    .map(({ id, name, role }) => ({ id, name, role }));

  return NextResponse.json({ data: operators });
}
