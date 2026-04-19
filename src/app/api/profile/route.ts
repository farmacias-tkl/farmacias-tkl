/**
 * GET /api/profile  — datos del perfil del usuario autenticado
 *
 * Devuelve datos propios. No expone passwordHash.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

export async function GET() {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true, createdAt: true,
      branch: { select: { id: true, name: true } },
      employeeId: true,
    },
  });

  if (!user) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  let employee = null;
  if (user.employeeId) {
    employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: {
        id: true, firstName: true, lastName: true,
        position:      { select: { name: true } },
        currentBranch: { select: { name: true } },
      },
    });
  }

  return NextResponse.json({ data: { ...user, employee } });
}

