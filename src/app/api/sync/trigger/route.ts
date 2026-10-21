import { NextRequest, NextResponse } from "next/server";
import { syncBalances } from "@/lib/sync/sync-balances";
import { syncSales } from "@/lib/sync/sync-sales";
import { syncCoseguros } from "@/lib/sync/sync-coseguros";

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

  const valid = ["balances", "sales", "all", "coseguros"];
  if (!valid.includes(source)) {
    return NextResponse.json({ error: "Unknown source", valid }, { status: 400 });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  if (source === "balances" || source === "all") {
    try {
      results.balances = await syncBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`balances: ${msg}`);
      results.balances = { status: "ERROR", message: msg };
    }
  }

  if (source === "sales" || source === "all") {
    try {
      results.sales = await syncSales();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`sales: ${msg}`);
      results.sales = { status: "ERROR", message: msg };
    }
  }

  // Coseguros: SOLO con su propia llamada ("all" no la incluye). Apagada salvo
  // COSEGUROS_SYNC_ENABLED="true"; termina dentro de COSEGUROS_DEADLINE_MS y deja
  // su SyncLog (SALES_COSEGUROS). Ver src/lib/sync/sync-coseguros.ts.
  if (source === "coseguros") {
    try {
      const r = await syncCoseguros();
      if (r?.status === "ERROR") errors.push(`coseguros: ${r.message}`);
      results.coseguros = r ??
        { status: "DISABLED", message: 'COSEGUROS_SYNC_ENABLED no es "true": no se hizo nada' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`coseguros: ${msg}`);
      results.coseguros = { status: "ERROR", message: msg };
    }
  }

  // 500 solo si TODAS las fuentes ejecutadas fallaron
  const sourcesRun = Object.keys(results);
  const allFailed  = sourcesRun.length > 0 &&
    sourcesRun.every((k) => (results[k] as { status?: string }).status === "ERROR");

  if (allFailed) {
    console.error("[sync/trigger] Todas las fuentes fallaron:", errors);
    return NextResponse.json({ ok: false, source, results, errors }, { status: 500 });
  }

  return NextResponse.json({ ok: true, source, results }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
