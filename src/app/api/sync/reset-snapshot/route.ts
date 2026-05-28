/**
 * POST /api/sync/reset-snapshot
 *
 * Borra todas las filas de SalesSnapshot para una fecha específica para forzar
 * el reprocesamiento. Llamado por scripts/server/reset_snapshot.py vía
 * curl.exe + Bearer SYNC_WEBHOOK_SECRET (mismo patrón que /api/sync/trigger).
 *
 * Body:
 *   {
 *     "date":    "YYYY-MM-DD",
 *     "dryRun"?: boolean        // default false. true → solo COUNT, no borra.
 *   }
 *
 * Respuestas:
 *   dryRun=true  → { ok: true, dryRun: true, count:   N, date }
 *   dryRun=false → { ok: true, dryRun: false, deleted: N, date }
 *   error        → { error, ... } con status 400/401/500
 *
 * Audita en SyncLog cuando borra (no en dryRun).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseArtDate, isFutureArtDate } from "@/lib/dates/executive";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // --- Auth ---
  const authHeader = request.headers.get("authorization");
  const syncSecret = process.env.SYNC_WEBHOOK_SECRET;
  if (!syncSecret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (!authHeader || authHeader !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Body ---
  const body = await request.json().catch(() => ({}));
  const dateStr = typeof body?.date === "string" ? body.date : "";
  const dryRun  = body?.dryRun === true;

  const parsed = parseArtDate(dateStr);
  if (!parsed) {
    return NextResponse.json(
      { error: "Formato de fecha inválido. Esperado YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (isFutureArtDate(parsed)) {
    return NextResponse.json(
      { error: "La fecha no puede ser futura." },
      { status: 400 },
    );
  }

  // --- Operación ---
  try {
    if (dryRun) {
      const count = await prisma.salesSnapshot.count({
        where: { snapshotDate: parsed },
      });
      return NextResponse.json({
        ok:     true,
        dryRun: true,
        count,
        date:   dateStr,
      });
    }

    const startMs = Date.now();
    const result  = await prisma.salesSnapshot.deleteMany({
      where: { snapshotDate: parsed },
    });
    const durationMs = Date.now() - startMs;

    // Audit en SyncLog. Source SALES_API porque afecta SalesSnapshot;
    // triggeredBy MANUAL porque es una acción humana (no cron).
    await prisma.syncLog.create({
      data: {
        source:        "SALES_API",
        status:        "SUCCESS",
        message:       `RESET: borradas ${result.count} filas de SalesSnapshot para ${dateStr} (acción manual)`,
        rowsProcessed: result.count,
        durationMs,
        syncDate:      parsed,
        triggeredBy:   "MANUAL",
      },
    }).catch((e) => {
      // No abortamos si falla el log de auditoría — la operación principal
      // ya se hizo. Solo dejamos rastro en los logs de Vercel.
      console.error("[reset-snapshot] No se pudo escribir SyncLog:", e);
    });

    return NextResponse.json({
      ok:      true,
      dryRun:  false,
      deleted: result.count,
      date:    dateStr,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reset-snapshot] Error:", msg);
    return NextResponse.json(
      { error: "Error al ejecutar operación", detail: msg },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
