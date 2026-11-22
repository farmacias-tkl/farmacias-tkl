/**
 * SMOKE de las consultas de operadores contra una base Postgres LOCAL EFÍMERA (nunca Neon).
 * Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/accounts.smoke.ts
 */
import assert from "node:assert/strict";
import type { PrismaClient, ConversationMessageAuthor } from "@prisma/client";
import { withEphemeralDb } from "./smoke-db";

const at = (s: string) => new Date(`${s}:00.000-03:00`);

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Msg = { author: ConversationMessageAuthor; t: string; isPrivate?: boolean; sender?: string };
let seq = 0;
async function conv(prisma: PrismaClient, key: string, created: string, msgs: Msg[]) {
  const customer = await prisma.customer.create({ data: { phone: `+54911000001${String(++seq).padStart(2, "0")}` } });
  const c = await prisma.conversation.create({
    data: { customerId: customer.id, status: "RESUELTA", source: "EMOZION", externalConversationId: `o-${key}`, createdAt: at(created) },
  });
  for (const m of msgs) {
    await prisma.conversationMessage.create({
      data: {
        conversationId: c.id, author: m.author, body: "texto inventado de relleno", isPrivate: !!m.isPrivate,
        sentAt: at(m.t), externalSenderId: m.sender ?? null, externalMessageId: `o-msg-${++seq}`,
      },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_accounts_smoke", async (prisma) => {
    const { loadOperatorMessages, loadFollowupBlocks } = await import("./accounts");
    const ids: Record<string, string> = {};

    // Dos bloques del cliente posteriores a una respuesta; el cliente insiste dentro del segundo.
    ids.a = await conv(prisma, "a", "2026-03-02T10:00", [
      { author: "CUSTOMER", t: "2026-03-02T10:00" },                 // primer bloque: NO es respuesta posterior
      { author: "BOT", t: "2026-03-02T10:01" },
      { author: "OPERATOR", t: "2026-03-02T10:30", sender: "9001" },
      { author: "CUSTOMER", t: "2026-03-02T10:40" },                 // bloque 1
      { author: "OPERATOR", t: "2026-03-02T10:41", isPrivate: true, sender: "9002" }, // nota: no responde ni corta el bloque
      { author: "OPERATOR", t: "2026-03-02T10:45", sender: "9001" },
      { author: "OPERATOR", t: "2026-03-02T10:46", sender: "9001" },
      { author: "CUSTOMER", t: "2026-03-02T11:00" },                 // bloque 2
      { author: "CUSTOMER", t: "2026-03-02T11:05" },                 // insiste: no reinicia la espera
      { author: "OPERATOR", t: "2026-03-02T11:20", sender: "9002" },
      { author: "CUSTOMER", t: "2026-03-02T11:30" },                 // bloque 3: sin respuesta
    ]);
    // Conversación de la semana anterior con un bloque que empieza dentro del período.
    ids.b = await conv(prisma, "b", "2026-02-25T15:00", [
      { author: "CUSTOMER", t: "2026-02-25T15:00" },
      { author: "OPERATOR", t: "2026-02-25T15:30", sender: "9001" },
      { author: "CUSTOMER", t: "2026-03-01T23:50" },                 // bloque que empieza ANTES del período
      { author: "OPERATOR", t: "2026-03-02T09:05", sender: "9001" }, // mensaje dentro del período
      { author: "CUSTOMER", t: "2026-03-03T23:59" },                 // bloque dentro del período, sin respuesta
    ]);
    // Fuera del período por los dos lados.
    ids.c = await conv(prisma, "c", "2026-03-04T00:00", [
      { author: "CUSTOMER", t: "2026-03-04T00:00" }, { author: "OPERATOR", t: "2026-03-04T00:10", sender: "9001" },
      { author: "CUSTOMER", t: "2026-03-04T00:20" }, { author: "OPERATOR", t: "2026-03-04T00:25", sender: "9001" },
    ]);

    const messages = await loadOperatorMessages("2026-03-02", "2026-03-03");
    const blocks = await loadFollowupBlocks("2026-03-02", "2026-03-03");
    const iso = (d: Date | null) => (d ? d.toISOString() : null);

    await check("mensajes de operador del período: públicos y notas, por cuenta; fuera del período no entran", () => {
      assert.equal(messages.length, 6);
      assert.equal(messages.filter((m) => m.isPrivate).length, 1);
      assert.equal(messages.filter((m) => m.account === "9001").length, 4);
      assert.equal(messages.filter((m) => m.account === "9002").length, 2);
      assert.equal(messages.some((m) => m.conversationId === ids.c), false);
    });
    await check("el mensaje de las 09:05 de una conversación de la semana anterior entra", () => {
      assert.ok(messages.some((m) => m.conversationId === ids.b && iso(m.sentAt) === iso(at("2026-03-02T09:05"))));
    });
    await check("bloques posteriores: el primer bloque de la conversación no cuenta", () => {
      const a = blocks.filter((b) => b.conversationId === ids.a).sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime());
      assert.equal(a.length, 3);
      assert.equal(iso(a[0].startedAt), iso(at("2026-03-02T10:40")));
    });
    await check("la nota interna no responde: la respuesta es el primer mensaje público siguiente", () => {
      const b = blocks.find((x) => x.conversationId === ids.a && iso(x.startedAt) === iso(at("2026-03-02T10:40")))!;
      assert.equal(iso(b.respondedAt), iso(at("2026-03-02T10:45")));
      assert.equal(b.account, "9001");
    });
    await check("si el cliente insiste la espera no se reinicia; responde otra cuenta", () => {
      const b = blocks.find((x) => x.conversationId === ids.a && iso(x.startedAt) === iso(at("2026-03-02T11:00")))!;
      assert.equal(iso(b.respondedAt), iso(at("2026-03-02T11:20")));
      assert.equal(b.account, "9002");
      assert.equal(blocks.some((x) => iso(x.startedAt) === iso(at("2026-03-02T11:05"))), false);
    });
    await check("bloques sin respuesta: quedan con respuesta null", () => {
      const sin = blocks.filter((b) => b.respondedAt === null);
      assert.equal(sin.length, 2);
      assert.ok(sin.some((b) => b.conversationId === ids.b && iso(b.startedAt) === iso(at("2026-03-03T23:59"))));
    });
    await check("un bloque que empezó antes del período no entra, aunque su respuesta sí caiga adentro", () => {
      assert.equal(blocks.some((b) => iso(b.startedAt) === iso(at("2026-03-01T23:50"))), false);
      assert.equal(blocks.length, 4);
    });
    await check("por actividad: una fila por día y conversación; la nota interna no cuenta y el día es el de Buenos Aires", async () => {
      const { loadDailyActivityRows, loadActivityReport } = await import("./activity");
      const rows = await loadDailyActivityRows("2026-03-02", "2026-03-03");
      const pick = (day: string, id: string) => rows.find((r) => r.day === day && r.conversationId === id);
      assert.equal(rows.length, 3);
      assert.deepEqual([pick("2026-03-02", ids.a)!.customer, pick("2026-03-02", ids.a)!.operator], [true, true]);
      // El cliente escribió a las 23:50 del 01/03 (fuera del período): el 02/03 solo hay operador.
      assert.deepEqual([pick("2026-03-02", ids.b)!.customer, pick("2026-03-02", ids.b)!.operator], [false, true]);
      // 23:59 del 03/03 en Buenos Aires ya es 04/03 en UTC: tiene que quedar en el 03/03.
      assert.deepEqual([pick("2026-03-03", ids.b)!.customer, pick("2026-03-03", ids.b)!.operator], [true, false]);
      assert.equal(rows.some((r) => r.conversationId === ids.c), false);

      const rep = await loadActivityReport("2026-03-02", "2026-03-03");
      assert.deepEqual(rep.days.map((d) => [d.day, d.activeCustomer, d.attended]), [["2026-03-02", 1, 2], ["2026-03-03", 1, 0]]);
      assert.deepEqual(rep.period, { activeCustomer: 2, attended: 2 });
      assert.deepEqual([rep.followups.blocks, rep.followups.answered, rep.followups.unanswered], [4, 2, 2]);
      assert.equal(rep.followups.response.median, 12.5); // 5 y 20 minutos
      const dump = JSON.stringify(rep);
      for (const id of Object.values(ids)) assert.ok(!dump.includes(id), "el informe no lleva ids de conversación");
    });
    await check("las filas no traen teléfono ni texto", () => {
      const dump = JSON.stringify([messages, blocks]);
      assert.ok(!dump.includes("+549"));
      assert.ok(!dump.includes("relleno"));
    });
  });

  console.log(`\nmetrics/accounts.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
