/**
 * DELETE /api/positions/[id]/permissions/[permissionId] — DESHABILITADO (2G).
 *
 * Los permisos por Puesto (PositionPermission) son legacy/inertes: ningún flujo los lee
 * para autorizar. La gestión de permisos operativos vive en Usuarios/Roles (UserPermission).
 * Esta ruta queda DESHABILITADA con 410 Gone (sin ejecutar ningún delete). Se preserva el
 * guard de permisos (managePositionPermissions). El schema PositionPermission NO se toca.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireCan, can } from "@/lib/permissions";

const GONE_MESSAGE =
  "Los permisos por Puesto están deshabilitados; gestionar permisos desde Usuarios/Roles.";

export async function DELETE(
  _req: NextRequest,
  _ctx: { params: { id: string; permissionId: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.managePositionPermissions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  return NextResponse.json({ error: GONE_MESSAGE }, { status: 410 });
}
