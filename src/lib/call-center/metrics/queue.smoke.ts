/**
 * SMOKE de la consulta de la cola contra una base Postgres LOCAL EFÍMERA (nunca Neon).
 * Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/queue.smoke.ts
 */
import assert from "node:assert/strict";
import type { PrismaClient, ConversationStatus, ConversationMessageAuthor } from "@prisma/client";
import { withEphemeralDb } from "./smoke-db";

const NOW = new Date("2026-03-10T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Msg = { author: ConversationMessageAuthor; h: number; body?: string | null; isPrivate?: boolean; mediaType?: string };
let seq = 0;

async function conv(prisma: PrismaClient, key: string, o: {
  phone: string; status: ConversationStatus; createdH: number; botExitH?: number | null; resolvedH?: number; msgs: Msg[];
}) {
  const customer = await prisma.customer.upsert({ where: { phone: o.phone }, update: {}, create: { phone: o.phone } });
  const c = await prisma.conversation.create({
    data: { customerId: customer.id, status: o.status, source: "EMOZION", externalConversationId: `q-${key}`, createdAt: hoursAgo(o.createdH) },
  });
  if (o.botExitH != null) {
    await prisma.conversationStateHistory.create({
      data: { conversationId: c.id, fromStatus: "PENDIENTE", toStatus: "SIN_ASIGNAR", changedAt: hoursAgo(o.botExitH) },
    });
  }
  if (o.resolvedH != null) {
    await prisma.conversationStateHistory.create({
      data: { conversationId: c.id, fromStatus: "SIN_ASIGNAR", toStatus: "RESUELTA", changedAt: hoursAgo(o.resolvedH) },
    });
  }
  for (const m of o.msgs) {
    await prisma.conversationMessage.create({
      data: {
        conversationId: c.id, author: m.author, body: m.body === undefined ? "texto inventado" : m.body,
        isPrivate: !!m.isPrivate, mediaType: m.mediaType ?? null, sentAt: hoursAgo(m.h), externalMessageId: `q-msg-${++seq}`,
      },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_queue_smoke", async (prisma) => {
    const { loadWaitingRows, buildQueueSnapshot, countClosedUnansweredBefore } = await import("./queue");
    const ids: Record<string, string> = {};
    const LONG = "Necesito saber si tienen el producto inventado en la sucursal más cercana, gracias.";

    // Respondida y cerrada por el operador: NO espera.
    ids.respondida = await conv(prisma, "respondida", { phone: "+5491100000001", status: "RESUELTA", createdH: 30, botExitH: 29.9, resolvedH: 20, msgs: [
      { author: "CUSTOMER", h: 30 }, { author: "BOT", h: 29.95 }, { author: "OPERATOR", h: 28 }, { author: "CUSTOMER", h: 27 }, { author: "OPERATOR", h: 26 },
    ] });
    // Abierta, nunca respondida, con pedido completo en el bot.
    ids.abiertaPedido = await conv(prisma, "abierta-pedido", { phone: "+5491100000002", status: "SIN_ASIGNAR", createdH: 3, botExitH: 2.9, msgs: [
      { author: "CUSTOMER", h: 3, body: LONG }, { author: "BOT", h: 2.95, body: "¿Tu pedido es con cobertura médica o lo abonás de forma particular?" }, { author: "BOT", h: 2.9, body: "✅ ¡Listo! Mensaje final inventado." }, { author: "CUSTOMER", h: 2.5, body: "sigo acá" }, { author: "CUSTOMER", h: 1, body: "es urgente, hay alguien" },
    ] });
    // Abierta, respondida, el cliente volvió a escribir dos veces: espera desde el PRIMER mensaje del bloque.
    ids.abiertaSiguiente = await conv(prisma, "abierta-siguiente", { phone: "+5491100000003", status: "ASIGNADA", createdH: 10, botExitH: 9.9, msgs: [
      { author: "CUSTOMER", h: 10, body: LONG }, { author: "OPERATOR", h: 8 }, { author: "CUSTOMER", h: 6, body: LONG }, { author: "CUSTOMER", h: 5, body: "hola?" },
    ] });
    // Abierta hace 45 días, sin salida del bot registrada.
    ids.abiertaVieja = await conv(prisma, "abierta-vieja", { phone: "+5491100000004", status: "PENDIENTE", createdH: 24 * 45, botExitH: null, msgs: [
      { author: "CUSTOMER", h: 24 * 45, body: LONG },
    ] });
    // Cerrada sin respuesta: agradecimiento corto del cliente de "respondida" (cierre previo hace menos de 24 h).
    ids.gracias = await conv(prisma, "gracias", { phone: "+5491100000001", status: "RESUELTA", createdH: 12, botExitH: 11.8, resolvedH: 11, msgs: [
      { author: "CUSTOMER", h: 12, body: "Gracias!" }, { author: "BOT", h: 11.99 },
    ] });
    // Igual, pero con una foto: NO es candidato.
    ids.graciasFoto = await conv(prisma, "gracias-foto", { phone: "+5491100000001", status: "RESUELTA", createdH: 9, botExitH: 8.8, resolvedH: 8, msgs: [
      { author: "CUSTOMER", h: 9, body: null, mediaType: "image" },
    ] });
    // Cerrada sin respuesta, mensaje largo, sin cierre previo: pendiente común. El bot mandó su
    // mensaje final por el camino "Asesor" (sin recorrido de pedido): NO es un pedido completo.
    ids.cerradaSinResp = await conv(prisma, "cerrada-sin-resp", { phone: "+5491100000005", status: "RESUELTA", createdH: 100, botExitH: 99.8, resolvedH: 90, msgs: [
      { author: "CUSTOMER", h: 100.1, body: "Asesor" }, { author: "CUSTOMER", h: 100, body: LONG }, { author: "BOT", h: 99.9, body: "✅ ¡Listo! Mensaje final inventado." },
    ] });
    // La nota interna del operador NO cuenta como respuesta.
    ids.soloNota = await conv(prisma, "solo-nota", { phone: "+5491100000006", status: "RESUELTA", createdH: 6, botExitH: 5.9, resolvedH: 4, msgs: [
      { author: "CUSTOMER", h: 6, body: LONG }, { author: "OPERATOR", h: 5, isPrivate: true },
    ] });
    // Solo mensajes del bot, sin cliente: no hay nadie esperando.
    ids.soloBot = await conv(prisma, "solo-bot", { phone: "+5491100000007", status: "SIN_ASIGNAR", createdH: 2, botExitH: 1.9, msgs: [{ author: "BOT", h: 2 }] });
    // Cerrada sin respuesta de hace 60 días: fuera de la ventana de la cola, entra en el histórico.
    ids.historica = await conv(prisma, "historica", { phone: "+5491100000008", status: "RESUELTA", createdH: 24 * 60, botExitH: 24 * 60 - 0.1, resolvedH: 24 * 59, msgs: [
      { author: "CUSTOMER", h: 24 * 60, body: LONG }, { author: "BOT", h: 24 * 60 - 0.02, body: "¿Tu pedido es con cobertura médica o lo abonás de forma particular?" }, { author: "BOT", h: 24 * 60 - 0.05, body: "✅ ¡Listo! Mensaje final inventado." },
    ] });

    const since = hoursAgo(24 * 30);
    const rows = await loadWaitingRows(since);
    const byId = new Map(rows.map((r) => [r.conversationId, r]));
    const snap = buildQueueSnapshot(rows, NOW, since);

    await check("no esperan: la respondida por último por el operador y la que solo tiene mensajes del bot", () => {
      assert.equal(byId.has(ids.respondida), false);
      assert.equal(byId.has(ids.soloBot), false);
    });
    await check("la cerrada de hace 60 días queda fuera de la ventana de la cola", () => {
      assert.equal(byId.has(ids.historica), false);
    });
    await check("abierta de hace 45 días, sin salida del bot: entra igual", () => {
      const r = byId.get(ids.abiertaVieja)!;
      assert.equal(r.open, true);
      assert.equal(r.botExitAt, null);
      assert.equal(r.hasHumanResponse, false);
    });
    await check("pedido completo en el bot, nunca respondido", () => {
      assert.equal(byId.get(ids.cerradaSinResp)!.botOrderComplete, false, "el mensaje final por el camino Asesor no es un pedido completo");
      const r = byId.get(ids.abiertaPedido)!;
      assert.equal(r.botOrderComplete, true);
      assert.equal(r.hasHumanResponse, false);
      assert.equal(r.waitStart.getTime(), hoursAgo(3).getTime());
      assert.equal(r.botExitAt?.getTime(), hoursAgo(2.9).getTime());
      // Pide urgencia, y escribió dos veces después del bot con más de 10 minutos de diferencia, sin respuesta.
      assert.deepEqual([r.urgent, r.insisting], [true, true]);
      assert.equal(r.lastCustomerAt.getTime(), hoursAgo(1).getTime());
    });
    await check("esperando la siguiente respuesta: la espera arranca en el primer mensaje del bloque", () => {
      const r = byId.get(ids.abiertaSiguiente)!;
      assert.equal(r.hasHumanResponse, true);
      assert.equal(r.waitStart.getTime(), hoursAgo(6).getTime());
      // Dos mensajes separados por una hora, pero sin recorrido del bot completo: no cuenta como insistencia.
      assert.deepEqual([r.urgent, r.insisting], [false, false]);
      // La ventana de WhatsApp corre desde el ÚLTIMO mensaje del cliente, no desde el inicio del bloque.
      assert.equal(r.lastCustomerAt.getTime(), hoursAgo(5).getTime());
    });
    await check("agradecimiento corto tras un cierre: candidato; con foto: no", () => {
      const g = snap.items.find((i) => i.conversationId === ids.gracias)!;
      assert.equal(g.previousResolvedRecently, true);
      assert.equal(g.customerChars, 8);
      assert.equal(g.thanksCandidate, true);
      const f = snap.items.find((i) => i.conversationId === ids.graciasFoto)!;
      assert.equal(f.customerSentMedia, true);
      assert.equal(f.thanksCandidate, false);
    });
    await check("la nota interna no cuenta como respuesta de una persona", () => {
      assert.equal(byId.get(ids.soloNota)!.hasHumanResponse, false);
    });
    await check("totales: 3 abiertas esperando y 4 cerradas sin respuesta; los candidatos no se restan", () => {
      assert.equal(snap.openWaiting.total, 3);
      assert.equal(snap.openWaiting.neverHuman, 2);
      assert.equal(snap.openWaiting.awaitingNext, 1);
      assert.equal(snap.openWaiting.completedOrders, 1);
      assert.equal(snap.openWaiting.noBotExit, 1);
      assert.equal(snap.openOlderThanListWindow, 1);
      assert.equal(snap.closedUnanswered.total, 4);
      assert.equal(snap.closedUnanswered.neverHuman, 4);
      assert.equal(snap.closedUnanswered.thanksCandidates, 1);
      assert.equal(snap.closedUnanswered.byAge.d3to30, 1);
    });
    await check("histórico anterior a la ventana: la cerrada de hace 60 días, con pedido completo", async () => {
      const h = await countClosedUnansweredBefore(since);
      assert.equal(h.total, 1);
      assert.equal(h.neverHuman, 1);
      assert.equal(h.completedOrders, 1);
    });
    await check("calidad de datos: eventos sin procesar, salida del bot y cuentas sin configurar de los últimos 7 días", async () => {
      const { loadQualityChecks, unknownAccountsOf } = await import("./quality");
      await prisma.webhookEvent.create({ data: { eventType: "message_created", accountId: 22, status: "ERROR", receivedAt: hoursAgo(5) } });
      await prisma.webhookEvent.create({ data: { eventType: "message_created", accountId: 22, status: "PROCESSED", receivedAt: hoursAgo(5) } });
      await prisma.webhookEvent.create({ data: { eventType: "message_created", accountId: 22, status: "ERROR", receivedAt: hoursAgo(24 * 20) } });
      await prisma.conversationMessage.create({ data: { conversationId: ids.respondida, author: "OPERATOR", externalSenderId: "9001", body: "x", sentAt: hoursAgo(3), externalMessageId: "q-cuenta-1" } });
      await prisma.conversationMessage.create({ data: { conversationId: ids.respondida, author: "OPERATOR", externalSenderId: "9002", body: "x", sentAt: hoursAgo(2), externalMessageId: "q-cuenta-2" } });
      const acc = { externalId: "9001", alias: null, active: true, borrowed: false, historical: false };
      const q = await loadQualityChecks(NOW, [acc]);
      assert.deepEqual(q.events, { error: 1, received: 0, total: 2 });
      // 8 conversaciones creadas en los últimos 7 días, todas con salida del bot; la de 45 días y la de 60 quedan afuera.
      assert.deepEqual(q.botExit, { entries: 8, withExit: 8 });
      assert.deepEqual([q.unknownAccounts, q.salesLastDay, q.days], [["9002"], null, 7]);
      assert.equal((await loadQualityChecks(NOW, null)).unknownAccounts, null, "sin configuración no se sabe qué falta");
      assert.deepEqual(unknownAccountsOf(["10", "9", "9", "2"], [{ ...acc, externalId: "9" }]), ["2", "10"]);
    });
    await check("asignado que es un bot: la fila trae la clave con prefijo; una persona con el mismo número, el id solo", async () => {
      await prisma.conversation.update({ where: { id: ids.abiertaPedido }, data: { externalAssigneeId: "9001", externalAssigneeType: "AGENT_BOT" } });
      await prisma.conversation.update({ where: { id: ids.abiertaSiguiente }, data: { externalAssigneeId: "9001", externalAssigneeType: "USER" } });
      await prisma.conversation.update({ where: { id: ids.abiertaVieja }, data: { externalAssigneeId: "9001", externalAssigneeType: null } });
      const again = new Map((await loadWaitingRows(since)).map((r) => [r.conversationId, r.externalAssigneeId]));
      assert.deepEqual([again.get(ids.abiertaPedido), again.get(ids.abiertaSiguiente), again.get(ids.abiertaVieja)], ["bot:9001", "9001", "9001"]);
      const { loadOpenOwnerRows } = await import("./owners");
      const owners = new Map((await loadOpenOwnerRows()).map((r) => [r.conversationId, r.externalAssigneeId]));
      assert.deepEqual([owners.get(ids.abiertaPedido), owners.get(ids.abiertaSiguiente), owners.get(ids.soloBot)], ["bot:9001", "9001", null]);
    });
    await check("las filas no traen teléfono ni texto", () => {
      const dump = JSON.stringify(rows);
      assert.ok(!dump.includes("+549"));
      assert.ok(!dump.includes("producto inventado"));
    });
  });

  console.log(`\nmetrics/queue.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
