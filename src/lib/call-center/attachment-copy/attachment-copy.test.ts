/**
 * Tests PUROS del job de copia (B6.3-C3): fetcher de Emozion (fetch inyectado), backoff y
 * construcción del SQL de reserva. Sin DB, sin red. La lógica de estados contra Postgres real
 * está en attachment-copy.smoke.ts (DB local efímera).
 *   npx tsx src/lib/call-center/attachment-copy/attachment-copy.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createEmozionFetcher, normalizeContentType } from "./emozion-fetcher";
import { FetchAbortedError, SourceFetchError } from "./source-fetcher";
import { backoffMs } from "./backoff";
import { buildReserveQuery } from "./reserve-sql";
import { MAX_OBJECT_BYTES, SOURCE_TTL_HOURS, objectKeyFor } from "./constants";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const HOST = "files.example";
const URL_OK = `https://${HOST}/rails/active_storage/blobs/redirect/SENTINEL_SIGNED/SENTINEL_FILE.jpg`;
const LIMITS = { maxBytes: MAX_OBJECT_BYTES, timeoutMs: 2000 };
type FetchImpl = typeof fetch;

/** fetch inyectable que registra llamadas y devuelve la Response dada. */
function fakeFetch(make: (init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return make(init); }) as unknown as FetchImpl;
  return { impl, calls };
}
const fetcher = (impl: FetchImpl) => createEmozionFetcher({ fetchImpl: impl, allowedHosts: () => [HOST] });

async function expectFetchError(p: Promise<unknown>, code: string, retryable: boolean) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof SourceFetchError, `esperaba SourceFetchError, fue ${String(e)}`);
    assert.equal(e.code, code);
    assert.equal(e.retryable, retryable);
    assert.ok(!/SENTINEL|https?:\/\//.test(e.message), "el error no lleva la URL");
    return true;
  });
}

