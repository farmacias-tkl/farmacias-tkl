/**
 * /api/call-center/metrics/config — configuración de las métricas del Call Center.
 *
 *  GET   versiones guardadas + opciones del formulario (cuentas de Emozion que escribieron y
 *        vendedores de SIAF con ventas recientes).
 *  POST  { validFrom: "AAAA-MM-DD", data } → crea una versión NUEVA. Nunca edita ni borra.
 *
 * Solo Dirección (canConfigureCallCenterMetrics), en los dos métodos: la respuesta del GET
 * trae nombres de vendedores y números de cuenta. El middleware ya exige canViewCallCenter;
 * este es el corte fino. Cada guardado queda en AuditLog.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfigureCallCenterMetrics } from "@/lib/permissions";
import { loadConfigVersions } from "@/lib/call-center/metrics/config";
import { loadConfigOptions, saveConfigVersion } from "@/lib/call-center/metrics/config-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (!canConfigureCallCenterMetrics(session.user)) return { error: NextResponse.json({ error: "Sin permisos" }, { status: 403 }) };
  return { user: session.user };
}

export async function GET() {
  const a = await authorize();
  if ("error" in a) return a.error;
  try {
    const [{ versions, invalid }, options] = await Promise.all([loadConfigVersions(), loadConfigOptions(prisma)]);
    return NextResponse.json({ data: { versions, invalid, options } });
  } catch (e) {
    console.error("[call-center/metrics/config] GET:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  try {
    const result = await saveConfigVersion(prisma, {
      actorUserId: a.user.id,
      validFrom: (body as Record<string, unknown>).validFrom,
      data: (body as Record<string, unknown>).data,
    });
    if (!result.ok) return NextResponse.json({ error: "La configuración no es válida", errors: result.errors }, { status: 400 });
    return NextResponse.json({ data: { id: result.id, validFrom: result.validFrom } }, { status: 201 });
  } catch (e) {
    // Sin el mensaje: Prisma incluye los argumentos (la configuración) en sus errores.
    console.error("[call-center/metrics/config] POST:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
