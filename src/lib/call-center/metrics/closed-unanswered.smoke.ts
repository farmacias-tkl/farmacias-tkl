/**
 * SMOKE de "Cerradas sin responder" y de "Entraron hoy / Respondidos hoy" contra una base
 * Postgres LOCAL EFÍMERA (nunca Neon). Textos y teléfonos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/closed-unanswered.smoke.ts
 */
import assert from "node:assert/strict";
import type { PrismaClient, ConversationStatus, ConversationMessageAuthor } from "@prisma/client";
import { withEphemeralDb } from "./smoke-db";

const NOW = new Date("2026-03-10T18:00:00.000Z"); // 15:00 en Buenos Aires
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Msg = { author: ConversationMessageAuthor; h: number; body?: string | null; isPrivate?: boolean; mediaType?: string };
let seq = 0;

async function conv(prisma: PrismaClient, key: string, o: { status?: ConversationStatus; createdH: number; msgs: Msg[] }) {
  const phone = `+54911000001${String(++seq).padStart(2, "0")}`;
  const customer = await prisma.customer.create({ data: { phone } });
  const c = await prisma.conversation.create({
    data: { customerId: customer.id, status: o.status ?? "RESUELTA", source: "EMOZION", externalConversationId: `cu-${key}`, createdAt: hoursAgo(o.createdH) },
  });
  let n = 0;
  for (const m of o.msgs) {
    await prisma.conversationMessage.create({
      data: {
        conversationId: c.id, author: m.author, body: m.body === undefined ? "texto inventado" : m.body,
        isPrivate: !!m.isPrivate, mediaType: m.mediaType ?? null, sentAt: hoursAgo(m.h), externalMessageId: `cu-${key}-${++n}`,
      },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_closed_smoke", async (prisma) => {
    const { loadClosedBlockRows, classifyClosedBlock, buildClosedUnanswered } = await import("./closed-unanswered");
    const { loadToday } = await import("./now");
    const ids: Record<string, string> = {};
    const C = "CUSTOMER" as const, O = "OPERATOR" as const, B = "BOT" as const;

    ids.gracias = await conv(prisma, "gracias", { createdH: 30, msgs: [{ author: C, h: 30, body: "Hola" }, { author: O, h: 29 }, { author: C, h: 28, body: "Muchas gracias, paso mañana" }] });
    ids.pregunta = await conv(prisma, "pregunta", { createdH: 30, msgs: [{ author: C, h: 30, body: "Hola" }, { author: O, h: 29 }, { author: C, h: 28, body: "Y cuánto sale el producto inventado" }] });
    ids.signo = await conv(prisma, "signo", { createdH: 30, msgs: [{ author: C, h: 30, body: "Hola" }, { author: O, h: 29 }, { author: C, h: 28, body: "lo traen hoy?" }] });
    // La pregunta es anterior a la respuesta del operador: el último bloque es solo el agradecimiento.
    ids.preguntaVieja = await conv(prisma, "pregunta-vieja", { createdH: 30, msgs: [{ author: C, h: 30, body: "¿Tienen stock?" }, { author: O, h: 29 }, { author: C, h: 28, body: "Gracias" }] });
    ids.imagen = await conv(prisma, "imagen", { createdH: 30, msgs: [{ author: C, h: 30, body: "Hola" }, { author: O, h: 29 }, { author: C, h: 28, body: null, mediaType: "image" }] });
    ids.contacto = await conv(prisma, "contacto", { createdH: 30, msgs: [{ author: C, h: 30, body: "Hola" }, { author: O, h: 29 }, { author: C, h: 28, body: "Persona Inventada", mediaType: "contact" }] });
    ids.receta = await conv(prisma, "receta", { createdH: 20, msgs: [{ author: C, h: 20, body: "Hola, quiero realizar un pedido sobre esta receta: https://ejemplo.invalid/r" }, { author: B, h: 19.9 }] });
    ids.pedidoBot = await conv(prisma, "pedido-bot", { createdH: 20, msgs: [{ author: C, h: 20, body: "Pedir medicamentos" }, { author: B, h: 19.9, body: "✅ ¡Listo! Mensaje final inventado." }] });
    ids.yaCompre = await conv(prisma, "ya-compre", { createdH: 20, msgs: [{ author: C, h: 20, body: "Hola" }, { author: O, h: 19 }, { author: C, h: 18, body: "Gracias, ya fui y la compré" }] });
    ids.proveedor = await conv(prisma, "proveedor", { createdH: 20, msgs: [{ author: C, h: 20, body: "Somos fabricantes, ¿con quién hablo?" }, { author: C, h: 19.9, body: null, mediaType: "file" }] });
    ids.horarios = await conv(prisma, "horarios", { createdH: 20, msgs: [{ author: C, h: 20, body: "¿Qué horario tienen?" }, { author: B, h: 19.9, body: "Estas son nuestras sucursales: texto inventado" }] });
    // Nota interna: no cuenta como respuesta. El bloque es toda la conversación.
    ids.nota = await conv(prisma, "nota", { createdH: 20, msgs: [{ author: C, h: 20, body: "¿Me confirman el pedido?" }, { author: O, h: 19, isPrivate: true }] });
    // Fuera de alcance: respondida al final, abierta, y con el último mensaje hace más de 7 días.
    ids.respondida = await conv(prisma, "respondida", { createdH: 20, msgs: [{ author: C, h: 20, body: "¿Tienen stock?" }, { author: O, h: 19 }] });
    ids.abierta = await conv(prisma, "abierta", { status: "SIN_ASIGNAR", createdH: 20, msgs: [{ author: C, h: 20, body: "¿Tienen stock?" }] });
    ids.vieja = await conv(prisma, "vieja", { createdH: 24 * 9, msgs: [{ author: C, h: 24 * 9, body: "¿Tienen stock?" }] });
    // Creada hoy (Buenos Aires) con respuesta; "pregunta" y demás son de ayer o antes.
    ids.hoy = await conv(prisma, "hoy", { status: "ASIGNADA", createdH: 2, msgs: [{ author: C, h: 2, body: "Hola" }, { author: O, h: 1 }] });
    ids.hoySin = await conv(prisma, "hoy-sin", { status: "SIN_ASIGNAR", createdH: 14, msgs: [{ author: C, h: 14, body: "Hola" }, { author: O, h: 13, isPrivate: true }] });
    // Creada ayer y respondida hoy: no entró hoy, pero se atendió hoy.
    ids.atrasada = await conv(prisma, "atrasada", { status: "ASIGNADA", createdH: 40, msgs: [{ author: C, h: 40, body: "Hola" }, { author: O, h: 3 }] });
    // 23:30 de ayer en Buenos Aires: no es de hoy.
    ids.anoche = await conv(prisma, "anoche", { status: "SIN_ASIGNAR", createdH: 15.5, msgs: [{ author: C, h: 15.5, body: "Hola" }] });

    const rows = await loadClosedBlockRows(hoursAgo(24 * 30), hoursAgo(24 * 7));
    const cls = new Map(rows.map((r) => [r.conversationId, classifyClosedBlock(r)]));
    const of = (k: string) => cls.get(ids[k]);

    await check("fuera de alcance: respondida al final, abierta y último mensaje de hace más de 7 días", () => {
      assert.deepEqual([of("respondida"), of("abierta"), of("vieja")], [undefined, undefined, undefined]);
    });
    await check("agradecimiento y cierre natural: no entran", () => {
      assert.equal(of("gracias"), "NONE");
    });
    await check("consulta: por palabra con acento y por signo de pregunta", () => {
      assert.deepEqual([of("pregunta"), of("signo")], ["QUESTION", "QUESTION"]);
    });
    await check("solo se mira el último bloque: una pregunta ya respondida no cuenta", () => {
      assert.equal(of("preguntaVieja"), "NONE");
    });
    await check("imagen sola después de la respuesta: receta o comprobante; un contacto no es adjunto", () => {
      assert.deepEqual([of("imagen"), of("contacto")], ["ATTACHMENT", "NONE"]);
    });
    await check("pedido: frase de pedido con receta y pedido completo en el bot sin tomar", () => {
      assert.deepEqual([of("receta"), of("pedidoBot")], ["ORDER", "ORDER"]);
    });
    await check("ya compró: afuera; proveedor: no es cliente aunque pregunte y adjunte", () => {
      assert.deepEqual([of("yaCompre"), of("proveedor")], ["ALREADY_BOUGHT", "NOT_CUSTOMER"]);
    });
    await check("consulta que el bot ya contestó: no cuenta como sin responder", () => {
      assert.equal(of("horarios"), "BOT_ANSWERED");
    });
    await check("la nota interna no cuenta como respuesta", () => {
      assert.equal(of("nota"), "QUESTION");
    });
    await check("resumen: 3 consultas, 2 pedidos, 1 adjunto y 1 que no es cliente", () => {
      const r = buildClosedUnanswered(rows);
      assert.deepEqual([r.total, r.question, r.order, r.attachment, r.notCustomers], [6, 3, 2, 1, 1]);
    });
    await check("último mensaje del cliente: agradecimiento o cierre, sí; una pregunta, no", () => {
      const by = new Map(rows.map((r) => [r.conversationId, r]));
      assert.deepEqual([by.get(ids.gracias)!.lastMessageIsClosing, by.get(ids.pregunta)!.lastMessageIsClosing, by.get(ids.preguntaVieja)!.lastMessageIsClosing], [true, false, true]);
    });
    await check("abiertas: mismas marcas; un cierre parece resuelta, una pregunta o un cierre con foto siguen pendientes", async () => {
      const { loadOpenBlockRows, isProbablyClosed } = await import("./closed-unanswered");
      const abiertaGracias = await conv(prisma, "abierta-gracias", { status: "ASIGNADA", createdH: 200, msgs: [{ author: C, h: 200, body: "Hola" }, { author: O, h: 199 }, { author: C, h: 198, body: "Dale, gracias!" }] });
      const abiertaFoto = await conv(prisma, "abierta-foto", { status: "ASIGNADA", createdH: 200, msgs: [{ author: C, h: 200, body: "Hola" }, { author: O, h: 199 }, { author: C, h: 198.5, body: null, mediaType: "image" }, { author: C, h: 198, body: "Gracias" }] });
      const open = new Map((await loadOpenBlockRows()).map((r) => [r.conversationId, r]));
      assert.equal(open.has(ids.gracias), false, "las cerradas no entran");
      assert.equal(open.has(ids.hoy), false, "respondida al final: no espera");
      assert.deepEqual([isProbablyClosed(open.get(abiertaGracias)!), isProbablyClosed(open.get(abiertaFoto)!), isProbablyClosed(open.get(ids.abierta)!)], [true, false, false]);
    });
    await check("las filas no traen teléfono ni texto", () => {
      const dump = JSON.stringify(rows);
      assert.ok(!dump.includes("+549"));
      assert.ok(!/inventad|stock|gracias/i.test(dump));
    });
    await check("hoy: creadas desde las 00:00 de Buenos Aires y, de esas, las respondidas por una persona", async () => {
      // Atendidas hoy: "hoy" más las de ayer que recibieron una respuesta pública hoy.
      assert.deepEqual(await loadToday(NOW), { entered: 2, answered: 1, attended: 2 });
    });
  });

  console.log(`\nmetrics/closed-unanswered.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
