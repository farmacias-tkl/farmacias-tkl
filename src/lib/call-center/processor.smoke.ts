/**
 * SMOKE del processor del webhook Emozion (Sprint 4B, commit 4/4). Ejecuta upserts/
 * transacciones REALES contra una DB Postgres LOCAL EFÍMERA. Fixtures inline SANITIZADOS;
 * NO toca Emozion, NO usa token, NO toca Neon. Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/call-center/processor.smoke.ts
 *
 * Redirige el singleton @/lib/prisma a la DB efímera seteando DATABASE_URL ANTES de
 * importar el processor (import dinámico). Host-check aborta si la URL base no es local.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";

const TEST_DB = "tkl_cc4b_smoke";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }

// URL base LOCAL desde .env (lectura directa, sin dotenv para no contaminar stdout).
const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
if (!m) abort("No encontré DATABASE_URL en .env");
const baseUrl = m[1].trim();
const baseHost = new URL(baseUrl).hostname;
if (!["localhost", "127.0.0.1"].includes(baseHost)) abort(`SAFETY ABORT: ${baseHost} no es local. NUNCA Neon.`);
const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl); testUrl.pathname = `/${TEST_DB}`;
const ADMIN_URL = adminUrl.toString();
const TEST_URL = testUrl.toString();

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch((e) => { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); });
}
const last4 = (s: string) => "***" + (s.replace(/\D/g, "").slice(-4) || "");

async function adminExec(sql: string) {
  const a = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
}

async function main() {
  console.log("== setup DB efímera ==");
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_URL } });

  // Redirigir el singleton @/lib/prisma a la DB efímera ANTES de importar el processor.
  process.env.DATABASE_URL = TEST_URL;
  const { prisma } = await import("../prisma");
  const { processWebhookEvent } = await import("./processor");

  const mkEvent = (eventType: string, payload: unknown, extConv: string | null, extMsg: string | null) =>
    prisma.webhookEvent.create({
      data: { source: "EMOZION", eventType, accountId: 22, externalConversationId: extConv, externalMessageId: extMsg, payload: payload as any, status: "RECEIVED", attempts: 0 },
      select: { id: true },
    });

  const convPayload = (uuid: string, phone: string, name: string, status: string, labels: string[]) => ({
    event: "conversation_created",
    conversation: { externalConversationId: uuid, status, source: "EMOZION", customerPhoneSnapshot: phone, firstResponseAt: null, closedAt: null, externalCreatedAt: "2026-06-01T10:00:00.000Z", externalLabels: labels, contact: { phone, displayName: name } },
  });
  const msgPayload = (uuid: string, extMsg: string, author: string, body: string, isPrivate: boolean, conv: unknown = null) => ({
    event: "message_created", externalConversationId: uuid,
    message: { externalMessageId: extMsg, externalSenderId: "7", author, body, mediaType: null, isPrivate, sentAt: "2026-06-01T10:05:00.000Z", isActivity: false },
    conversation: conv,
  });

  try {
    console.log("\n== casos ==");

    // 1. conversation_created → Customer + Conversation + StateHistory de nacimiento
    await check("1. conversation_created crea Customer+Conversation+StateHistory", async () => {
      const ev = await mkEvent("conversation_created", convPayload("uuid-A", "+5491100000001", "Cliente Ficticio A", "SIN_ASIGNAR", ["cronico_mensual"]), "uuid-A", null);
      const r = await processWebhookEvent(ev.id);
      assert.equal(r.status, "PROCESSED");
      const conv = await prisma.conversation.findUnique({ where: { externalConversationId: "uuid-A" }, include: { customer: true, stateHistory: true } });
      assert.ok(conv, "conversación creada");
      assert.equal(conv!.customer.phone, "+5491100000001");
      assert.deepEqual(conv!.externalLabels, ["cronico_mensual"]); // labels crudas guardadas
      assert.equal(conv!.stateHistory.length, 1);
      assert.equal(conv!.stateHistory[0].fromStatus, null);
      const we = await prisma.webhookEvent.findUnique({ where: { id: ev.id } });
      assert.equal(we!.status, "PROCESSED");
      assert.equal(we!.payload, null, "payload nuleado tras PROCESSED");
    });

    // 2. message_created (conv existe) → ConversationMessage; isPrivate se guarda
    await check("2. message_created crea ConversationMessage (+ isPrivate)", async () => {
      const ev = await mkEvent("message_created", msgPayload("uuid-A", "wamid-1", "CUSTOMER", "hola, consulta", false), "uuid-A", "wamid-1");
      const r = await processWebhookEvent(ev.id);
      assert.equal(r.status, "PROCESSED");
      const evp = await mkEvent("message_created", msgPayload("uuid-A", "wamid-priv", "OPERATOR", "nota interna", true), "uuid-A", "wamid-priv");
      await processWebhookEvent(evp.id);
      const msg = await prisma.conversationMessage.findUnique({ where: { externalMessageId: "wamid-1" } });
      assert.ok(msg);
      const priv = await prisma.conversationMessage.findUnique({ where: { externalMessageId: "wamid-priv" } });
      assert.equal(priv!.isPrivate, true, "isPrivate guardado");
    });

    // 3. mismo message repetido (secuencial) y CONCURRENTE → no duplica
    await check("3. message_created idempotente (repetido + concurrente)", async () => {
      // repetido secuencial: misma externalMessageId wamid-1 otra vez
      const dup = await mkEvent("message_created", msgPayload("uuid-A", "wamid-1", "CUSTOMER", "hola, consulta", false), "uuid-A", "wamid-1");
      await processWebhookEvent(dup.id);
      const cnt1 = await prisma.conversationMessage.count({ where: { externalMessageId: "wamid-1" } });
      assert.equal(cnt1, 1, "repetido secuencial no duplica");
      // concurrente: dos eventos con el mismo wamid-conc procesados en paralelo
      const c1 = await mkEvent("message_created", msgPayload("uuid-A", "wamid-conc", "CUSTOMER", "x", false), "uuid-A", "wamid-conc");
      const c2 = await mkEvent("message_created", msgPayload("uuid-A", "wamid-conc", "CUSTOMER", "x", false), "uuid-A", "wamid-conc");
      const [r1, r2] = await Promise.all([processWebhookEvent(c1.id), processWebhookEvent(c2.id)]);
      const cntC = await prisma.conversationMessage.count({ where: { externalMessageId: "wamid-conc" } });
      assert.equal(cntC, 1, "concurrente no duplica (P2002 manejado)");
      assert.ok(r1.status === "PROCESSED" && r2.status === "PROCESSED", "ambos PROCESSED (idempotente)");
    });

    // 4. message_created huérfano sin datos → ERROR needsRetry, sin dominio parcial
    await check("4. message huérfano → WebhookEvent ERROR, sin dominio parcial", async () => {
      const ev = await mkEvent("message_created", msgPayload("uuid-MISSING", "wamid-orphan", "CUSTOMER", "huerfano", false, null), "uuid-MISSING", "wamid-orphan");
      const r = await processWebhookEvent(ev.id);
      assert.equal(r.status, "ERROR");
      assert.equal(r.outcome, "needsRetry");
      const we = await prisma.webhookEvent.findUnique({ where: { id: ev.id } });
      assert.equal(we!.status, "ERROR");
      assert.ok(we!.payload !== null, "payload conservado para reproceso");
      assert.equal(await prisma.conversation.count({ where: { externalConversationId: "uuid-MISSING" } }), 0, "no se creó conversación");
      assert.equal(await prisma.conversationMessage.count({ where: { externalMessageId: "wamid-orphan" } }), 0, "no se creó mensaje");
    });

    // 5. conversation_status_changed → actualiza status + StateHistory
    await check("5. status_changed actualiza status + StateHistory", async () => {
      const ev = await mkEvent("conversation_status_changed", { event: "conversation_status_changed", statusEvent: { externalConversationId: "uuid-A", status: "RESUELTA", closedAt: "2026-06-01T11:00:00.000Z" } }, "uuid-A", null);
      const r = await processWebhookEvent(ev.id);
      assert.equal(r.status, "PROCESSED");
      const conv = await prisma.conversation.findUnique({ where: { externalConversationId: "uuid-A" }, include: { stateHistory: { orderBy: { changedAt: "asc" } } } });
      assert.equal(conv!.status, "RESUELTA");
      assert.ok(conv!.closedAt);
      assert.ok(conv!.stateHistory.some((h) => h.toStatus === "RESUELTA"), "StateHistory de RESUELTA");
    });

    // 6. processor falla en dominio → WebhookEvent ERROR + SyncLog ERROR PERSISTEN (no rollback)
    await check("6. fallo de dominio → WebhookEvent ERROR + SyncLog ERROR persisten; dominio rolled back", async () => {
      // status inválido fuerza un error de Prisma DENTRO de la tx de dominio
      const badPayload = { event: "conversation_created", conversation: { externalConversationId: "uuid-BAD", status: "NOPE_INVALID", source: "EMOZION", customerPhoneSnapshot: "+5491100000099", firstResponseAt: null, closedAt: null, externalCreatedAt: null, externalLabels: [], contact: { phone: "+5491100000099", displayName: "X" } } };
      const ev = await mkEvent("conversation_created", badPayload, "uuid-BAD", null);
      const r = await processWebhookEvent(ev.id);
      assert.equal(r.status, "ERROR");
      const we = await prisma.webhookEvent.findUnique({ where: { id: ev.id } });
      assert.equal(we!.status, "ERROR", "WebhookEvent ERROR sobrevive");
      assert.ok((we!.attempts ?? 0) >= 1, "attempts incrementado");
      const syncErr = await prisma.syncLog.findFirst({ where: { source: "EMOZION", status: "ERROR" }, orderBy: { createdAt: "desc" } });
      assert.ok(syncErr, "SyncLog ERROR persiste fuera del rollback");
      assert.equal(await prisma.conversation.count({ where: { externalConversationId: "uuid-BAD" } }), 0, "dominio rolled back (sin conversación parcial)");
      // El Customer del payload BAD tampoco debe quedar (rollback de toda la tx de dominio)
      assert.equal(await prisma.customer.count({ where: { phone: "+5491100000099" } }), 0, "customer del fallo rolled back");
    });

    // Verificaciones agregadas + salida sanitizada
    console.log("\n== verificación agregada (sanitizada) ==");
    const customers = await prisma.customer.findMany({ select: { phone: true, displayName: true } });
    console.log("customers:", customers.map((c) => ({ phone: last4(c.phone), name: c.displayName ? "present" : "null" })));
    const msgs = await prisma.conversationMessage.findMany({ select: { author: true, body: true, isPrivate: true, mediaType: true } });
    console.log("messages:", msgs.map((x) => ({ author: x.author, bodyLen: x.body?.length ?? 0, isPrivate: x.isPrivate, mediaType: x.mediaType })));
    const syncSucc = await prisma.syncLog.count({ where: { status: "SUCCESS" } });
    const syncErrC = await prisma.syncLog.count({ where: { status: { in: ["ERROR", "PARTIAL"] } } });
    console.log(`SyncLog SUCCESS=${syncSucc} ERROR/PARTIAL=${syncErrC}`);
    await check("SyncLog se crea para éxito y para fallo", () => {
      assert.ok(syncSucc >= 1 && syncErrC >= 1);
    });
  } finally {
    await (await import("../prisma")).prisma.$disconnect().catch(() => {});
    console.log("\n== teardown ==");
    try {
      await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      console.log("teardown OK — DB efímera eliminada.");
    } catch (e) {
      console.error(`TEARDOWN FAILED: borrar manualmente la DB "${TEST_DB}". detalle: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nprocessor.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); } catch (te) {
    console.error(`TEARDOWN FAILED: borrar manualmente "${TEST_DB}". ${te instanceof Error ? te.message : String(te)}`);
  }
  process.exit(1);
});
