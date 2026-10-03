/**
 * POST /api/sync/attachment-copy — dispara el job de copia de adjuntos a R2 (B6.3-C4).
 *
 * Auth: Authorization: Bearer <ATTACHMENT_COPY_JOB_SECRET> (secreto propio, ≥ 32 chars;
 * comparación en tiempo constante). Excluido de NextAuth por el prefijo /api/sync del middleware.
 * Body opcional: { "limit": n } (entero 1–50, default 25).
 *
 * Contrato de respuesta:
 *  - 503 { status: "unavailable" }  secreto ausente/corto (no toca la base)
 *  - 401 (sin cuerpo)                auth inválida
 *  - 400 { status: "bad_request" }   body inválido (solo con auth OK; no toca la base)
 *  - 200 { status: "maintenance_only", maintenance, healthy, durationMs }
 *        ATTACHMENT_COPY_JOB_ENABLED !== "true": solo M1–M3 (sin R2 ni copia)
 *  - 200 { status: "ok", maintenance, copy, healthy, durationMs }   mantenimiento + copia
 *  - 500 { status: "error", code }   error inesperado (código seguro, sin mensaje)
 *  `healthy` = false si el mantenimiento falló o stopReason ∈ {r2_auth, config, preflight,
 *  r2_timeout}; true en none/deadline/external. `maintenance` = null si el mantenimiento falló.
 *  Solo contadores: nunca ids, keys, URLs, hostnames ni mensajes.
 *
 * El disparador (GitHub Actions / Vercel Cron) se decide en B6.4; este endpoint no depende de él.
 * La lógica vive en lib/call-center/attachment-copy/endpoint.ts (núcleo testeable).
 */
import { NextRequest, NextResponse } from "next/server";
import { handleAttachmentCopy } from "@/lib/call-center/attachment-copy/endpoint";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const res = await handleAttachmentCopy(
    { authorization: request.headers.get("authorization"), signal: request.signal, readBody: () => request.text() },
    {
      env: process.env,
      // Lazy y separados: maintenance_only NO carga el worker (SDK de R2); 503/401/400 no cargan nada.
      runCopy: async (opts, deps) => (await import("@/lib/call-center/attachment-copy/worker")).runAttachmentCopy(opts, deps),
      runMaintenanceOnly: async () => {
        const [{ prisma }, { runMaintenanceOnly }, { createEmozionFetcher }] = await Promise.all([
          import("@/lib/prisma"),
          import("@/lib/call-center/attachment-copy/maintenance-runner"),
          import("@/lib/call-center/attachment-copy/emozion-fetcher"),
        ]);
        return runMaintenanceOnly(prisma, new Date(), [createEmozionFetcher()]);
      },
      getPrisma: async () => (await import("@/lib/prisma")).prisma,
    },
  );
  return res.body === null ? new NextResponse(null, { status: res.status }) : NextResponse.json(res.body, { status: res.status });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
