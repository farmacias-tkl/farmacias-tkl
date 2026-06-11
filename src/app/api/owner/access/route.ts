/**
 * GET /api/owner/access — lista de usuarios con sus flags de acceso a módulos
 * (executiveAccess + callCenterAccess). Solo OWNER.
 *
 * Query params:
 *   search   string  — busca por nombre o email
 *   filter   "all" | "with-access" | "without-access"        (acceso ejecutivo)
 *                    | "cc-with-access" | "cc-without-access" (flag Call Center)
 *            (default "all")
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel, CALL_CENTER_ROLE_ACCESS } from "@/lib/permissions";

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

  // Se combinan con AND para no colisionar entre sí (la búsqueda usa OR).
  const and: any[] = [];
  if (search) {
    and.push({ OR: [
      { name:  { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]});
  }
  if (filter === "with-access")    and.push({ executiveAccess: true });
  if (filter === "without-access") and.push({ executiveAccess: false });
  // Call Center: ACCESO EFECTIVO (jerarquía OR flag), espejando canViewCallCenter
  // — no por el flag solo, o OWNER/ADMIN/SUPERVISOR sin flag caerían mal clasificados.
  if (filter === "cc-with-access") {
    and.push({ OR: [{ role: { in: CALL_CENTER_ROLE_ACCESS } }, { callCenterAccess: true }] });
  }
  if (filter === "cc-without-access") {
    and.push({ AND: [{ role: { notIn: CALL_CENTER_ROLE_ACCESS } }, { callCenterAccess: false }] });
  }

  const where: any = { active: true };
  if (and.length) where.AND = and;

  const users = await prisma.user.findMany({
    where,
    select: {
      id:               true,
      name:             true,
      email:            true,
      role:             true,
      executiveAccess:  true,
      callCenterAccess: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: [{ executiveAccess: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ data: users });
}
