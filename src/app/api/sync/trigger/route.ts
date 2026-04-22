import { NextRequest, NextResponse } from "next/server";
import { syncBalances } from "@/lib/sync/sync-balances";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const syncSecret = process.env.SYNC_WEBHOOK_SECRET;
  if (!syncSecret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  if (!authHeader || authHeader !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const source: string = body?.source ?? "balances";

  try {
    if (source === "balances" || source === "all") {
      const result = await syncBalances();
      return NextResponse.json({
        ok: true,
        source: "balances",
        status: result.status,
        message: result.message,
        rowsProcessed: result.rowsProcessed,
        rowsSkipped: result.rowsSkipped,
        warnings: result.warnings,
        durationMs: result.durationMs,
        isStale: result.isStale,
      }, { status: 200 });
    }
    return NextResponse.json({ error: "Unknown source" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync/trigger] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
