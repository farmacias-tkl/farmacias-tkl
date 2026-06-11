import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewCallCenter } from "@/lib/permissions";

/**
 * GET /api/call-center/ping — placeholder gateado de la fundación.
 * Gate en el HANDLER (defensa en profundidad, sin puerta lateral): usa la
 * jerarquía completa via canViewCallCenter, NO el flag solo — un SUPERVISOR sin
 * flag entra por rol. No confía únicamente en el middleware.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenter(session.user)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, module: "call-center" });
}
