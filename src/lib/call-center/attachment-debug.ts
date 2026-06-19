/**
 * B2.0 — Captura PII-safe de la ESTRUCTURA de attachments de Emozion.
 *
 * PROPÓSITO: registrar la FORMA del objeto adjunto (nombres de keys, tipos, flags de
 * presencia, candidatos a id por NOMBRE de key) para poder diseñar B2.1 (mapper) sobre la
 * forma REAL del fork, no sobre una supuesta. No conocemos la forma → todo es defensivo.
 *
 * INVARIANTE DURO: en NINGÚN punto se serializa un VALUE del adjunto. Solo se emiten:
 *  - nombres de keys (Object.keys),
 *  - resultados de typeof (categoría: "string"/"number"/"array"/"object"/"null"/...),
 *  - booleanos de presencia y counts.
 * Nunca se lee `attachments[0][k]` hacia el output salvo a través de typeOf(value), que
 * devuelve la categoría, jamás el valor. Así no pueden filtrarse data_url/thumb_url/
 * file_name/source_url ni ningún contenido sensible.
 *
 * ACCESORIO: esta función NUNCA lanza (try/catch interno → { attachmentCaptureError: true }).
 * Su falla no debe afectar el WebhookEvent de dominio (el caller la usa fuera de la tx).
 *
 * PURO: sin imports de Prisma/Next/red — testeable de forma aislada.
 */

/** keys que parecen id técnico — SOLO por nombre, nunca por valor. */
const ID_KEY_RE = /(^|_)id$/i;
const ID_KEY_NAME_RE = /(attachment|blob|file|asset|media)_?id/i;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** nombres de keys de un objeto plano no-null (no array). [] si no es objeto. */
function keysOfObj(o: unknown): string[] {
  return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as object) : [];
}

/** { key: typeof(value) } — value SOLO como categoría, nunca el valor en sí. */
function shapeOf(o: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keysOfObj(o)) out[k] = typeOf((o as Record<string, unknown>)[k]);
  return out;
}

function idCandidates(keys: string[]): string[] {
  return keys.filter((k) => ID_KEY_RE.test(k) || ID_KEY_NAME_RE.test(k));
}

/** ¿alguna de `names` (lowercase) está presente como key? */
function hasKey(keys: string[], names: string[]): boolean {
  const lower = keys.map((k) => k.toLowerCase());
  return names.some((n) => lower.includes(n));
}

/**
 * Estructura PII-safe de `attachments` (el array crudo del message_created).
 * Defensivo ante forma desconocida: si no es array, o [0] no es objeto, lo reporta como
 * dato (attachmentsType / attachmentFirstType) y sigue, sin asumir forma.
 */
export function buildAttachmentCapture(attachments: unknown): unknown {
  try {
    const out: Record<string, unknown> = { attachmentsType: typeOf(attachments) };

    if (!Array.isArray(attachments)) return out; // null / undefined / string / object / number
    out.attachmentCount = attachments.length;
    if (attachments.length === 0) return out;

    const first = attachments[0];
    out.attachmentFirstType = typeOf(first);
    const firstKeys = keysOfObj(first);
    if (firstKeys.length === 0) return out; // [null], [123], [""]: degradado pero válido, sin keys

    out.attachmentKeys = firstKeys;
    out.attachmentShape = shapeOf(first);
    out.attachmentIdKeyCandidates = idCandidates(firstKeys);
    out.attachmentKeyFlags = {
      hasId: hasKey(firstKeys, ["id"]),
      hasFileType: hasKey(firstKeys, ["file_type", "filetype"]),
      hasFileName: hasKey(firstKeys, ["file_name", "filename"]),
      hasFileSize: hasKey(firstKeys, ["file_size", "filesize", "size"]),
      hasContentType: hasKey(firstKeys, ["content_type", "contenttype"]),
      hasMimeType: hasKey(firstKeys, ["mime_type", "mimetype", "mime"]),
      hasDataUrl: hasKey(firstKeys, ["data_url", "dataurl"]),
      hasThumbUrl: hasKey(firstKeys, ["thumb_url", "thumburl"]),
      hasSourceUrl: hasKey(firstKeys, ["source_url", "sourceurl"]),
    };

    if (attachments.length > 1) {
      // perIndex: solo los primeros 3, solo nombres+tipos (nunca valores).
      const perIndex = attachments.slice(0, 3).map((a, i) => ({
        index: i,
        type: typeOf(a),
        keys: keysOfObj(a),
        shape: shapeOf(a),
      }));
      // sameKeysAcrossAll sobre TODOS los elementos (no solo los 3 muestreados).
      const keySets = attachments.map((a) => keysOfObj(a).slice().sort().join(","));
      const sameKeysAcrossAll = new Set(keySets).size === 1;
      out.multiAttachmentShape = { count: attachments.length, sameKeysAcrossAll, perIndex };
    }

    return out;
  } catch {
    return { attachmentCaptureError: true };
  }
}
