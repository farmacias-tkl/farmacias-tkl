/**
 * Tests del mapper de attachments (B2.1). PUROS, sin DB/red/token.
 * Se autoejecuta con node:assert:
 *   npx tsx src/lib/call-center/emozion-attachments.test.ts
 *
 * Contrato real (captura B2.0): attachment trae id:number estable, file_type:string,
 * file_size:number; NO trae mime_type/content_type/file_name; data_url/thumb_url NO se ingieren.
 */
import assert from "node:assert/strict";
import { normalizeMessage } from "./emozion-mappers";

const ISO = "2026-06-19T10:00:00.000-03:00";
const base = { id: 100, source_id: "wamid.X", message_type: "incoming", content: "hola", created_at: ISO };
const msg = (attachments: unknown) =>
  normalizeMessage({ ...base, attachments } as unknown as Parameters<typeof normalizeMessage>[0]);

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

// 1. attachment simple → NormalizedAttachment correcto
test("1. simple: id/file_type/file_size → NormalizedAttachment + sourceExternalId", () => {
  const r = msg([{ id: 25003, file_type: "image", file_size: 1234 }]);
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.attachments.length, 1);
  assert.deepEqual(r.data?.attachments[0], {
    sourceExternalId: "emozion-attachment:25003",
    mediaType: "image",
    sizeBytes: 1234,
    mimeType: null,
    originalFileName: null,
  });
});

// 2. id === 0 es VÁLIDO (chequeo por tipo, no truthiness)
test("2. id === 0 → id válido, no ausente", () => {
  const r = msg([{ id: 0, file_type: "file" }]);
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.attachments[0].sourceExternalId, "emozion-attachment:0");
});

// 3. multi-attachment → mapea TODOS (no solo [0])
test("3. multi-attachment → emite 2 NormalizedAttachment", () => {
  const r = msg([
    { id: 1, file_type: "image", file_size: 10 },
    { id: 2, file_type: "audio", file_size: 20 },
  ]);
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.attachments.length, 2);
  assert.equal(r.data?.attachments[1].sourceExternalId, "emozion-attachment:2");
  assert.equal(r.data?.attachments[1].mediaType, "audio");
});

// 4. RED DURA: data_url/thumb_url no se filtran al output serializado
test("4. red dura: data_url/thumb_url no aparecen en el output", () => {
  const r = msg([
    { id: 9, file_type: "image", data_url: "SENTINEL_DATAURL_xyz", thumb_url: "SENTINEL_THUMB_def" },
  ]);
  const json = JSON.stringify(r.data);
  assert.ok(!json.includes("SENTINEL_DATAURL_xyz"), "no debe filtrar data_url");
  assert.ok(!json.includes("SENTINEL_THUMB_def"), "no debe filtrar thumb_url");
  assert.equal(r.data?.attachments[0].mediaType, "image"); // sí reporta el tipo
});

// 5. sourceExternalId usa el id real, nunca el índice
test("5. sourceExternalId = id real, no índice", () => {
  const r = msg([{ id: 999, file_type: "image" }, { id: 7, file_type: "file" }]);
  assert.equal(r.data?.attachments[0].sourceExternalId, "emozion-attachment:999"); // no :0
  assert.equal(r.data?.attachments[1].sourceExternalId, "emozion-attachment:7");   // no :1
});

// 6. identidad rota: sin id usable / no objeto → insufficientData, SIN fallback por índice
test("6. falta id → identidad rota (insufficientData), sin fallback por índice", () => {
  const noId = msg([{ file_type: "image" }]);
  assert.equal(noId.outcome, "insufficientData");
  assert.equal(noId.data, null);
  assert.ok(noId.warnings.some((w) => w.includes("identidad rota")));

  const emptyStrId = msg([{ id: "", file_type: "image" }]);
  assert.equal(emptyStrId.outcome, "insufficientData");

  const notObj = msg([123]);
  assert.equal(notObj.outcome, "insufficientData");

  const nullEl = msg([null]);
  assert.equal(nullEl.outcome, "insufficientData");
});

// 6b. id string con whitespace → sourceExternalId trimmeado (no keys divergentes)
test('6b. id "  88001  " → sourceExternalId trimmeado', () => {
  const r = msg([{ id: "  88001  ", file_type: "image" }]);
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.attachments[0].sourceExternalId, "emozion-attachment:88001");
});

// 6c. id = NaN → identidad rota (number no finito)
test("6c. id = NaN → identidad rota (insufficientData)", () => {
  const r = msg([{ id: NaN, file_type: "image" }]);
  assert.equal(r.outcome, "insufficientData");
  assert.equal(r.data, null);
});

// 7. id válido sin file_type → attachment válido con mediaType=null (no auto-clasificar)
test("7. id válido sin file_type → mediaType null", () => {
  const r = msg([{ id: 5 }]);
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.attachments[0].mediaType, null);
  assert.equal(r.data?.attachments[0].sourceExternalId, "emozion-attachment:5");
});

// 8. file_size no-number → sizeBytes null
test("8. file_size no-number → sizeBytes null", () => {
  const r = msg([{ id: 5, file_type: "file", file_size: "grande" }]);
  assert.equal(r.data?.attachments[0].sizeBytes, null);
});

// 9. mimeType / originalFileName SIEMPRE null
test("9. mimeType y originalFileName siempre null", () => {
  const r = msg([{ id: 5, file_type: "image", file_size: 1, mime_type: "image/png", file_name: "x.png" }]);
  assert.equal(r.data?.attachments[0].mimeType, null);
  assert.equal(r.data?.attachments[0].originalFileName, null);
});

// 10. compat: mediaType escalar del mensaje = attachments[0].mediaType; sin mediaUrl en el mapper
test("10. compat: mediaType escalar = attachments[0].mediaType; mapper no emite mediaUrl", () => {
  const r = msg([{ id: 1, file_type: "image" }, { id: 2, file_type: "audio" }]);
  assert.equal(r.data?.mediaType, "image"); // del primer adjunto
  assert.ok(!("mediaUrl" in (r.data as object))); // mediaUrl es del ingest (null), no del mapper
  const none = msg(undefined);
  assert.deepEqual(none.data?.attachments, []); // sin attachments → []
  assert.equal(none.data?.mediaType, null);
});

// 11. documentType NO aparece en la salida del mapper (se setea en ingest = UNKNOWN)
test("11. documentType no aparece en la salida del mapper", () => {
  const r = msg([{ id: 1, file_type: "image" }]);
  const json = JSON.stringify(r.data);
  assert.ok(!json.includes("documentType"));
  assert.ok(!("documentType" in (r.data?.attachments[0] as object)));
});

// 12. attachments ausente o no-array → attachments: []
test("12. attachments ausente / no-array → []", () => {
  assert.deepEqual(msg(undefined).data?.attachments, []);
  assert.deepEqual(msg(null).data?.attachments, []);
  assert.deepEqual(msg("nope").data?.attachments, []);
  assert.deepEqual(msg([]).data?.attachments, []);
});

console.log(`\nemozion-attachments: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
