/**
 * GET /api/call-center/conversations/[id]/attachments  — metadata-only (B3-A).
 *
 * Lista la metadata de los adjuntos de una conversación. NO sirve archivos, NO URLs, NO
 * bytes, NO preview/download (ver/descargar la receta es B3-B/B6, bloqueado por la decisión
 * de storage privado + retención). NO audita: listar metadata no es acceso a contenido
 * clínico; el audit granular se reserva para B4 (preview/download/clasificación).
 *
 * Gate: canViewCallCenter (lectura). Defensa en profundidad además del middleware. La lógica
 * vive en lib/call-center/attachments-read.ts (núcleo testeable); este handler es un wrapper.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildAttachmentsResponse } from "@/lib/call-center/attachments-read";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const { status, body } = await buildAttachmentsResponse(session?.user, params.id);
  return NextResponse.json(body, { status });
}
