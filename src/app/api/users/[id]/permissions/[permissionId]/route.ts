/**
 * DELETE /api/users/[id]/permissions/[permissionId]  — revoca un permiso del usuario.
 *
 * Handler FINO (Fase 2C-B): auth() → cargar actor desde DB → delegar al servicio
 * user-permissions-admin (2C-A). NO reimplementa canRevokeUserPermission: la
 * autorización (incluido "ADMIN no auto-revoca críticos") y el AuditLog en
 * $transaction viven en el servicio.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  revokeUserPermissionFromTarget,
  type UserPermissionAdminClient,
} from "@/lib/permissions/user-permissions-admin";
import type { MinimalUser } from "@/lib/permissions/user-permissions";

const adminClient = prisma as unknown as UserPermissionAdminClient;

/** Carga el actor desde DB (no confiar solo en el JWT para `active`). */
async function loadActor(): Promise<MinimalUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, active: true },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; permissionId: string } },
) {
  const actor = await loadActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await revokeUserPermissionFromTarget({
    actor,
    targetUserId: params.id,
    permissionId: params.permissionId,
    client: adminClient,
    ip,
    userAgent,
  });
  return NextResponse.json(result.body, { status: result.status });
}
