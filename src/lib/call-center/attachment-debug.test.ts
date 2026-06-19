/**
 * Tests de buildAttachmentCapture (B2.0). PUROS, sin DB/red/token.
 * El repo no tiene runner; se autoejecuta con node:assert:
 *   npx tsx src/lib/call-center/attachment-debug.test.ts
 *
 * Foco: (a) estructura presente, (b) AUSENCIA DURA de valores (sentinelas), (c) robustez
 * ante forma desconocida sin lanzar excepción. La premisa es que NO conocemos la forma del
 * adjunto del fork; estos tests usan formas SINTÉTICAS solo para validar el sanitizador,
 * NO para afirmar la forma real (eso lo dará la captura controlada en prod).
 */
import assert from "node:assert/strict";
import { buildAttachmentCapture } from "./attachment-debug";

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

// 1. estructura presente: keys / tipos / flags / candidatos a id
test("1. estructura: keys, shape, flags, idCandidates", () => {
  const out = buildAttachmentCapture([
    { id: 99, file_type: "image", data_url: "u", thumb_url: "t", file_name: "f", file_size: 123, content_type: "image/jpeg" },
  ]) as any;
  assert.equal(out.attachmentsType, "array");
  assert.equal(out.attachmentCount, 1);
  assert.deepEqual(
    [...out.attachmentKeys].sort(),
    ["content_type", "data_url", "file_name", "file_size", "file_type", "id", "thumb_url"],
  );
  assert.equal(out.attachmentShape.id, "number");
  assert.equal(out.attachmentShape.file_type, "string");
  assert.equal(out.attachmentShape.file_size, "number");
  assert.equal(out.attachmentShape.data_url, "string");
  assert.equal(out.attachmentKeyFlags.hasId, true);
  assert.equal(out.attachmentKeyFlags.hasFileType, true);
  assert.equal(out.attachmentKeyFlags.hasFileName, true);
  assert.equal(out.attachmentKeyFlags.hasFileSize, true);
  assert.equal(out.attachmentKeyFlags.hasContentType, true);
  assert.equal(out.attachmentKeyFlags.hasMimeType, false);
  assert.equal(out.attachmentKeyFlags.hasDataUrl, true);
  assert.equal(out.attachmentKeyFlags.hasThumbUrl, true);
  assert.ok(out.attachmentIdKeyCandidates.includes("id"));
});

// 1b. candidatos a id por nombre alternativo (solo nombres)
test("1b. idCandidates capta blob_id / attachment_id por NOMBRE", () => {
  const out = buildAttachmentCapture([{ blob_id: 1, attachment_id: 2, file_type: "file" }]) as any;
  assert.deepEqual([...out.attachmentIdKeyCandidates].sort(), ["attachment_id", "blob_id"]);
});

// 2. AUSENCIA DURA de valores: sentinelas NO aparecen en el JSON del output
test("2. red dura: valores sentinela no se filtran al output", () => {
  const out = buildAttachmentCapture([
    {
      id: 7,
      file_type: "image",
      data_url: "SENTINEL_DATAURL_xyz",
      thumb_url: "SENTINEL_THUMB_def",
      file_name: "SENTINEL_FILENAME_abc",
      source_url: "SENTINEL_SRC_q",
    },
  ]) as any;
  const json = JSON.stringify(out);
  for (const s of ["SENTINEL_DATAURL_xyz", "SENTINEL_THUMB_def", "SENTINEL_FILENAME_abc", "SENTINEL_SRC_q"]) {
    assert.ok(!json.includes(s), `no debe filtrar el valor ${s}`);
  }
  // pero SÍ reporta presencia de las keys (solo presencia, no valor)
  assert.equal(out.attachmentKeyFlags.hasDataUrl, true);
  assert.equal(out.attachmentKeyFlags.hasThumbUrl, true);
  assert.equal(out.attachmentKeyFlags.hasFileName, true);
  assert.equal(out.attachmentKeyFlags.hasSourceUrl, true);
});

// 2b. tampoco se filtra el VALOR de id (solo nombre + tipo)
test("2b. el valor de id no se filtra (solo nombre/tipo)", () => {
  const out = buildAttachmentCapture([{ id: "SENTINEL_IDVAL_123", file_type: "file" }]) as any;
  const json = JSON.stringify(out);
  assert.ok(!json.includes("SENTINEL_IDVAL_123"), "no debe filtrar el valor de id");
  assert.equal(out.attachmentShape.id, "string");
  assert.ok(out.attachmentIdKeyCandidates.includes("id"));
});

