/**
 * GET /api/permissions  — catalogo de permisos operativos activos,
 * agrupado por modulo.
 *
 * Solo OWNER + ADMIN. Usado por la UI de /puestos para listar permisos
 * disponibles al asignar a un puesto.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCan, can } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.managePositionPermissions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const permissions = await prisma.permission.findMany({
    where:  { active: true },
    select: { id: true, key: true, module: true, description: true },
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });

  // Agrupar por modulo
  const byModule = new Map<string, typeof permissions>();
  for (const p of permissions) {
    const list = byModule.get(p.module) ?? [];
    list.push(p);
    byModule.set(p.module, list);
  }

  const data = Array.from(byModule.entries())
    .map(([module, perms]) => ({ module, permissions: perms }))
    .sort((a, b) => a.module.localeCompare(b.module));

  return NextResponse.json({ data });
}
