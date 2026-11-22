/**
 * GET /api/call-center/metrics/sales?from=YYYY-MM-DD&to=YYYY-MM-DD — bloque "Ventas SIAF" de
 * las métricas del Call Center.
 *
 * Comprobantes de SIAF de los vendedores configurados como Call Center: importe bruto,
 * comprobantes, descuentos y unidades, por día, sucursal y vendedor. Sin parámetros: los
 * últimos 7 días. Solo lectura.
 *
 * Gate propio: canViewCallCenterSales (Dirección, Administrador y Supervisión). Ver las
 * métricas no alcanza por sí solo, y no da acceso al Dashboard Ejecutivo. Cada vista queda
 * registrada en AccessLog como VIEW_CALL_CENTER_SALES; si el registro falla, no se entregan
 * los datos.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCallCenterMetrics, canViewCallCenterSales } from "@/lib/permissions";
import { arDayISO } from "@/lib/call-center/metrics/business-time";
import { resolvePeriod } from "@/lib/call-center/metrics/period";
import { getSalesPayload } from "@/lib/call-center/metrics/sales-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewCallCenterMetrics(session.user) || !canViewCallCenterSales(session.user)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const now = new Date();
  const period = resolvePeriod({ from: params.get("from"), to: params.get("to") }, arDayISO(now));
  if (!period.ok) return NextResponse.json({ error: period.error }, { status: 400 });

  try {
    const data = await getSalesPayload(period.from, period.to, now);
    // Primero el registro: sin él no se entregan los datos.
    await prisma.accessLog.create({
      data: {
        userId: session.user.id,
        action: "VIEW_CALL_CENTER_SALES",
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: req.headers.get("user-agent")?.slice(0, 300) || null,
      },
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[call-center/metrics/sales]", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
