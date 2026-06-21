/**
 * Helpers de PRESENTACIÓN de adjuntos (B5). PUROS, sin DB/red/React. Solo metadata textual:
 * tipo, tamaño y clasificación. NO sirven archivos, NO URLs, NO preview/download (eso es
 * B3-B/B6, bloqueado por storage + retención). El módulo /call-center no usa emojis → el
 * render antepone el prefijo textual "Adjunto:" (ver page.tsx), no un 📎.
 */

const KB = 1024;
const MB = 1024 * 1024;

/** bytes → tamaño humano. null → "tamaño no disponible". <1MB en KB, ≥1MB en MB (1 decimal). */
export function formatAttachmentSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes)) return "tamaño no disponible";
  if (sizeBytes < MB) return `${Math.round(sizeBytes / KB)} KB`;
  return `${(sizeBytes / MB).toFixed(1)} MB`;
}

/** mediaType (file_type del fork) → etiqueta legible. null/desconocido → "Adjunto". */
export function getAttachmentMediaLabel(mediaType: string | null | undefined): string {
  const t = (mediaType ?? "").toLowerCase();
  if (t === "image") return "Imagen";
  if (t === "audio") return "Audio";
  if (t === "video") return "Video";
  if (t === "file" || t === "document" || t === "pdf" || t.startsWith("application")) return "Archivo";
  return "Adjunto";
}

/** documentType (clasificación humana, B4 futuro) → etiqueta. UNKNOWN/null → "Sin clasificar". */
export function getAttachmentDocumentTypeLabel(documentType: string | null | undefined): string {
  switch (documentType) {
    case "PRESCRIPTION": return "Receta";
    case "ARCHIVED_PRESCRIPTION": return "Receta archivada";
    case "RECEIPT": return "Comprobante";
    case "OTHER": return "Otro";
    case "UNKNOWN":
    default: return "Sin clasificar";
  }
}

/** status → etiqueta, o null si NO aporta a la UI (RECEIVED es el estado normal). */
export function getAttachmentStatusLabel(status: string | null | undefined): string | null {
  switch (status) {
    case "PENDING": return "Pendiente";
    case "FAILED": return "Error";
    case "REDACTED": return "Redactado";
    case "DELETED": return "Eliminado";
    case "RECEIVED":
    default: return null; // RECEIVED/null → no mostrar
  }
}

/**
 * Línea de metadata "·"-separada (sin el prefijo "Adjunto:", que lo pone el render):
 * "Imagen · 113 KB · Sin clasificar" (+ "· Error" si status no es RECEIVED).
 */
export function formatAttachmentMeta(att: {
  mediaType: string | null;
  sizeBytes: number | null;
  documentType: string | null;
  status: string | null;
}): string {
  const parts = [
    getAttachmentMediaLabel(att.mediaType),
    formatAttachmentSize(att.sizeBytes),
    getAttachmentDocumentTypeLabel(att.documentType),
  ];
  const st = getAttachmentStatusLabel(att.status);
  if (st) parts.push(st);
  return parts.join(" · ");
}

/**
 * Agrupa adjuntos por mensaje (B5, Ajuste 3). PURO y testeable: separa el render SSR de la
 * lógica de anclaje. Un adjunto cuyo messageId es null o NO matchea ningún mensaje del
 * timeline NO se traga en silencio → va a `orphans` (el render los muestra en un bloque
 * "Adjuntos de la conversación"). Para una receta clínica, "existe pero no se ve" es
 * inaceptable. El orden de entrada (createdAt asc) se preserva.
 */
export function groupAttachmentsByMessage<T extends { messageId: string | null }>(
  attachments: T[],
  messageIds: Set<string>,
): { byMessage: Map<string, T[]>; orphans: T[] } {
  const byMessage = new Map<string, T[]>();
  const orphans: T[] = [];
  for (const a of attachments) {
    if (a.messageId && messageIds.has(a.messageId)) {
      const arr = byMessage.get(a.messageId);
      if (arr) arr.push(a);
      else byMessage.set(a.messageId, [a]);
    } else {
      orphans.push(a);
    }
  }
  return { byMessage, orphans };
}