// 3. robustez ante malformados: sin excepción, capture degradado válido
test("3. malformados no lanzan y degradan", () => {
  assert.equal((buildAttachmentCapture(null) as any).attachmentsType, "null");
  assert.equal((buildAttachmentCapture(undefined) as any).attachmentsType, "undefined");
  assert.equal((buildAttachmentCapture("stringz") as any).attachmentsType, "string");
  assert.equal((buildAttachmentCapture(123) as any).attachmentsType, "number");
  assert.equal((buildAttachmentCapture({}) as any).attachmentsType, "object");

  const empty = buildAttachmentCapture([]) as any;
  assert.equal(empty.attachmentsType, "array");
  assert.equal(empty.attachmentCount, 0);
  assert.equal(empty.attachmentKeys, undefined);

  const an = buildAttachmentCapture([null]) as any;
  assert.equal(an.attachmentCount, 1);
  assert.equal(an.attachmentFirstType, "null");
  assert.equal(an.attachmentKeys, undefined);

  const num = buildAttachmentCapture([123]) as any;
  assert.equal(num.attachmentFirstType, "number");
  assert.equal(num.attachmentKeys, undefined);

  // ninguno debe haber lanzado: si llegamos acá, pasó
  assert.ok(true);
});

// 4. multi-adjunto: count, sameKeysAcrossAll, perIndex limitado a 3
test("4. multi-adjunto: count + sameKeysAcrossAll + perIndex<=3", () => {
  const same = buildAttachmentCapture([
    { id: 1, file_type: "image" },
    { id: 2, file_type: "file" },
    { id: 3, file_type: "audio" },
    { id: 4, file_type: "image" },
  ]) as any;
  assert.equal(same.multiAttachmentShape.count, 4);
  assert.equal(same.multiAttachmentShape.sameKeysAcrossAll, true);
  assert.equal(same.multiAttachmentShape.perIndex.length, 3);
  assert.deepEqual([...same.multiAttachmentShape.perIndex[0].keys].sort(), ["file_type", "id"]);

  const diff = buildAttachmentCapture([
    { id: 1, file_type: "image" },
    { id: 2, extra: "v" },
  ]) as any;
  assert.equal(diff.multiAttachmentShape.sameKeysAcrossAll, false);

  // single attachment → no multiAttachmentShape
  const single = buildAttachmentCapture([{ id: 1, file_type: "image" }]) as any;
  assert.equal(single.multiAttachmentShape, undefined);
});

// 4b. multi con sentinelas: tampoco se filtran desde perIndex/shape
test("4b. perIndex no filtra valores", () => {
  const out = buildAttachmentCapture([
    { id: 1, data_url: "SENTINEL_MULTI_1" },
    { id: 2, data_url: "SENTINEL_MULTI_2" },
  ]) as any;
  const json = JSON.stringify(out);
  assert.ok(!json.includes("SENTINEL_MULTI_1"));
  assert.ok(!json.includes("SENTINEL_MULTI_2"));
  assert.equal(out.multiAttachmentShape.perIndex[0].shape.data_url, "string");
});

// 5. KEY ARBITRARIA NO ANTICIPADA: la premisa es que NO sabemos las keys del fork.
//    El valor de una key desconocida tampoco debe filtrarse; su NOMBRE+tipo sí se reportan.
test("5. campo desconocido: valor no se filtra; nombre/tipo sí se reportan", () => {
  const out = buildAttachmentCapture([
    { id: 1, file_type: "image", unexpected_field: "SENTINEL_UNKNOWN_xyz", weird_blob: { nested: "SENTINEL_NESTED_q" } },
  ]) as any;
  const json = JSON.stringify(out);
  assert.ok(!json.includes("SENTINEL_UNKNOWN_xyz"), "no debe filtrar el valor de una key desconocida");
  assert.ok(!json.includes("SENTINEL_NESTED_q"), "no debe filtrar valores anidados de una key desconocida");
  // el NOMBRE de la key desconocida SÍ se reporta (estructura), con su tipo
  assert.ok(out.attachmentKeys.includes("unexpected_field"));
  assert.equal(out.attachmentShape.unexpected_field, "string");
  assert.equal(out.attachmentShape.weird_blob, "object");
});

console.log(`\nattachment-debug: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
