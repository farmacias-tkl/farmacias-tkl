/**
 * GET /api/me
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
    select: { id: true, name: true, email: true, role: true, branchId: true, mustChangePassword: true, active: true },
  });

  if (!user || !user.active) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  return NextResponse.json({ data: user });
}
