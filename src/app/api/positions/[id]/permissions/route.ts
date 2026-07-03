/**
 * GET/POST /api/positions/[id]/permissions — DESHABILITADO (2G).
 *
 * Los permisos por Puesto (PositionPermission) son legacy/inertes: ningún flujo los lee
 * para autorizar. La gestión de permisos operativos vive en Usuarios/Roles (UserPermission).
 * Estas rutas quedan DESHABILITADAS con 410 Gone para cerrar la superficie legacy y evitar
 * crear datos muertos por API directa. Se preserva el guard de permisos (managePositionPermissions).
 * El schema PositionPermission NO se toca (cleanup posterior, si se decide).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireCan, can } from "@/lib/permissions";

const GONE_MESSAGE =
  "Los permisos por Puesto están deshabilitados; gestionar permisos desde Usuarios/Roles.";

async function gone(): Promise<NextResponse> {
  const session = await auth();
  const permErr = requireCan(can.managePositionPermissions, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });
  return NextResponse.json({ error: GONE_MESSAGE }, { status: 410 });
}

export async function GET(_req: NextRequest, _ctx: { params: { id: string } }) {
  return gone();
}

export async function POST(_req: NextRequest, _ctx: { params: { id: string } }) {
  return gone();
}
