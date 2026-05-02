/**
 * GET /api/owner/access — lista de usuarios con su flag executiveAccess.
 * Solo OWNER.
 *
 * Query params:
 *   search   string  — busca por nombre o email
 *   filter   "all" | "with-access" | "without-access" (default "all")
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canAccessOwnerPanel(session.user)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const sp     = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim();
  const filter = sp.get("filter") ?? "all";

  const where: any = { active: true };
  if (search) {
    where.OR = [
      { name:  { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  if (filter === "with-access")    where.executiveAccess = true;
  if (filter === "without-access") where.executiveAccess = false;

  const users = await prisma.user.findMany({
    where,
    select: {
      id:              true,
      name:            true,
      email:           true,
      role:            true,
      executiveAccess: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: [{ executiveAccess: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ data: users });
}
