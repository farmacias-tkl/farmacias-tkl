/**
 * SMOKE de B3-A (endpoint metadata-only de attachments). Ejecuta el núcleo testeable
 * buildAttachmentsResponse contra una DB Postgres LOCAL EFÍMERA. NO toca Emozion/token/Neon.
 * Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/call-center/attachments-read.smoke.ts
 *
 * Cubre: 401 sin sesión · 403 sin acceso · 404 conversación inexistente · 200 lista vacía ·
 * 200 con attachments (orden asc por createdAt + metadata correcta) · red dura por LISTA
 * BLANCA (keys exactas) · red dura por lista negra (tokens prohibidos ausentes) · sin AuditLog.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";

const TEST_DB = "tkl_b3a_smoke";
const ISO = "2026-06-20T13:00:00.000-03:00";

// Keys EXACTAS que el response puede contener (lista blanca = el invariante real de B3-A).
const EXACT_KEYS = ["id", "conversationId", "messageId", "mediaType", "sizeBytes", "documentType", "status", "source", "createdAt"];
// Tokens que NUNCA deben aparecer en el response serializado (lista negra complementaria).
const FORBIDDEN = ["sourceExternalId", "SENTINEL_SRCEXT", "data_url", "thumb_url", "source_url", "http", "https", "active_storage", "originalFileName", "storageKey", "storageProvider"];

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }

const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) abort(`SAFETY ABORT: ${new URL(baseUrl).hostname} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const ADMIN_URL = adminUrl.toString();
const TEST_URL = testUrl.toString();

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn)
    .then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch((e) => { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); });
}
async function adminExec(sql: string) {
  const a = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
}

const sup = { role: "SUPERVISOR" } as any;          // canViewCallCenter true (jerarquía)
const noAccess = { role: "BRANCH_MANAGER" } as any; // sin flag → canViewCallCenter false

async function main() {
  console.log("== setup DB efímera ==");
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_URL } });

  process.env.DATABASE_URL = TEST_URL;
  const { prisma } = await import("../prisma");
  const { buildAttachmentsResponse } = await import("./attachments-read");

  try {
    // ── seed ──────────────────────────────────────────────────────────────────────
    const cust = await prisma.customer.create({ data: { phone: "+5491100000001", displayName: "Cliente" } });
    const convA = await prisma.conversation.create({ data: { customerId: cust.id, status: "SIN_ASIGNAR", source: "EMOZION", externalConversationId: "70001" } });
    const convB = await prisma.conversation.create({ data: { customerId: cust.id, status: "SIN_ASIGNAR", source: "EMOZION", externalConversationId: "70002" } });
    const msg = await prisma.conversationMessage.create({ data: { conversationId: convA.id, author: "CUSTOMER", body: null, mediaType: "image", externalMessageId: "wamid-b3a", sentAt: new Date(ISO) } });
    // Dos adjuntos insertados FUERA de orden, con createdAt explícito → prueba orderBy asc.
    // sourceExternalId con sentinela → prueba que NO se filtra (está fuera del select).
    await prisma.conversationAttachment.create({ data: { conversationId: convA.id, messageId: msg.id, source: "EMOZION", sourceExternalId: "emozion-attachment:SENTINEL_SRCEXT_2", mediaType: "file", sizeBytes: 2222, documentType: "UNKNOWN", status: "RECEIVED", createdAt: new Date("2026-06-20T16:00:02.000Z") } });
    await prisma.conversationAttachment.create({ data: { conversationId: convA.id, messageId: msg.id, source: "EMOZION", sourceExternalId: "emozion-attachment:SENTINEL_SRCEXT_1", mediaType: "image", sizeBytes: 1111, documentType: "UNKNOWN", status: "RECEIVED", createdAt: new Date("2026-06-20T16:00:01.000Z") } });

    console.log("\n== casos B3-A ==");

    await check("1. sin sesión → 401", async () => {
      const r = await buildAttachmentsResponse(null, convA.id);
      assert.equal(r.status, 401);
    });

    await check("2. usuario sin acceso (BRANCH_MANAGER sin flag) → 403", async () => {
      const r = await buildAttachmentsResponse(noAccess, convA.id);
      assert.equal(r.status, 403);
    });

    await check("3. conversación inexistente → 404", async () => {
      const r = await buildAttachmentsResponse(sup, "cminexistente000000000000");
      assert.equal(r.status, 404);
    });

    await check("4. conversación sin attachments → 200 { data: [] }", async () => {
      const r = await buildAttachmentsResponse(sup, convB.id);
      assert.equal(r.status, 200);
      assert.deepEqual((r.body as any).data, []);
    });

    await check("5. con attachments → 200, orden asc por createdAt + metadata correcta", async () => {
      const r = await buildAttachmentsResponse(sup, convA.id);
      assert.equal(r.status, 200);
      const data = (r.body as any).data as any[];
      assert.equal(data.length, 2);
      // orden asc: primero el de createdAt :01 (image/1111), después :02 (file/2222)
      assert.equal(data[0].mediaType, "image");
      assert.equal(data[0].sizeBytes, 1111);
      assert.equal(data[1].mediaType, "file");
      assert.equal(data[1].sizeBytes, 2222);
      // metadata correcta
      assert.equal(data[0].documentType, "UNKNOWN");
      assert.equal(data[0].status, "RECEIVED");
      assert.equal(data[0].source, "EMOZION");
      assert.equal(data[0].conversationId, convA.id);
      assert.equal(data[0].messageId, msg.id);
    });

    await check("6. RED DURA lista blanca: keys EXACTAS (ni una de más)", async () => {
      const r = await buildAttachmentsResponse(sup, convA.id);
      const data = (r.body as any).data as any[];
      for (const item of data) {
        assert.deepEqual(Object.keys(item).sort(), [...EXACT_KEYS].sort(), `keys exactas; obtenidas: ${Object.keys(item).join(",")}`);
      }
    });

    await check("7. RED DURA lista negra: tokens prohibidos ausentes en el response", async () => {
      const r = await buildAttachmentsResponse(sup, convA.id);
      const json = JSON.stringify(r.body);
      for (const tok of FORBIDDEN) {
        assert.ok(!json.includes(tok), `no debe aparecer "${tok}"`);
      }
    });

    await check("8. B3-A NO escribe AuditLog (count sin cambios)", async () => {
      const before = await prisma.auditLog.count();
      await buildAttachmentsResponse(sup, convA.id);
      await buildAttachmentsResponse(sup, convB.id);
      const after = await prisma.auditLog.count();
      assert.equal(before, after, "el listado de metadata no audita");
      assert.equal(after, 0, "sin AuditLog en B3-A");
    });
  } finally {
    await (await import("../prisma")).prisma.$disconnect().catch(() => {});
    console.log("\n== teardown ==");
    try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); console.log("teardown OK — DB efímera eliminada."); }
    catch (e) { console.error(`TEARDOWN FAILED: borrar manualmente "${TEST_DB}". ${e instanceof Error ? e.message : String(e)}`); }
  }

  console.log(`\nattachments-read.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); } catch (te) { console.error(`TEARDOWN FAILED: borrar "${TEST_DB}". ${te instanceof Error ? te.message : String(te)}`); }
  process.exit(1);
});
