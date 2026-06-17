/**
 * SMOKE del processor del webhook Emozion. Ejecuta upserts/transacciones REALES contra una
 * DB Postgres LOCAL EFÍMERA. NO toca Emozion/token/Neon. Teardown garantizado (DROP al final).
 *
 *   npx tsx src/lib/call-center/processor.smoke.ts
 *
 * Los fixtures son payloads webhook con la FORMA REAL del fork (message_type STRING,
 * created_at ISO, id de conversación NUMÉRICO, account en account.id / messages[0].account_id)
 * y se transforman con los MAPPERS REALES (buildFromRaw espeja el handler) antes de persistir
 * el WebhookEvent → valida mapper→processor de punta a punta. Redirige el singleton
 * @/lib/prisma a la DB efímera seteando DATABASE_URL antes del import dinámico del processor.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { PrismaClient, Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import {
  readEnvelope,
  normalizeConversation,
  normalizeMessage,
  normalizeStatusEvent,
  conversationExternalId,
} from "./emozion-mappers";

const TEST_DB = "tkl_cc4b_smoke";
const ISO = "2026-06-17T19:15:45.621-03:00";
const ISO2 = "2026-06-17T19:20:00.000-03:00";
const CONV = 39099; // id numérico de la conversación principal

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
const last4 = (s: string) => "***" + (s.replace(/\D/g, "").slice(-4) || "");
async function adminExec(sql: string) {
  const a = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
}

// ── Fixtures RAW (forma real del fork) ────────────────────────────────────────────
const rawConvCreated = (id: number, phone: string, name: string, status: string, labels: string[], assigneeId: number | null = null, event = "conversation_created") => ({
  event, id, status, labels,
  meta: { sender: { phone_number: phone, name }, assignee: assigneeId != null ? { id: assigneeId } : null },
  first_reply_created_at: ISO2, created_at: ISO, resolved_at: status === "resolved" ? ISO2 : null,
  messages: [{ account_id: 22, conversation_id: id }],
});
const rawMsg = (opts: { convId: number | null; msgId: number; sourceId: string | null; mt: string; content: string; isPrivate?: boolean; senderId: number | null; senderType: string | null; embedConv?: boolean; phone?: string }) => ({
  event: "message_created", id: opts.msgId, source_id: opts.sourceId, message_type: opts.mt, private: !!opts.isPrivate,
  content: opts.content, created_at: ISO, sender: { id: opts.senderId, type: opts.senderType }, account: { id: 22 },
  conversation: opts.embedConv === false || opts.convId == null ? null
    : { id: opts.convId, status: "open", meta: { sender: { phone_number: opts.phone ?? "+5491100000001", name: "Cliente" } }, messages: [{ account_id: 22, conversation_id: opts.convId }] },
});

// Espeja la construcción de payload del handler usando los MAPPERS REALES.
function buildFromRaw(raw: any): { eventType: string; externalConversationId: string | null; externalMessageId: string | null; payload: any; status: "RECEIVED" | "IGNORED" | "ERROR" } {
  const env = readEnvelope(raw);
  const eventType = env.event ?? "unknown";
  const externalConversationId = conversationExternalId(env.conversation);
  let externalMessageId: string | null = env.message?.source_id ?? null;
  let payload: any = null;
  let status: "RECEIVED" | "IGNORED" | "ERROR" = "RECEIVED";
  if (eventType === "conversation_created") {
    const r = normalizeConversation(env.conversation);
    if (r.outcome === "processed") payload = { event: eventType, conversation: r.data };
    else status = "ERROR";
  } else if (eventType === "message_created") {
    const r = normalizeMessage(env.message);
    if (r.outcome === "processed") {
      const rc = normalizeConversation(env.conversation);
      payload = { event: eventType, externalConversationId, message: r.data, conversation: rc.outcome === "processed" ? rc.data : null };
      externalMessageId = r.data!.externalMessageId;
    } else if (r.outcome === "ignored") status = "IGNORED";
    else status = "ERROR";
  } else if (eventType === "conversation_status_changed") {
    const r = normalizeStatusEvent(env.conversation);
    if (r.outcome === "processed") payload = { event: eventType, statusEvent: r.data };
    else status = "ERROR";
  }
  return { eventType, externalConversationId, externalMessageId, payload: payload ? JSON.parse(JSON.stringify(payload)) : null, status };
}

async function main() {
  console.log("== setup DB efímera ==");
  await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${TEST_DB}"`);
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_URL } });

  process.env.DATABASE_URL = TEST_URL;
  const { prisma } = await import("../prisma");
  const { processWebhookEvent, getUniqueViolationTarget, isDomainIdempotencyUniqueViolation } = await import("./processor");

  // Crea el WebhookEvent a partir de un RAW real (vía mappers) tal como lo haría el handler.
  async function fromRaw(raw: any) {
    const b = buildFromRaw(raw);
    const ev = await prisma.webhookEvent.create({
      data: { source: "EMOZION", eventType: b.eventType, accountId: 22, externalConversationId: b.externalConversationId, externalMessageId: b.externalMessageId, payload: b.payload ?? undefined, status: b.status, attempts: 0 },
      select: { id: true },
    });
    return { id: ev.id, builtStatus: b.status };
  }
  // Crea un WebhookEvent con payload normalizado DIRECTO (para forzar fallos de dominio).
  async function fromNormalized(eventType: string, payload: unknown, extConv: string | null) {
    const ev = await prisma.webhookEvent.create({
      data: { source: "EMOZION", eventType, accountId: 22, externalConversationId: extConv, payload: payload as any, status: "RECEIVED", attempts: 0 },
      select: { id: true },
    });
    return ev.id;
  }

  try {
    console.log("\n== casos (forma real) ==");

    // 1. conversation_created → Customer + Conversation + StateHistory de nacimiento
    await check("1. conversation_created (raw real) crea Customer+Conversation+StateHistory", async () => {
      const { id } = await fromRaw(rawConvCreated(CONV, "+5491100000001", "Cliente Ficticio A", "open", ["cronico_mensual"]));
      const r = await processWebhookEvent(id);
      assert.equal(r.status, "PROCESSED");
      const conv = await prisma.conversation.findUnique({ where: { externalConversationId: String(CONV) }, include: { customer: true, stateHistory: true } });
      assert.ok(conv, "conversación creada");
      assert.equal(conv!.externalConversationId, "39099"); // id numérico → string
      assert.equal(conv!.status, "SIN_ASIGNAR"); // open sin assignee
      assert.equal(conv!.customer.phone, "+5491100000001");
      assert.deepEqual(conv!.externalLabels, ["cronico_mensual"]);
      assert.equal(conv!.stateHistory.length, 1);
      assert.ok(conv!.firstResponseAt, "firstResponseAt parseado del ISO");
      const we = await prisma.webhookEvent.findUnique({ where: { id } });
      assert.equal(we!.payload, null, "payload nuleado tras PROCESSED");
    });

    // 2. message_created incoming (CUSTOMER) + outgoing privado (OPERATOR, isPrivate); sentAt ISO
    await check("2. message_created (incoming CUSTOMER + outgoing privado OPERATOR)", async () => {
      const inc = await fromRaw(rawMsg({ convId: CONV, msgId: 25003330, sourceId: "wamid-1", mt: "incoming", content: "hola, consulta", senderId: 555, senderType: null }));
      assert.equal((await processWebhookEvent(inc.id)).status, "PROCESSED");
      const priv = await fromRaw(rawMsg({ convId: CONV, msgId: 25003331, sourceId: null, mt: "outgoing", content: "nota interna", isPrivate: true, senderId: 42, senderType: "user" }));
      assert.equal((await processWebhookEvent(priv.id)).status, "PROCESSED");
      const mInc = await prisma.conversationMessage.findUnique({ where: { externalMessageId: "wamid-1" } });
      assert.ok(mInc); assert.equal(mInc!.author, "CUSTOMER");
      assert.ok(mInc!.sentAt.getTime() === new Date(ISO).getTime(), "sentAt parseado del ISO (no 1970)");
      const mPriv = await prisma.conversationMessage.findUnique({ where: { externalMessageId: "emozion-message:25003331" } });
      assert.ok(mPriv); assert.equal(mPriv!.author, "OPERATOR"); assert.equal(mPriv!.isPrivate, true);
    });

    // 3. idempotencia (repetido secuencial + concurrente)
    await check("3. message_created idempotente (repetido + concurrente)", async () => {
      const dup = await fromRaw(rawMsg({ convId: CONV, msgId: 25003330, sourceId: "wamid-1", mt: "incoming", content: "hola, consulta", senderId: 555, senderType: null }));
      await processWebhookEvent(dup.id);
      assert.equal(await prisma.conversationMessage.count({ where: { externalMessageId: "wamid-1" } }), 1, "repetido no duplica");
      const c1 = await fromRaw(rawMsg({ convId: CONV, msgId: 9001, sourceId: "wamid-conc", mt: "incoming", content: "x", senderId: 555, senderType: null }));
      const c2 = await fromRaw(rawMsg({ convId: CONV, msgId: 9001, sourceId: "wamid-conc", mt: "incoming", content: "x", senderId: 555, senderType: null }));
      const [r1, r2] = await Promise.all([processWebhookEvent(c1.id), processWebhookEvent(c2.id)]);
      assert.equal(await prisma.conversationMessage.count({ where: { externalMessageId: "wamid-conc" } }), 1, "concurrente no duplica (P2002 manejado)");
      assert.ok(r1.status === "PROCESSED" && r2.status === "PROCESSED");
    });

    // 4. DEFENSA CONSERVADORA: message_created SIN conversación embebida → needsRetry, sin dominio parcial
    await check("4. message huérfano (sin conversation) → ERROR needsRetry, sin dominio parcial", async () => {
      const { id } = await fromRaw(rawMsg({ convId: null, msgId: 70001, sourceId: "wamid-orphan", mt: "incoming", content: "huerfano", senderId: 555, senderType: null, embedConv: false }));
      const r = await processWebhookEvent(id);
      assert.equal(r.status, "ERROR");
      assert.equal(r.outcome, "needsRetry");
      const we = await prisma.webhookEvent.findUnique({ where: { id } });
      assert.ok(we!.payload !== null, "payload conservado");
      assert.equal(await prisma.conversationMessage.count({ where: { externalMessageId: "wamid-orphan" } }), 0, "no se creó mensaje");
    });

    // 4b. AUTO-HEAL: message_created con conversación embebida de una conv que NO existe aún →
    //     crea la conversación mínima + el mensaje (fuera de orden self-healing).
    await check("4b. message_created con conv embebida inexistente → crea mínima + mensaje", async () => {
      const NEW = 50000;
      const { id } = await fromRaw(rawMsg({ convId: NEW, msgId: 70002, sourceId: "wamid-heal", mt: "incoming", content: "hola", senderId: 556, senderType: null, phone: "+5491100008888" }));
      assert.equal((await processWebhookEvent(id)).status, "PROCESSED");
      assert.equal(await prisma.conversation.count({ where: { externalConversationId: String(NEW) } }), 1, "conversación mínima creada");
      assert.ok(await prisma.conversationMessage.findUnique({ where: { externalMessageId: "wamid-heal" } }), "mensaje creado");
    });

    // 5. conversation_status_changed (raw real) → actualiza status + StateHistory
    await check("5. conversation_status_changed (raw real) → RESUELTA + StateHistory", async () => {
      const { id } = await fromRaw(rawConvCreated(CONV, "+5491100000001", "Cliente Ficticio A", "resolved", [], null, "conversation_status_changed"));
      assert.equal((await processWebhookEvent(id)).status, "PROCESSED");
      const conv = await prisma.conversation.findUnique({ where: { externalConversationId: String(CONV) }, include: { stateHistory: true } });
      assert.equal(conv!.status, "RESUELTA"); assert.ok(conv!.closedAt);
      assert.ok(conv!.stateHistory.some((h) => h.toStatus === "RESUELTA"));
    });

    // 6. fallo de dominio → WebhookEvent ERROR + SyncLog ERROR persisten (rollback del dominio)
    await check("6. fallo de dominio → ERROR persiste; dominio rolled back", async () => {
      // status inválido (no producible por el mapper) → fuerza error de Prisma DENTRO de la tx.
      const bad = { event: "conversation_created", conversation: { externalConversationId: "88001", status: "NOPE_INVALID", source: "EMOZION", customerPhoneSnapshot: "+5491100000099", firstResponseAt: null, closedAt: null, externalCreatedAt: null, externalLabels: [], contact: { phone: "+5491100000099", displayName: "X" } } };
      const id = await fromNormalized("conversation_created", bad, "88001");
      const r = await processWebhookEvent(id);
      assert.equal(r.status, "ERROR");
      const we = await prisma.webhookEvent.findUnique({ where: { id } });
      assert.equal(we!.status, "ERROR"); assert.ok((we!.attempts ?? 0) >= 1);
      assert.ok(await prisma.syncLog.findFirst({ where: { source: "EMOZION", status: "ERROR" } }), "SyncLog ERROR persiste");
      assert.equal(await prisma.conversation.count({ where: { externalConversationId: "88001" } }), 0, "dominio rolled back");
      assert.equal(await prisma.customer.count({ where: { phone: "+5491100000099" } }), 0, "customer rolled back");
    });

    // 7. P2002 discrimina constraint (UNIT determinístico): phone NO idempotente; ext* SÍ
    await check("7. P2002 discrimina constraint (phone→ERROR; externalIds→idempotente)", () => {
      const mk = (target: unknown) => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0", meta: { target } } as any);
      assert.equal(isDomainIdempotencyUniqueViolation(mk(["externalMessageId"])), true);
      assert.equal(isDomainIdempotencyUniqueViolation(mk(["externalConversationId"])), true);
      assert.equal(isDomainIdempotencyUniqueViolation(mk("ConversationMessage_externalMessageId_key")), true);
      assert.equal(isDomainIdempotencyUniqueViolation(mk(["phone"])), false);
      assert.equal(isDomainIdempotencyUniqueViolation(mk("Customer_phone_key")), false);
      const noMeta = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "5.22.0" } as any);
      assert.equal(isDomainIdempotencyUniqueViolation(noMeta), false);
      assert.deepEqual(getUniqueViolationTarget(noMeta), []);
      assert.equal(getUniqueViolationTarget(new Prisma.PrismaClientKnownRequestError("x", { code: "P2025", clientVersion: "5.22.0" } as any)), null);
    });

    // 8. phone P2002 vía processor (concurrencia) → invariante: PROCESSED⇒conv existe; 1 Customer
    await check("8. phone compartido concurrente → invariante de seguridad (sin marca de éxito sin dominio)", async () => {
      const phone = "+5491100007777";
      const N = 6;
      const ids: string[] = [];
      for (let i = 0; i < N; i++) ids.push((await fromRaw(rawConvCreated(60000 + i, phone, "Recurrente", "open", []))).id);
      await Promise.all(ids.map((id) => processWebhookEvent(id)));
      assert.equal(await prisma.customer.count({ where: { phone } }), 1, "un solo Customer para el phone compartido");
      let processedCount = 0, errorCount = 0;
      for (let i = 0; i < N; i++) {
        const we = await prisma.webhookEvent.findUnique({ where: { id: ids[i] } });
        const convExists = (await prisma.conversation.count({ where: { externalConversationId: String(60000 + i) } })) > 0;
        if (we!.status === "PROCESSED") { processedCount++; assert.ok(convExists, `PROCESSED ⇒ conv existe (${60000 + i})`); }
        else { errorCount++; assert.equal(we!.status, "ERROR"); assert.ok(!convExists, `ERROR ⇒ sin conv parcial (${60000 + i})`); }
      }
      assert.equal(await prisma.conversation.count({ where: { customerPhoneSnapshot: phone } }), processedCount, "conv creadas == PROCESSED");
      console.log(`   (concurrencia: ${processedCount} PROCESSED, ${errorCount} ERROR)`);
    });

    // 9. CONSISTENCIA: conversation_created con ids discrepantes → handler-mapping ERROR, sin dominio
    await check("9. ids de conversación discrepantes → ERROR de mapeo, sin dominio", async () => {
      const raw = rawConvCreated(39099, "+5491100000004", "Cliente", "open", []);
      (raw as any).messages = [{ account_id: 22, conversation_id: 88888 }]; // ≠ id top-level
      const { id, builtStatus } = await fromRaw(raw);
      assert.equal(builtStatus, "ERROR", "buildFromRaw marca ERROR (no se mapea con id ambiguo)");
      const we = await prisma.webhookEvent.findUnique({ where: { id } });
      assert.equal(we!.status, "ERROR");
      assert.equal(await prisma.conversation.count({ where: { externalConversationId: "88888" } }), 0, "no se creó conversación con id ambiguo");
    });

    // Verificación agregada + salida sanitizada
    console.log("\n== verificación agregada (sanitizada) ==");
    const customers = await prisma.customer.findMany({ select: { phone: true, displayName: true } });
    console.log("customers:", customers.map((c) => ({ phone: last4(c.phone), name: c.displayName ? "present" : "null" })));
    const msgs = await prisma.conversationMessage.findMany({ select: { author: true, body: true, isPrivate: true } });
    console.log("messages:", msgs.map((x) => ({ author: x.author, bodyLen: x.body?.length ?? 0, isPrivate: x.isPrivate })));
    const syncSucc = await prisma.syncLog.count({ where: { status: "SUCCESS" } });
    const syncErrC = await prisma.syncLog.count({ where: { status: { in: ["ERROR", "PARTIAL"] } } });
    console.log(`SyncLog SUCCESS=${syncSucc} ERROR/PARTIAL=${syncErrC}`);
    await check("SyncLog se crea para éxito y para fallo", () => { assert.ok(syncSucc >= 1 && syncErrC >= 1); });
  } finally {
    await (await import("../prisma")).prisma.$disconnect().catch(() => {});
    console.log("\n== teardown ==");
    try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); console.log("teardown OK — DB efímera eliminada."); }
    catch (e) { console.error(`TEARDOWN FAILED: borrar manualmente "${TEST_DB}". ${e instanceof Error ? e.message : String(e)}`); }
  }

  console.log(`\nprocessor.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  try { await adminExec(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); } catch (te) { console.error(`TEARDOWN FAILED: borrar "${TEST_DB}". ${te instanceof Error ? te.message : String(te)}`); }
  process.exit(1);
});
