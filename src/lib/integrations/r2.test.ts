/**
 * Tests del adapter R2 (B6.2). PUROS, sin credenciales ni bucket real: inyección de un stub
 * `R2SendClient`. NO leen env real (salvo el test de CONFIG_MISSING, que limpia/restaura env).
 *   npx tsx src/lib/integrations/r2.test.ts
 */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  putObject,
  headObject,
  deleteObject,
  getR2Config,
  R2StorageError,
  type R2SendClient,
} from "./r2";

// Checksums: contrato interno = HEX lowercase de 64; al borde S3 va en base64. Derivamos los
// pares hex↔base64 con Buffer para que los asserts queden consistentes con el adapter.
const HEX_IN = "a".repeat(64);                                   // checksum del input (hex válido)
const HEX_IN_B64 = Buffer.from(HEX_IN, "hex").toString("base64"); // lo que debe ir al comando
const HEX_R2 = "b".repeat(64);                                   // checksum que "devuelve" R2 (en hex)
const HEX_R2_B64 = Buffer.from(HEX_R2, "hex").toString("base64"); // forma base64 que entrega R2

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); });
}

/** Stub que captura el último comando enviado y devuelve una respuesta programable. */
function makeStub(reply: any = {}): R2SendClient & { lastInput: any; lastCommand: string } {
  const stub: any = {
    lastInput: null,
    lastCommand: "",
    async send(command: any) {
      stub.lastCommand = command?.constructor?.name ?? "";
      stub.lastInput = command?.input ?? null;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return stub;
}
/** Stub que SIEMPRE lanza el error dado. */
function makeThrowingStub(err: any): R2SendClient {
  return { async send() { throw err; } };
}

async function main() {
  // 1. CONFIG_MISSING al pedir config sin envs
  await test("1. getR2Config sin envs → R2StorageError CONFIG_MISSING", () => {
    const saved = { a: process.env.R2_ACCOUNT_ID, k: process.env.R2_ACCESS_KEY_ID, s: process.env.R2_SECRET_ACCESS_KEY, b: process.env.R2_BUCKET };
    delete process.env.R2_ACCOUNT_ID; delete process.env.R2_ACCESS_KEY_ID; delete process.env.R2_SECRET_ACCESS_KEY; delete process.env.R2_BUCKET;
    try {
      assert.throws(() => getR2Config(), (e: unknown) => e instanceof R2StorageError && e.code === "CONFIG_MISSING");
    } finally {
      if (saved.a) process.env.R2_ACCOUNT_ID = saved.a; if (saved.k) process.env.R2_ACCESS_KEY_ID = saved.k;
      if (saved.s) process.env.R2_SECRET_ACCESS_KEY = saved.s; if (saved.b) process.env.R2_BUCKET = saved.b;
    }
  });

  // 1b. getR2Config con envs → deriva endpoint y region default
  await test("1b. getR2Config con envs → endpoint derivado + region 'auto' + forcePathStyle implícito", () => {
    const saved = { ...process.env };
    process.env.R2_ACCOUNT_ID = "acc123"; process.env.R2_ACCESS_KEY_ID = "ak"; process.env.R2_SECRET_ACCESS_KEY = "sk"; process.env.R2_BUCKET = "buck";
    delete process.env.R2_ENDPOINT; delete process.env.R2_REGION;
    try {
      const cfg = getR2Config();
      assert.equal(cfg.endpoint, "https://acc123.r2.cloudflarestorage.com");
      assert.equal(cfg.region, "auto");
      assert.equal(cfg.bucket, "buck");
    } finally {
      for (const k of ["R2_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET"]) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });

  // 2. putObject manda bucket/key/contentType/contentLength/body al comando
  await test("2. putObject envía Bucket/Key/ContentType/ContentLength/Body", async () => {
    const stub = makeStub({ ETag: '"abc"' });
    const body = Buffer.from("hola");
    await putObject(stub, "mybucket", { key: "cc/att/1", body, contentType: "image/jpeg", contentLength: 4 });
    assert.equal(stub.lastCommand, "PutObjectCommand");
    assert.equal(stub.lastInput.Bucket, "mybucket");
    assert.equal(stub.lastInput.Key, "cc/att/1");
    assert.equal(stub.lastInput.ContentType, "image/jpeg");
    assert.equal(stub.lastInput.ContentLength, 4);
    assert.equal(stub.lastInput.Body, body);
    assert.equal(stub.lastInput.ChecksumSHA256, undefined); // sin checksum no se manda
  });

  // 3. putObject con checksum hex → manda ChecksumSHA256 en BASE64 al comando
  await test("3. putObject con checksum hex → ChecksumSHA256 base64 en el comando", async () => {
    const stub = makeStub({});
    await putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "application/pdf", contentLength: 1, checksumSha256: HEX_IN });
    assert.equal(stub.lastInput.ChecksumSHA256, HEX_IN_B64); // convertido hex→base64
    assert.notEqual(stub.lastInput.ChecksumSHA256, HEX_IN);  // NO va el hex crudo
  });

  // 3b. putObject con checksum inválido (no-hex / longitud ≠ 64) → error claro, sin enviar nada
  await test("3b. putObject checksum inválido → R2StorageError 'invalid checksum input'", async () => {
    const stub = makeStub({});
    await assert.rejects(
      () => putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1, checksumSha256: "NOPE" }),
      (e: unknown) => e instanceof R2StorageError && e.code === "PERMANENT" && /invalid checksum input/.test(e.message),
    );
    // longitud correcta pero con char no-hex
    await assert.rejects(
      () => putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1, checksumSha256: "g".repeat(64) }),
      (e: unknown) => e instanceof R2StorageError && e.code === "PERMANENT",
    );
    assert.equal(stub.lastCommand, "", "no debe haber enviado nada al cliente");
  });

  // 3c. putObject SIN checksum → el comando NO lleva ChecksumSHA256 ni ningún campo Checksum*
  //     (no metemos checksum de más a nivel de comando; el automático del SDK se apaga con
  //     WHEN_REQUIRED en el cliente real, pero eso es middleware, no visible al stub — ver nota).
  await test("3c. putObject sin checksum → comando sin ningún campo Checksum*", async () => {
    const stub = makeStub({ ETag: '"e"' });
    await putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1 });
    const checksumKeys = Object.keys(stub.lastInput).filter((k) => /checksum/i.test(k));
    assert.deepEqual(checksumKeys, [], `no debe haber campos Checksum* en el comando; encontrados: ${checksumKeys.join(",")}`);
  });

  // 4. putObject devuelve provider/bucket/key/contentType/sizeBytes/checksum(hex)/etag/uploadedAt
  await test("4. putObject result completo (checksum de R2 base64→hex prevalece, etag transportado)", async () => {
    const stub = makeStub({ ETag: '"e1"', ChecksumSHA256: HEX_R2_B64 });
    const r = await putObject(stub, "b", { key: "k", body: Buffer.from("xy"), contentType: "image/png", contentLength: 2, checksumSha256: HEX_IN });
    assert.equal(r.provider, "R2");
    assert.equal(r.bucket, "b");
    assert.equal(r.key, "k");
    assert.equal(r.contentType, "image/png");
    assert.equal(r.sizeBytes, 2);
    assert.equal(r.checksumSha256, HEX_R2); // el de R2 (base64→hex) prevalece sobre el input
    assert.equal(r.etag, '"e1"');
    assert.ok(r.uploadedAt instanceof Date);
  });

  // 4b. putObject sin checksum de R2 → cae al del input (ya hex)
  await test("4b. putObject sin ChecksumSHA256 de R2 → usa el del input (hex)", async () => {
    const stub = makeStub({ ETag: '"e"' });
    const r = await putObject(stub, "b", { key: "k", body: Buffer.from("z"), contentType: "x", contentLength: 1, checksumSha256: HEX_IN });
    assert.equal(r.checksumSha256, HEX_IN);
  });

  // 5. putObject con Readable SIN contentLength → error claro, sin tocar el cliente
  await test("5. putObject Readable sin contentLength → R2StorageError claro", async () => {
    const stub = makeStub({});
    const stream = Readable.from([Buffer.from("data")]);
    await assert.rejects(
      () => putObject(stub, "b", { key: "k", body: stream, contentType: "x" }),
      (e: unknown) => e instanceof R2StorageError && /contentLength/.test(e.message),
    );
    assert.equal(stub.lastCommand, "", "no debe haber enviado nada al cliente");
  });

  // 5b. putObject con Readable + contentLength → OK
  await test("5b. putObject Readable con contentLength → envía PutObjectCommand", async () => {
    const stub = makeStub({});
    const stream = Readable.from([Buffer.from("data")]);
    await putObject(stub, "b", { key: "k", body: stream, contentType: "x", contentLength: 4 });
    assert.equal(stub.lastCommand, "PutObjectCommand");
    assert.equal(stub.lastInput.ContentLength, 4);
  });

  // 6. headObject mapea ContentType/ContentLength/ETag/LastModified/Metadata/ChecksumSHA256
  await test("6. headObject mapea metadata", async () => {
    const lm = new Date("2026-06-22T10:00:00Z");
    const stub = makeStub({ ContentType: "image/jpeg", ContentLength: 12345, ETag: '"h"', LastModified: lm, Metadata: { attachmentid: "1" }, ChecksumSHA256: HEX_R2_B64 });
    const r = await headObject(stub, "b", "k");
    assert.equal(r.exists, true);
    assert.equal(r.contentType, "image/jpeg");
    assert.equal(r.sizeBytes, 12345);
    assert.equal(r.etag, '"h"');
    assert.equal(r.lastModified, lm);
    assert.deepEqual(r.metadata, { attachmentid: "1" });
    assert.equal(r.checksumSha256, HEX_R2); // base64 de R2 → hex interno
    assert.equal(stub.lastCommand, "HeadObjectCommand");
  });

  // 7. headObject de objeto inexistente → NOT_FOUND
  await test("7. headObject inexistente → R2StorageError NOT_FOUND", async () => {
    const stub = makeThrowingStub({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    await assert.rejects(() => headObject(stub, "b", "missing"), (e: unknown) => e instanceof R2StorageError && e.code === "NOT_FOUND");
  });

  // 8. deleteObject idempotente: objeto inexistente NO es error
  await test("8. deleteObject inexistente → no lanza (idempotente)", async () => {
    const stub = makeThrowingStub({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    await deleteObject(stub, "b", "missing"); // no debe lanzar
    const ok = makeStub({});
    await deleteObject(ok, "b", "k");
    assert.equal((ok as any).lastCommand, "DeleteObjectCommand");
  });

  // 9. normalización: auth → AUTH_ERROR; network/5xx → RETRYABLE
  await test("9. errores se normalizan: AUTH_ERROR y RETRYABLE", async () => {
    const authStub = makeThrowingStub({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    await assert.rejects(() => headObject(authStub, "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "AUTH_ERROR");

    const netStub = makeThrowingStub({ code: "ECONNRESET" });
    await assert.rejects(() => putObject(netStub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1 }), (e: unknown) => e instanceof R2StorageError && e.code === "RETRYABLE");

    const serverStub = makeThrowingStub({ name: "InternalError", $metadata: { httpStatusCode: 500 } });
    await assert.rejects(() => putObject(serverStub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1 }), (e: unknown) => e instanceof R2StorageError && e.code === "RETRYABLE");
  });

  // 9b. 4xx no-auth → PERMANENT; desconocido → UNKNOWN
  await test("9b. 4xx no-auth → PERMANENT; sin pistas → UNKNOWN", async () => {
    const badReq = makeThrowingStub({ name: "InvalidRequest", $metadata: { httpStatusCode: 400 } });
    await assert.rejects(() => headObject(badReq, "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "PERMANENT");
    const weird = makeThrowingStub({ name: "Weird" });
    await assert.rejects(() => headObject(weird, "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "UNKNOWN");
  });

  console.log(`\nr2 adapter: ${passed} ok, ${failures.length} fail`);
  if (failures.length) process.exit(1);
}

main();
