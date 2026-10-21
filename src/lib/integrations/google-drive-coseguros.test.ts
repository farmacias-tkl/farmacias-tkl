/**
 * Tests de google-drive.ts (coseguros) con la librería de Google INSTALADA, sin red:
 * toda conexión HTTPS del proceso (https.globalAgent, el que usa gaxios sin proxy)
 * se redirige a un servidor local que acepta la conexión y nunca completa el TLS.
 * Así se cuelga primero la autenticación (el pedido del token de la cuenta de
 * servicio) y después, si llegara, la llamada a Drive. Nada sale de la máquina.
 * La cuenta de servicio es inventada (clave generada acá).
 *   npx tsx src/lib/integrations/google-drive-coseguros.test.ts
 */
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import crypto from "node:crypto";
import { google } from "googleapis";
import { listCosegurosFiles, downloadDriveFileText, type DriveCallLimits } from "./google-drive";
import { syncCoseguros } from "@/lib/sync/sync-coseguros";
import type { Prisma } from "@prisma/client";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Servidor local que acepta y nunca contesta -----------------------------
const sockets = new Set<net.Socket>();
let connections = 0;
const hangServer = net.createServer((s) => {
  connections++; sockets.add(s);
  s.resume();   // lee (y descarta) lo que llegue: sin esto no se ve el cierre del cliente
  s.on("error", () => {});
  s.on("close", () => sockets.delete(s));
});
const open = () => sockets.size;
/** Espera hasta `ms` a que el cliente cierre todas sus conexiones colgadas. */
async function closedWithin(ms: number) {
  const until = Date.now() + ms;
  while (open() > 0 && Date.now() < until) await sleep(20);
  return open() === 0;
}

function fakeServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account", project_id: "nada", client_email: "nadie@nada.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

function limitsAborting(abortAfterMs: number, timeoutMs: number): DriveCallLimits {
  const c = new AbortController();
  setTimeout(() => c.abort(), abortAfterMs);
  return { signal: c.signal, timeoutMs };
}

/** Mide cuánto tarda en resolverse. Si a los 5 s sigue esperando, falla el test
 *  (eso es lo que pasa con el cliente anterior: queda colgado en la autenticación). */
async function elapsed(start: () => Promise<unknown>) {
  const t0 = Date.now();
  let err: unknown = null;
  const HUNG = Symbol("colgada");
  let guard: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    start().then(() => null, (e) => { err = e; return null; }),
    new Promise<symbol>((res) => { guard = setTimeout(() => res(HUNG), 5_000); }),
  ]);
  clearTimeout(guard);
  assert.notEqual(r, HUNG, "la llamada sigue esperando después de 5 s");
  return { ms: Date.now() - t0, err };
}