async function main() {
  await test("1. OK: bytes + SHA-256 + MD5 + content-type normalizado; redirect manual; sin credenciales", async () => {
    const body = Buffer.from("contenido de prueba");
    const f = fakeFetch(() => new Response(body, { status: 200, headers: { "content-type": "Image/JPEG; charset=x", "content-length": String(body.length) } }));
    const r = await fetcher(f.impl).fetch(URL_OK, LIMITS);
    assert.equal(r.sizeBytes, body.length);
    assert.equal(r.sha256Hex, createHash("sha256").update(body).digest("hex"));
    assert.equal(r.md5Base64, createHash("md5").update(body).digest("base64"));
    assert.equal(r.contentType, "image/jpeg");
    assert.ok(r.bytes.equals(body));
    assert.equal(f.calls[0].init?.redirect, "manual");
    assert.equal(f.calls[0].init?.credentials, "omit");
  });

  await test("2. redirect (3xx) → ORIGIN_REDIRECT_REJECTED REINTENTABLE", async () => {
    for (const status of [301, 302, 307, 308]) {
      const f = fakeFetch(() => new Response(null, { status, headers: { location: "https://elsewhere.example/x" } }));
      await expectFetchError(fetcher(f.impl).fetch(URL_OK, LIMITS), "ORIGIN_REDIRECT_REJECTED", true);
    }
  });

  await test("3. 404/410 → ORIGIN_GONE terminal; 403 → 4XX reintentable; 503 → 5XX reintentable", async () => {
    await expectFetchError(fetcher(fakeFetch(() => new Response("x", { status: 404 })).impl).fetch(URL_OK, LIMITS), "ORIGIN_GONE", false);
    await expectFetchError(fetcher(fakeFetch(() => new Response("x", { status: 410 })).impl).fetch(URL_OK, LIMITS), "ORIGIN_GONE", false);
    await expectFetchError(fetcher(fakeFetch(() => new Response("x", { status: 403 })).impl).fetch(URL_OK, LIMITS), "ORIGIN_HTTP_4XX", true);
    await expectFetchError(fetcher(fakeFetch(() => new Response("x", { status: 503 })).impl).fetch(URL_OK, LIMITS), "ORIGIN_HTTP_5XX", true);
  });

  await test("4. >25 MB por Content-Length → TOO_LARGE terminal (sin leer el body)", async () => {
    const f = fakeFetch(() => new Response("chico", { status: 200, headers: { "content-length": String(MAX_OBJECT_BYTES + 1) } }));
    await expectFetchError(fetcher(f.impl).fetch(URL_OK, LIMITS), "TOO_LARGE", false);
  });

  await test("5. >25 MB por conteo de bytes en stream (sin Content-Length) → TOO_LARGE terminal", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) { if (sent > 30) { ctrl.close(); return; } sent++; ctrl.enqueue(chunk); },
    });
    const f = fakeFetch(() => new Response(stream, { status: 200 }));
    await expectFetchError(fetcher(f.impl).fetch(URL_OK, LIMITS), "TOO_LARGE", false);
    assert.ok(sent <= 27, `debe cortar apenas pasa el tope (leyó ${sent} MB)`);
  });

  await test("6. text/html → UNEXPECTED_CONTENT_TYPE reintentable", async () => {
    const f = fakeFetch(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    await expectFetchError(fetcher(f.impl).fetch(URL_OK, LIMITS), "UNEXPECTED_CONTENT_TYPE", true);
  });

  await test("7. allowlist validada ANTES del fetch: host ajeno / http → SOURCE_URL_REJECTED, sin llamar a fetch", async () => {
    const f = fakeFetch(() => new Response("x"));
    await expectFetchError(fetcher(f.impl).fetch("https://otro.example/x.jpg", LIMITS), "SOURCE_URL_REJECTED", true);
    await expectFetchError(fetcher(f.impl).fetch(`http://${HOST}/x.jpg`, LIMITS), "SOURCE_URL_REJECTED", true);
    await expectFetchError(createEmozionFetcher({ fetchImpl: f.impl, allowedHosts: () => [] }).fetch(URL_OK, LIMITS), "SOURCE_URL_REJECTED", true);
    assert.equal(f.calls.length, 0, "no se llamó a fetch");
  });

  // fetch que no responde hasta que se aborta su señal (como undici).
  const hanging = () => fakeFetch((init) => new Promise<Response>((_, rej) => {
    init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }));

  await test("8. timeout propio → ORIGIN_TIMEOUT reintentable", async () => {
    await expectFetchError(fetcher(hanging().impl).fetch(URL_OK, { ...LIMITS, timeoutMs: 30 }), "ORIGIN_TIMEOUT", true);
  });

  await test("9. AbortSignal de la corrida respetado → FetchAbortedError (antes y durante el fetch)", async () => {
    const pre = new AbortController(); pre.abort();
    const f0 = fakeFetch(() => new Response("x"));
    await assert.rejects(fetcher(f0.impl).fetch(URL_OK, { ...LIMITS, signal: pre.signal }), (e: unknown) => e instanceof FetchAbortedError);
    assert.equal(f0.calls.length, 0);
    const ctrl = new AbortController();
    const p = fetcher(hanging().impl).fetch(URL_OK, { ...LIMITS, timeoutMs: 5000, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await assert.rejects(p, (e: unknown) => e instanceof FetchAbortedError);
  });

  await test("10. error de red → ORIGIN_NETWORK reintentable (sin propagar el mensaje)", async () => {
    const impl = (async () => { throw new TypeError(`fetch failed ${URL_OK}`); }) as unknown as FetchImpl;
    await expectFetchError(fetcher(impl).fetch(URL_OK, LIMITS), "ORIGIN_NETWORK", true);
  });

  await test("11. TTL de origen expuesto por el fetcher = 72 h; source EMOZION", () => {
    const f = createEmozionFetcher();
    assert.equal(f.sourceTtlMs, SOURCE_TTL_HOURS * 3600_000);
    assert.equal(f.sourceTtlMs, 72 * 3600_000);
    assert.equal(f.source, "EMOZION");
  });

  await test("12. normalizeContentType: inválido/ausente → application/octet-stream", () => {
    assert.equal(normalizeContentType(null), "application/octet-stream");
    assert.equal(normalizeContentType("nada"), "application/octet-stream");
    assert.equal(normalizeContentType("application/PDF"), "application/pdf");
  });

  await test("13. backoff: min(5min·3^(n-1), 6h) ±20%", () => {
    const at = (n: number, r: number) => backoffMs(n, () => r);
    assert.equal(at(1, 0.5), 5 * 60_000);
    assert.equal(at(2, 0.5), 15 * 60_000);
    assert.equal(at(3, 0.5), 45 * 60_000);
    assert.equal(at(5, 0.5), 6 * 3600_000, "tope 6 h");
    assert.equal(at(1, 0), Math.round(5 * 60_000 * 0.8));
    assert.ok(at(1, 0.999999) < 5 * 60_000 * 1.2 + 1);
  });

  await test("14. SQL de reserva: SKIP LOCKED, filtros y parámetros (sin URL en los parámetros)", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const q = buildReserveQuery({ source: "EMOZION", maxAttempts: 5, limit: 5, leaseId: "lease-1", now, leaseUntil: new Date(now.getTime() + 120_000) });
    const sql = q.text.replace(/\s+/g, " "); // .text = placeholders de Postgres ($n)
    for (const frag of [
      "FOR UPDATE SKIP LOCKED", `"sourceFetchUrl" IS NOT NULL`, `"storageAttemptCount" < $`, `ORDER BY "createdAt", id`,
      `"storageStatus" IN ('PENDING', 'FAILED')`, `"storageStatus" = 'COPYING' AND "storageNextRetryAt" <=`,
      `SET "storageStatus" = 'COPYING'`, `"storageAttemptCount" = a."storageAttemptCount" + 1`, "cand.prev_status, cand.prev_next",
    ]) assert.ok(sql.includes(frag), `falta: ${frag}`);
    assert.deepEqual(q.values, ["EMOZION", 5, now.toISOString(), now.toISOString(), 5, "lease-1", "2026-10-03T12:02:00.000Z", now.toISOString()]);
  });

  await test("15. key del objeto determinística, sin filename", () => {
    assert.equal(objectKeyFor("cm123abc"), "call-center/attachments/v1/cm123abc");
  });

  console.log(`\nattachment-copy: ${passed} ok, ${failures.length} fail`);
  if (failures.length) process.exit(1);
}

main();
