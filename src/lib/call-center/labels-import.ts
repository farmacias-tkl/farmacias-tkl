/**
 * Importación de un histórico de etiquetas de Emozion traído por API. PURO: lee el archivo y
 * decide qué cambiaría. La escritura la hace scripts/import-emozion-labels.ts.
 *
 * FORMATO del archivo: JSON Lines (una conversación por línea), con SOLO dos claves:
 *
 *   {"id":"12345","labels":["etiqueta_uno","etiqueta_dos"]}
 *
 *  - id: id de la conversación en Emozion (número o texto), el mismo de externalConversationId.
 *  - labels: lista de nombres de etiqueta. Puede estar vacía.
 *
 * Una línea con cualquier otra clave se RECHAZA entera: el archivo no debe traer teléfono,
 * nombre, mensajes ni ningún otro dato. Las etiquetas pasan por el mismo filtro que la
 * ingesta (solo letras, números, guion y guion bajo).
 */
import { normalizeLabels } from "./emozion-mappers";
import { closureLabelOf } from "./ingest";

export interface LabelsFileRow {
  externalConversationId: string;
  labels: string[];
}

export interface ParsedLabelsFile {
  rows: LabelsFileRow[];
  /** Líneas rechazadas: número de línea y motivo. Nunca el contenido. */
  rejected: Array<{ line: number; reason: string }>;
  /** Ids repetidos en el archivo: se usa la última línea de cada uno. */
  duplicatedIds: number;
}

/** Lee el archivo. PURO. */
export function parseLabelsFile(text: string): ParsedLabelsFile {
  const byId = new Map<string, LabelsFileRow>();
  const rejected: ParsedLabelsFile["rejected"] = [];
  let duplicatedIds = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { rejected.push({ line: i + 1, reason: "no es JSON" }); return; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) { rejected.push({ line: i + 1, reason: "no es un objeto" }); return; }
    const keys = Object.keys(obj);
    if (keys.some((k) => k !== "id" && k !== "labels")) { rejected.push({ line: i + 1, reason: "trae claves que no son id ni labels" }); return; }
    const { id, labels } = obj as { id?: unknown; labels?: unknown };
    const ext = typeof id === "number" && Number.isFinite(id) ? String(id) : typeof id === "string" && /^\S{1,64}$/.test(id.trim()) ? id.trim() : null;
    if (!ext) { rejected.push({ line: i + 1, reason: "id inválido" }); return; }
    if (!Array.isArray(labels)) { rejected.push({ line: i + 1, reason: "labels no es una lista" }); return; }
    if (byId.has(ext)) duplicatedIds++;
    byId.set(ext, { externalConversationId: ext, labels: normalizeLabels({ labels: labels as string[] }) });
  });
  return { rows: [...byId.values()], rejected, duplicatedIds };
}

/** Lo que hay hoy en la base para una conversación del archivo. */
export interface ExistingConversation {
  externalConversationId: string;
  resolved: boolean;
  externalLabels: readonly string[];
  closureTypeName: string | null;
}

export interface LabelsChange {
  externalConversationId: string;
  /** Etiquetas nuevas; null si no cambian. */
  labels: string[] | null;
  /**
   * Resultado de cierre a guardar en la conversación y en su última fila RESUELTA; null si no
   * corresponde. Solo se completa donde hoy no hay ninguno: nunca pisa uno existente.
   */
  closureLabel: string | null;
}

export interface LabelsPlan {
  changes: LabelsChange[];
  /** Ids del archivo que no están en la base. */
  notFound: number;
  unchanged: number;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Qué cambiaría. PURO. No toca estados ni mensajes: solo etiquetas y, en las conversaciones
 * resueltas que todavía no tienen resultado, la etiqueta de cierre.
 */
export function planLabelsImport(
  rows: readonly LabelsFileRow[],
  existing: readonly ExistingConversation[],
  closureLabels: ReadonlySet<string>,
): LabelsPlan {
  const byId = new Map(existing.map((c) => [c.externalConversationId, c]));
  const changes: LabelsChange[] = [];
  let notFound = 0;
  let unchanged = 0;
  for (const r of rows) {
    const c = byId.get(r.externalConversationId);
    if (!c) { notFound++; continue; }
    const labels = sameList(r.labels, c.externalLabels) ? null : r.labels;
    const closureLabel = c.resolved && c.closureTypeName === null ? closureLabelOf(r.labels, closureLabels, c.externalLabels) : null;
    if (labels === null && closureLabel === null) { unchanged++; continue; }
    changes.push({ externalConversationId: r.externalConversationId, labels, closureLabel });
  }
  return { changes, notFound, unchanged };
}