async function main() {
  await new Promise<void>((r) => hangServer.listen(0, "127.0.0.1", r));
  const port = (hangServer.address() as net.AddressInfo).port;
  for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete process.env[k];
  // Cualquier host HTTPS (oauth2 / googleapis) → servidor local colgado.
  (https.globalAgent as unknown as { createConnection: (o: tls.ConnectionOptions) => net.Socket }).createConnection =
    (o) => {
      const raw = net.connect(port, "127.0.0.1");
      const t = tls.connect({ socket: raw, servername: o.servername ?? o.host, rejectUnauthorized: true });
      t.on("close", () => raw.destroy());   // un TLSSocket sobre un socket propio no lo cierra solo
      return t;
    };
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fakeServiceAccount();

  console.log("listCosegurosFiles / downloadDriveFileText: la autenticación entra en el mismo límite");

  /** Arranca la llamada, espera a que el pedido del token quede colgado en el
   *  servidor local y recién ahí cancela; mide desde la cancelación. */
  async function cancelWhileAuthHangs(start: (limits: DriveCallLimits) => Promise<unknown>) {
    const before = connections;
    const c = new AbortController();
    const p = start({ signal: c.signal, timeoutMs: 30_000 });
    p.catch(() => {});
    const until = Date.now() + 10_000;
    while (connections === before && Date.now() < until) await sleep(10);
    assert.ok(connections > before, "el pedido del token tenía que llegar al servidor local");
    await sleep(150);
    c.abort();
    return elapsed(() => p);
  }

  await test("lista: autenticación colgada, se cancela la corrida → rechaza al toque y cierra la conexión", async () => {
    const r = await cancelWhileAuthHangs((l) => listCosegurosFiles("carpeta", l));
    assert.ok(r.err, "tenía que rechazar");
    assert.ok(r.ms < 200, `tardó ${r.ms} ms después de cancelar`);
    assert.ok(await closedWithin(1_000), "la conexión del token tenía que quedar cerrada, no esperando");
  });

  await test("lista: autenticación colgada, vence el límite de la llamada (sin cancelación) → rechaza", async () => {
    const r = await elapsed(() => listCosegurosFiles("carpeta", limitsAborting(60_000, 300)));
    assert.ok(r.err, "tenía que rechazar");
    assert.ok(r.ms >= 250 && r.ms < 1_000, `tardó ${r.ms} ms`);
    assert.ok(await closedWithin(1_000));
  });

  await test("descarga: autenticación colgada, se cancela la corrida → rechaza al toque y cierra la conexión", async () => {
    const r = await cancelWhileAuthHangs((l) => downloadDriveFileText("archivo", l));
    assert.ok(r.err, "tenía que rechazar");
    assert.ok(r.ms < 200, `tardó ${r.ms} ms después de cancelar`);
    assert.ok(await closedWithin(1_000));
  });

  await test("ya cancelada antes de empezar → rechaza sin conectarse", async () => {
    const c = new AbortController(); c.abort();
    const before = connections;
    const r = await elapsed(() => listCosegurosFiles("carpeta", { signal: c.signal, timeoutMs: 5_000 }));
    assert.ok(r.err);
    assert.ok(r.ms < 100, `tardó ${r.ms} ms`);
    assert.equal(connections, before);
  });

  await test("credenciales mal formadas → rechaza (no tira fuera de la promesa)", async () => {
    const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{no es json";
    try {
      const r = await elapsed(() => listCosegurosFiles("carpeta", limitsAborting(5_000, 5_000)));
      assert.ok(r.err);
      assert.ok(r.ms < 100);
    } finally { process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved; }
  });

  console.log("\nsyncCoseguros con las funciones reales de Drive");

  await test("autenticación colgada: la corrida termina dentro de COSEGUROS_DEADLINE_MS, ERROR y SyncLog", async () => {
    const logs: Prisma.SyncLogCreateInput[] = [];
    const t0 = Date.now();
    const r = await syncCoseguros({
      env: { COSEGUROS_SYNC_ENABLED: "true", GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID: "carpeta", COSEGUROS_DEADLINE_MS: "2000" },
      listFiles: listCosegurosFiles,
      downloadText: downloadDriveFileText,
      getBranches: async () => [],
      store: { findExisting: async () => [], upsertFile: async () => { throw new Error("no debía escribir"); } },
      writeLog: async (data) => { logs.push(data); },
    });
    const ms = Date.now() - t0;
    assert.ok(ms < 2_000, `tardó ${ms} ms`);
    assert.equal(r?.status, "ERROR");
    assert.match(r!.message, /tiempo agotado/);
    assert.deepEqual(logs.map((l) => [l.source, l.status]), [["SALES_COSEGUROS", "ERROR"]]);
    assert.ok(await closedWithin(500), "no queda ningún pedido colgado después de la corrida");
  });

  // Al final: ese cliente no cancela el pedido del token y lo reintenta, así que deja
  // conexiones abiertas que confundirían a los tests de arriba.
  console.log("\nControl: el cliente anterior (GoogleAuth + signal solo en la llamada a Drive)");

  await test("la cancelación NO corta la espera de la autenticación (lo que reprodujo Codex)", async () => {
    const before = connections;
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const drive = google.drive({ version: "v3", auth });
    const limits = limitsAborting(300, 300);
    let settled = false;
    drive.files.list({ q: "'x' in parents" }, { signal: limits.signal, timeout: limits.timeoutMs })
      .then(() => {}, () => {}).finally(() => { settled = true; });
    await sleep(1_500);
    assert.ok(connections > before, "el pedido del token tenía que llegar al servidor local");
    assert.equal(settled, false, "con este cliente la llamada sigue esperando el token después de cancelar");
    assert.ok(open() > 0, "y su conexión sigue abierta");
  });

  hangServer.close();
  for (const s of sockets) s.destroy();
  console.log(`\n${passed} de ${passed + failures.length} verificaciones pasan`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
