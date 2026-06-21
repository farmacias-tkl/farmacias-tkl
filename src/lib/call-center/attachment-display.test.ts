/**
 * Tests de los helpers de presentación de adjuntos (B5). PUROS, sin DB/red.
 *   npx tsx src/lib/call-center/attachment-display.test.ts
 */
import assert from "node:assert/strict";
import {
  formatAttachmentSize,
  getAttachmentMediaLabel,
  getAttachmentDocumentTypeLabel,
  getAttachmentStatusLabel,
  formatAttachmentMeta,
  groupAttachmentsByMessage,
} from "./attachment-display";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// 1. formatAttachmentSize
test("1. size: null/no-finito → 'tamaño no disponible'; bytes→KB; ≥1MB→MB", () => {
  assert.equal(formatAttachmentSize(null), "tamaño no disponible");
  assert.equal(formatAttachmentSize(undefined), "tamaño no disponible");
  assert.equal(formatAttachmentSize(NaN), "tamaño no disponible");
  assert.equal(formatAttachmentSize(115669), "113 KB"); // 112.95 → 113
  assert.equal(formatAttachmentSize(1024), "1 KB");
  assert.equal(formatAttachmentSize(0), "0 KB");
  assert.equal(formatAttachmentSize(1048576), "1.0 MB"); // exacto 1MB
  assert.equal(formatAttachmentSize(1468006), "1.4 MB"); // ~1.4MB
});

// 2. getAttachmentMediaLabel
test("2. mediaType: image/audio/video/file/application*/null/desconocido", () => {
  assert.equal(getAttachmentMediaLabel("image"), "Imagen");
  assert.equal(getAttachmentMediaLabel("audio"), "Audio");
  assert.equal(getAttachmentMediaLabel("video"), "Video");
  assert.equal(getAttachmentMediaLabel("file"), "Archivo");
  assert.equal(getAttachmentMediaLabel("document"), "Archivo");
  assert.equal(getAttachmentMediaLabel("pdf"), "Archivo");
  assert.equal(getAttachmentMediaLabel("application/pdf"), "Archivo");
  assert.equal(getAttachmentMediaLabel("IMAGE"), "Imagen"); // case-insensitive
  assert.equal(getAttachmentMediaLabel(null), "Adjunto");
  assert.equal(getAttachmentMediaLabel("quien_sabe"), "Adjunto");
});

// 3. getAttachmentDocumentTypeLabel (todos los enums + null)
test("3. documentType: UNKNOWN/null → 'Sin clasificar'; resto a su etiqueta", () => {
  assert.equal(getAttachmentDocumentTypeLabel("UNKNOWN"), "Sin clasificar");
  assert.equal(getAttachmentDocumentTypeLabel(null), "Sin clasificar");
  assert.equal(getAttachmentDocumentTypeLabel("PRESCRIPTION"), "Receta");
  assert.equal(getAttachmentDocumentTypeLabel("ARCHIVED_PRESCRIPTION"), "Receta archivada");
  assert.equal(getAttachmentDocumentTypeLabel("RECEIPT"), "Comprobante");
  assert.equal(getAttachmentDocumentTypeLabel("OTHER"), "Otro");
});

// 4. getAttachmentStatusLabel (RECEIVED/null no muestra; no-RECEIVED sí)
test("4. status: RECEIVED/null → null; otros → etiqueta", () => {
  assert.equal(getAttachmentStatusLabel("RECEIVED"), null);
  assert.equal(getAttachmentStatusLabel(null), null);
  assert.equal(getAttachmentStatusLabel("PENDING"), "Pendiente");
  assert.equal(getAttachmentStatusLabel("FAILED"), "Error");
  assert.equal(getAttachmentStatusLabel("REDACTED"), "Redactado");
  assert.equal(getAttachmentStatusLabel("DELETED"), "Eliminado");
});

// 5. formatAttachmentMeta (composición; status RECEIVED no agrega; no-RECEIVED sí)
test("5. meta line: tipo · tamaño · clasificación (+ estado si no RECEIVED)", () => {
  assert.equal(
    formatAttachmentMeta({ mediaType: "image", sizeBytes: 115669, documentType: "UNKNOWN", status: "RECEIVED" }),
    "Imagen · 113 KB · Sin clasificar",
  );
  assert.equal(
    formatAttachmentMeta({ mediaType: "file", sizeBytes: null, documentType: "RECEIPT", status: "FAILED" }),
    "Archivo · tamaño no disponible · Comprobante · Error",
  );
});

// 6. AJUSTE 3 — groupAttachmentsByMessage: huérfano NO desaparece
test("6. agrupar: anclados por messageId; null/no-match → orphans (no se traga)", () => {
  const atts = [
    { id: "a1", messageId: "m1" },
    { id: "a2", messageId: "m1" },
    { id: "a3", messageId: null },        // sin mensaje (SetNull) → orphan
    { id: "a4", messageId: "m_borrado" }, // messageId que no matchea ningún mensaje → orphan
    { id: "a5", messageId: "m2" },
  ];
  const messageIds = new Set(["m1", "m2"]);
  const { byMessage, orphans } = groupAttachmentsByMessage(atts, messageIds);

  assert.equal(byMessage.get("m1")?.length, 2);
  assert.deepEqual(byMessage.get("m1")?.map((a) => a.id), ["a1", "a2"]); // orden preservado
  assert.equal(byMessage.get("m2")?.length, 1);
  assert.deepEqual(orphans.map((a) => a.id), ["a3", "a4"]); // ninguno omitido
  // invariante: total agrupado + orphans == total entrada (nada se pierde)
  const grouped = [...byMessage.values()].reduce((n, arr) => n + arr.length, 0);
  assert.equal(grouped + orphans.length, atts.length);
});

// 7. agrupar: mensaje sin adjuntos → no aparece en el map (render usa ?? [])
test("7. agrupar: sin adjuntos para un mensaje → map sin esa key", () => {
  const { byMessage, orphans } = groupAttachmentsByMessage([], new Set(["m1"]));
  assert.equal(byMessage.get("m1"), undefined);
  assert.deepEqual(orphans, []);
});

console.log(`\nattachment-display: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
