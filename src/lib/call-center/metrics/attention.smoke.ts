/**
 * SMOKE de la consulta de atención y demoras contra una base Postgres LOCAL EFÍMERA
 * (nunca Neon). Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/attention.smoke.ts
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

type Msg = { author: ConversationMessageAuthor; t: string; body?: string | null; isPrivate?: boolean; mediaType?: string; sender?: string };
let seq = 0;
async function conv(prisma: PrismaClient, key: string, o: { phone: string; created: string; exit?: string; resolved?: string; msgs: Msg[] }) {
  const customer = await prisma.customer.upsert({ where: { phone: o.phone }, update: {}, create: { phone: o.phone } });
  const c = await prisma.conversation.create({
    data: { customerId: customer.id, status: "RESUELTA", source: "EMOZION", externalConversationId: `a-${key}`, createdAt: at(o.created) },
  });
  if (o.exit) await prisma.conversationStateHistory.create({ data: { conversationId: c.id, fromStatus: "PENDIENTE", toStatus: "SIN_ASIGNAR", changedAt: at(o.exit) } });
  if (o.resolved) await prisma.conversationStateHistory.create({ data: { conversationId: c.id, fromStatus: "SIN_ASIGNAR", toStatus: "RESUELTA", changedAt: at(o.resolved) } });
  for (const m of o.msgs) {
    await prisma.conversationMessage.create({
      data: {
        conversationId: c.id, author: m.author, body: m.body === undefined ? "texto inventado de relleno" : m.body,
        isPrivate: !!m.isPrivate, mediaType: m.mediaType ?? null, sentAt: at(m.t),
        externalSenderId: m.sender ?? null, externalMessageId: `a-msg-${++seq}`,
      },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_attention_smoke", async (prisma) => {
    const { loadEntryRows, buildAttentionReport } = await import("./attention");
    const ids: Record<string, string> = {};

    // Pedido completo en el bot, respondido por la cuenta 9001; la nota interna previa no cuenta.
    ids.pedido = await conv(prisma, "pedido", { phone: "+5491100000001", created: "2026-03-02T10:00", exit: "2026-03-02T10:03", resolved: "2026-03-02T11:00", msgs: [
      { author: "CUSTOMER", t: "2026-03-02T10:00", body: "Pedir medicamentos" },
      { author: "BOT", t: "2026-03-02T10:01", body: "¿Tu pedido es con cobertura médica o lo abonás de forma particular?" },
      { author: "BOT", t: "2026-03-02T10:03", body: "✅ ¡Listo! Mensaje final inventado." },
      { author: "OPERATOR", t: "2026-03-02T10:05", isPrivate: true, sender: "9002" },
      { author: "OPERATOR", t: "2026-03-02T10:20", sender: "9001" },
      { author: "OPERATOR", t: "2026-03-02T10:25", sender: "9002" },
    ] });
    // Meducar por el primer mensaje; sin respuesta.
    ids.meducar = await conv(prisma, "meducar", { phone: "+5491100000002", created: "2026-03-02T12:00", exit: "2026-03-02T12:11", msgs: [
      { author: "CUSTOMER", t: "2026-03-02T12:00", body: "Hola, quiero realizar un pedido sobre esta receta https://cdn.meducar.com/r/inventado.pdf" },
      { author: "BOT", t: "2026-03-02T12:00" },
    ] });
    // Menciona Meducar más adelante, no en el primer mensaje: no es Meducar.
    ids.mencion = await conv(prisma, "mencion", { phone: "+5491100000003", created: "2026-03-02T13:00", exit: "2026-03-02T13:11", msgs: [
      { author: "CUSTOMER", t: "2026-03-02T13:00", body: "Hola" },
      { author: "CUSTOMER", t: "2026-03-02T13:05", body: "quiero realizar un pedido sobre esta receta https://cdn.meducar.com/r/otro.pdf" },
    ] });
    // Agradecimiento del cliente de "pedido" tras su cierre: candidato.
    ids.gracias = await conv(prisma, "gracias", { phone: "+5491100000001", created: "2026-03-02T15:00", exit: "2026-03-02T15:11", resolved: "2026-03-02T16:00", msgs: [
      { author: "CUSTOMER", t: "2026-03-02T15:00", body: "Muchas gracias" },
    ] });
    // Sin salida del bot registrada y solo una foto del cliente.
    ids.sinSalida = await conv(prisma, "sin-salida", { phone: "+5491100000004", created: "2026-03-02T16:00", msgs: [
      { author: "CUSTOMER", t: "2026-03-02T16:00", body: null, mediaType: "image" },
    ] });
    // Conversación sin ningún mensaje.
    ids.vacia = await conv(prisma, "vacia", { phone: "+5491100000005", created: "2026-03-02T17:00", msgs: [] });
    // Borde del período: 23:59 del último día entra; 00:00 del siguiente y 23:59 del anterior no.
    ids.bordeDentro = await conv(prisma, "borde-dentro", { phone: "+5491100000006", created: "2026-03-03T23:59", msgs: [{ author: "CUSTOMER", t: "2026-03-03T23:59" }] });
    ids.bordeDespues = await conv(prisma, "borde-despues", { phone: "+5491100000007", created: "2026-03-04T00:00", msgs: [{ author: "CUSTOMER", t: "2026-03-04T00:00" }] });
    ids.bordeAntes = await conv(prisma, "borde-antes", { phone: "+5491100000008", created: "2026-03-01T23:59", msgs: [{ author: "CUSTOMER", t: "2026-03-01T23:59" }] });

    const rows = await loadEntryRows("2026-03-02", "2026-03-03");
    const byId = new Map(rows.map((r) => [r.conversationId, r]));

    await check("período en días de Buenos Aires, inclusive: entran 7 y quedan afuera los bordes", () => {
      assert.equal(rows.length, 7);
      assert.equal(byId.has(ids.bordeDentro), true);
      assert.equal(byId.has(ids.bordeDespues), false);
      assert.equal(byId.has(ids.bordeAntes), false);
    });
    await check("pedido: recorrido de pedido, mensaje final, salida del bot y primera respuesta pública", () => {
      const r = byId.get(ids.pedido)!;
      assert.equal(r.orderFlow, true);
      assert.equal(r.botOrderCompleteAt?.toISOString(), at("2026-03-02T10:03").toISOString());
      assert.equal(r.botExitAt?.toISOString(), at("2026-03-02T10:03").toISOString());
      assert.equal(r.firstHumanAt?.toISOString(), at("2026-03-02T10:20").toISOString()); // la nota de las 10:05 no cuenta
      assert.equal(r.firstHumanAccount, "9001");
      assert.equal(r.firstCustomerMessageIsMeducar, false);
    });
    await check("Meducar: solo por el primer mensaje del cliente", () => {
      assert.equal(byId.get(ids.meducar)!.firstCustomerMessageIsMeducar, true);
      assert.equal(byId.get(ids.mencion)!.firstCustomerMessageIsMeducar, false);
      assert.equal(byId.get(ids.meducar)!.customerSentLink, true);
    });
    await check("agradecimiento tras un cierre del mismo cliente en las 24 horas previas", () => {
      const r = byId.get(ids.gracias)!;
      assert.equal(r.previousResolvedRecently, true);
      assert.equal(r.customerChars, 14);
      assert.equal(byId.get(ids.pedido)!.previousResolvedRecently, false);
    });
    await check("sin salida del bot y con foto; conversación sin mensajes", () => {
      const s = byId.get(ids.sinSalida)!;
      assert.equal(s.botExitAt, null);
      assert.equal(s.customerSentMedia, true);
      assert.equal(s.customerChars, 0);
      const v = byId.get(ids.vacia)!;
      assert.equal(v.firstCustomerAt, null);
      assert.equal(v.firstHumanAt, null);
      assert.equal(v.orderFlow, false);
    });
    await check("informe de punta a punta: tipos de gestión, vías, pendientes y candidatos", () => {
      const rep = buildAttentionReport(rows, { now: at("2026-03-05T12:00"), from: "2026-03-02", to: "2026-03-03", versions: [] });
      assert.equal(rep.total.entries, 7);
      assert.deepEqual(rep.total.byManagementType, { MEDUCAR: 1, PEDIDO: 1, OTROS: 5 });
      assert.equal(rep.total.byBotExitPath.PEDIDO_COMPLETO.conversations, 1);
      assert.equal(rep.total.byBotExitPath.SIN_MENSAJE_FINAL.conversations, 3);
      assert.equal(rep.total.byBotExitPath.SIN_REGISTRO.conversations, 3);
      assert.equal(rep.total.answered, 1);
      assert.equal(rep.total.firstResponseClock.median, 17);
      assert.equal(rep.total.pending.total, 6);
      assert.equal(rep.total.pending.thanksCandidates, 1);
      assert.deepEqual(rep.days.map((d) => d.entries), [6, 1]);
    });
    await check("las filas no traen teléfono ni texto", () => {
      const dump = JSON.stringify(rows);
      assert.ok(!dump.includes("+549"));
      assert.ok(!/Muchas gracias|inventado\.pdf|relleno|Pedir medicamentos/i.test(dump));
    });
    await check("respuesta de la API: fechas como texto, sin ids de conversación ni datos del cliente, y caché por período", async () => {
      const { getAttentionPayload } = await import("./attention-service");
      const now = at("2026-03-05T12:00");
      const p = await getAttentionPayload("2026-03-02", "2026-03-03", now);
      assert.equal(p.total.entries, 7);
      assert.equal(typeof p.generatedAt, "string");
      assert.equal(typeof p.total.pending.oldestClockStart, "string");
      assert.equal(p.hasConfig, false);
      assert.equal(p.total.goal, null);
      // Por actividad: otra población, en la misma respuesta.
      assert.equal(p.activity.period.activeCustomer > 0, true);
      assert.equal(p.activity.days.every((d) => d.day >= "2026-03-02" && d.day <= "2026-03-03"), true);
      const dump = JSON.stringify(p);
      assert.ok(!dump.includes("+549"));
      for (const id of Object.values(ids)) assert.ok(!dump.includes(id), "sin ids de conversación");
      // Dentro del minuto devuelve el mismo objeto; otro período o pasado el minuto, se recalcula.
      assert.equal(await getAttentionPayload("2026-03-02", "2026-03-03", new Date(now.getTime() + 30_000)), p);
      assert.notEqual(await getAttentionPayload("2026-03-02", "2026-03-03", new Date(now.getTime() + 61_000)), p);
      assert.equal((await getAttentionPayload("2026-03-03", "2026-03-03", now)).total.entries, 1);
    });
  });

  console.log(`\nmetrics/attention.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
