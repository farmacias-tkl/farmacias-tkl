/**
 * POST /api/sync/attachment-copy — dispara el job de copia de adjuntos a R2 (B6.3-C4).
 *
 * Auth: Authorization: Bearer <ATTACHMENT_COPY_JOB_SECRET> (secreto propio, ≥ 32 chars;
 * comparación en tiempo constante). Excluido de NextAuth por el prefijo /api/sync del middleware.
 * Ausente/corto → 503; header inválido → 401 sin cuerpo; ATTACHMENT_COPY_JOB_ENABLED !== "true"
 * → 200 { status: "disabled" } sin tocar la base.
 *
 * Corre mantenimiento (M1–M3) + copia con deadline interno de 40 s y la señal del request.
 * Respuesta: solo contadores agregados (sin ids/keys/URLs/hostnames/mensajes).
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
    { authorization: request.headers.get("authorization"), signal: request.signal },
    {
      env: process.env,
      // Lazy: los caminos 503/401/disabled no cargan el worker (SDK de R2) ni Prisma.
      runCopy: async (opts, deps) => (await import("@/lib/call-center/attachment-copy/worker")).runAttachmentCopy(opts, deps),
      getPrisma: async () => (await import("@/lib/prisma")).prisma,
    },
  );
  return res.body === null ? new NextResponse(null, { status: res.status }) : NextResponse.json(res.body, { status: res.status });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
