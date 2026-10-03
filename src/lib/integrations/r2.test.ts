/**
 * Tests del adapter R2 (B6.2 + B6.3-C1). PUROS, sin credenciales ni bucket real: inyección de
 * un stub `R2SendClient`. NO leen env real (salvo el test de CONFIG_MISSING, que limpia/restaura env).
 *   npx tsx src/lib/integrations/r2.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  putObject,
  headObject,
  getObject,
  deleteObject,
  getR2Config,
  R2StorageError,
  type R2SendClient,
} from "./r2";

// Content-MD5 = base64 de 16 bytes. Derivado con crypto para que el assert sea real.
const MD5_B64 = createHash("md5").update("hola").digest("base64");
// SHA-256 en base64 que un stub "devuelve" como si R2 lo mandara: el adapter debe IGNORARLO.
const SHA_B64 = createHash("sha256").update("hola").digest("base64");

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

  // 1c. getR2Config(env) valida contra el env RECIBIDO (no process.env)
  await test("1c. getR2Config(env) usa el env pasado; falta cualquiera de los 4 → CONFIG_MISSING", () => {
    const full = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" };
    assert.equal(getR2Config(full).bucket, "b");
    for (const k of Object.keys(full)) {
      const env: Record<string, string | undefined> = { ...full, [k]: undefined };
      assert.throws(() => getR2Config(env), (e: unknown) => e instanceof R2StorageError && e.code === "CONFIG_MISSING", k);
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

  // 3. putObject con contentMd5 + ifNoneMatch → ContentMD5 / IfNoneMatch en el comando
  await test("3. putObject con contentMd5 + ifNoneMatch → ContentMD5 e IfNoneMatch en el comando", async () => {
    const stub = makeStub({});
    await putObject(stub, "b", { key: "k", body: Buffer.from("hola"), contentType: "application/pdf", contentLength: 4, contentMd5: MD5_B64, ifNoneMatch: "*" });
    assert.equal(stub.lastInput.ContentMD5, MD5_B64);
    assert.equal(stub.lastInput.IfNoneMatch, "*");
  });

  // 3a. sin contentMd5/ifNoneMatch → el comando NO los lleva
  await test("3a. putObject sin contentMd5/ifNoneMatch → comando sin ContentMD5 ni IfNoneMatch", async () => {
    const stub = makeStub({});
    await putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1 });
    assert.equal("ContentMD5" in stub.lastInput, false);
    assert.equal("IfNoneMatch" in stub.lastInput, false);
  });

  // 3b. contentMd5 inválido → error claro, sin enviar nada
  await test("3b. putObject contentMd5 inválido → R2StorageError 'invalid contentMd5 input'", async () => {
    const stub = makeStub({});
    const bad = [
      "NOPE",                                                   // forma inválida
      createHash("sha256").update("x").digest("base64"),        // base64 válido pero 32 bytes
      createHash("md5").update("x").digest("hex"),              // hex de 32 chars, no base64
      "AAAAAAAAAAAAAAAAAAAAAB==",                               // 24 chars pero NO canónico
    ];
    for (const contentMd5 of bad) {
      await assert.rejects(
        () => putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1, contentMd5 }),
        (e: unknown) => e instanceof R2StorageError && e.code === "PERMANENT" && /invalid contentMd5 input/.test(e.message),
        `debe rechazar contentMd5=${contentMd5}`,
      );
    }
    assert.equal(stub.lastCommand, "", "no debe haber enviado nada al cliente");
  });

  // 3b'. ifNoneMatch distinto de "*" (forzado en runtime) → error claro, sin enviar nada
  await test("3b'. putObject ifNoneMatch ≠ \"*\" → R2StorageError PERMANENT", async () => {
    const stub = makeStub({});
    await assert.rejects(
      () => putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1, ifNoneMatch: '"etag"' as any }),
      (e: unknown) => e instanceof R2StorageError && e.code === "PERMANENT" && /ifNoneMatch/.test(e.message),
    );
    assert.equal(stub.lastCommand, "");
  });

  // 3c. el comando NUNCA lleva campos Checksum* (R2 no soporta SHA-256 full-object), aun con MD5
  //     (el automático del SDK se apaga con WHEN_REQUIRED en el cliente real; es middleware,
  //     no visible al stub — ver nota en r2.ts).
  await test("3c. putObject → comando sin ningún campo Checksum* (con y sin contentMd5)", async () => {
    const stub = makeStub({ ETag: '"e"' });
    await putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1 });
    let checksumKeys = Object.keys(stub.lastInput).filter((k) => /checksum/i.test(k));
    assert.deepEqual(checksumKeys, [], `sin MD5: campos Checksum* encontrados: ${checksumKeys.join(",")}`);
    await putObject(stub, "b", { key: "k", body: Buffer.from("hola"), contentType: "x", contentLength: 4, contentMd5: MD5_B64, ifNoneMatch: "*" });
    checksumKeys = Object.keys(stub.lastInput).filter((k) => /checksum/i.test(k));
    assert.deepEqual(checksumKeys, [], `con MD5: campos Checksum* encontrados: ${checksumKeys.join(",")}`);
  });

  // 4. putObject devuelve provider/bucket/key/contentType/sizeBytes/etag/uploadedAt; SIN checksum
  await test("4. putObject result completo y SIN checksumSha256 (aunque R2 devuelva ChecksumSHA256)", async () => {
    const stub = makeStub({ ETag: '"e1"', ChecksumSHA256: SHA_B64 });
    const r = await putObject(stub, "b", { key: "k", body: Buffer.from("xy"), contentType: "image/png", contentLength: 2 });
    assert.equal(r.provider, "R2");
    assert.equal(r.bucket, "b");
    assert.equal(r.key, "k");
    assert.equal(r.contentType, "image/png");
    assert.equal(r.sizeBytes, 2);
    assert.equal(r.etag, '"e1"');
    assert.ok(r.uploadedAt instanceof Date);
    assert.equal("checksumSha256" in r, false, "el result no debe exponer checksumSha256");
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

  // 6. headObject mapea ContentType/ContentLength/ETag/LastModified/Metadata; SIN checksum
  await test("6. headObject mapea metadata y NO expone checksumSha256", async () => {
    const lm = new Date("2026-06-22T10:00:00Z");
    const stub = makeStub({ ContentType: "image/jpeg", ContentLength: 12345, ETag: '"h"', LastModified: lm, Metadata: { attachmentid: "1" }, ChecksumSHA256: SHA_B64 });
    const r = await headObject(stub, "b", "k");
    assert.equal(r.exists, true);
    assert.equal(r.contentType, "image/jpeg");
    assert.equal(r.sizeBytes, 12345);
    assert.equal(r.etag, '"h"');
    assert.equal(r.lastModified, lm);
    assert.deepEqual(r.metadata, { attachmentid: "1" });
    assert.equal("checksumSha256" in r, false, "head no debe exponer checksumSha256");
    assert.equal(stub.lastCommand, "HeadObjectCommand");
  });

  // 6b. getObject transporta body (stream) + metadata, sin consumirlo ni hashearlo
  await test("6b. getObject → GetObjectCommand, body iterable intacto + metadata", async () => {
    const lm = new Date("2026-06-22T10:00:00Z");
    const stub = makeStub({ Body: Readable.from([Buffer.from("ho"), Buffer.from("la")]), ContentType: "image/jpeg", ContentLength: 4, ETag: '"g"', LastModified: lm, Metadata: { sha256: "x" }, ChecksumSHA256: SHA_B64 });
    const r = await getObject(stub, "b", "k");
    assert.equal(stub.lastCommand, "GetObjectCommand");
    assert.equal(stub.lastInput.Bucket, "b");
    assert.equal(stub.lastInput.Key, "k");
    assert.equal(r.provider, "R2");
    assert.equal(r.contentType, "image/jpeg");
    assert.equal(r.sizeBytes, 4);
    assert.equal(r.etag, '"g"');
    assert.equal(r.lastModified, lm);
    assert.deepEqual(r.metadata, { sha256: "x" });
    assert.equal("checksumSha256" in r, false);
    const chunks: Buffer[] = [];
    for await (const c of r.body) chunks.push(Buffer.from(c));
    assert.equal(Buffer.concat(chunks).toString(), "hola");
  });

  // 6c. getObject inexistente → NOT_FOUND; body ausente/no iterable → UNKNOWN
  await test("6c. getObject inexistente → NOT_FOUND; sin body legible → UNKNOWN", async () => {
    const missing = makeThrowingStub({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    await assert.rejects(() => getObject(missing, "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "NOT_FOUND");
    await assert.rejects(() => getObject(makeStub({}), "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "UNKNOWN");
    await assert.rejects(() => getObject(makeStub({ Body: "no-stream" }), "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "UNKNOWN");
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

  // 9c. BadDigest / InvalidDigest (400) → CHECKSUM_MISMATCH, NO PERMANENT
  await test("9c. BadDigest/InvalidDigest → CHECKSUM_MISMATCH (antes de la regla 4xx)", async () => {
    const put = (s: R2SendClient) => putObject(s, "b", { key: "k", body: Buffer.from("hola"), contentType: "x", contentLength: 4, contentMd5: MD5_B64 });
    for (const err of [
      { name: "BadDigest", $metadata: { httpStatusCode: 400 } },
      { Code: "BadDigest", $metadata: { httpStatusCode: 400 } },
      { name: "InvalidDigest", $metadata: { httpStatusCode: 400 } },
      { Code: "InvalidDigest", $metadata: { httpStatusCode: 400 } },
    ]) {
      await assert.rejects(() => put(makeThrowingStub(err)), (e: unknown) => e instanceof R2StorageError && e.code === "CHECKSUM_MISMATCH", JSON.stringify(err));
    }
  });

  // 9d. 412 / PreconditionFailed → PRECONDITION_FAILED, NO PERMANENT
  await test("9d. 412/PreconditionFailed → PRECONDITION_FAILED (antes de la regla 4xx)", async () => {
    const put = (s: R2SendClient) => putObject(s, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1, ifNoneMatch: "*" });
    for (const err of [
      { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } },
      { Code: "PreconditionFailed" },
      { name: "SomethingElse", $metadata: { httpStatusCode: 412 } },
    ]) {
      await assert.rejects(() => put(makeThrowingStub(err)), (e: unknown) => e instanceof R2StorageError && e.code === "PRECONDITION_FAILED", JSON.stringify(err));
    }
  });

  // 9e. los mensajes de error normalizados no filtran key/bucket
  await test("9e. mensajes de R2StorageError sin key/bucket", async () => {
    const s = makeThrowingStub({ name: "BadDigest", $metadata: { httpStatusCode: 400 } });
    await assert.rejects(
      () => putObject(s, "SENTINEL_BUCKET", { key: "SENTINEL_KEY", body: Buffer.from("hola"), contentType: "x", contentLength: 4, contentMd5: MD5_B64 }),
      (e: unknown) => e instanceof R2StorageError && !/SENTINEL_/.test(e.message),
    );
  });

  // 10. AbortSignal: head/put/get lo pasan al SDK (send(command, { abortSignal })); sin señal → sin opciones
  await test("10. head/put/get pasan abortSignal al SDK; sin señal no mandan opciones", async () => {
    const seen: any[] = [];
    const stub: R2SendClient = { async send(_c: unknown, o?: any) { seen.push(o); return { Body: Readable.from([Buffer.from("x")]) }; } };
    const ctrl = new AbortController();
    await headObject(stub, "b", "k", { abortSignal: ctrl.signal });
    await putObject(stub, "b", { key: "k", body: Buffer.from("x"), contentType: "x", contentLength: 1 }, { abortSignal: ctrl.signal });
    await getObject(stub, "b", "k", { abortSignal: ctrl.signal });
    await headObject(stub, "b", "k");
    assert.equal(seen[0].abortSignal, ctrl.signal);
    assert.equal(seen[1].abortSignal, ctrl.signal);
    assert.equal(seen[2].abortSignal, ctrl.signal);
    assert.equal(seen[3], undefined);
  });

  // 11. AbortError del SDK → ABORTED (antes que cualquier otra clasificación)
  await test("11. AbortError → R2StorageError ABORTED", async () => {
    for (const err of [{ name: "AbortError" }, { name: "AbortError", $metadata: { httpStatusCode: 500 } }, { code: "ABORT_ERR" }]) {
      await assert.rejects(() => getObject(makeThrowingStub(err), "b", "k"), (e: unknown) => e instanceof R2StorageError && e.code === "ABORTED", JSON.stringify(err));
    }
  });

  console.log(`\nr2 adapter: ${passed} ok, ${failures.length} fail`);
  if (failures.length) process.exit(1);
}

main();
