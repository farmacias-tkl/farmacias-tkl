/**
 * SMOKE de la clasificación por tipo contra una base Postgres LOCAL EFÍMERA (nunca Neon):
 * prueba las expresiones reales sobre textos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/kinds.smoke.ts
 */
import assert from "node:assert/strict";
import type { PrismaClient, ConversationMessageAuthor } from "@prisma/client";
import { withEphemeralDb } from "./smoke-db";

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
type Msg = [ConversationMessageAuthor, string | null, { media?: string; isPrivate?: boolean }?];
let seq = 0;

async function conv(prisma: PrismaClient, key: string, msgs: Msg[], created = "2026-03-03T10:00") {
  const customer = await prisma.customer.create({ data: { phone: `+54911000004${String(++seq).padStart(3, "0")}` } });
  const createdAt = at(created);
  const c = await prisma.conversation.create({ data: { customerId: customer.id, status: "RESUELTA", source: "EMOZION", externalConversationId: `kd-${key}`, createdAt } });
  let n = 0;
  for (const [author, body, o] of msgs) {
    await prisma.conversationMessage.create({
      data: { conversationId: c.id, author, body, mediaType: o?.media ?? null, isPrivate: !!o?.isPrivate, sentAt: new Date(createdAt.getTime() + ++n * 60_000), externalMessageId: `kd-${key}-${n}` },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_kinds_smoke", async (prisma) => {
    const { loadKindRows, classifyKind, getKindsPayload } = await import("./kinds");
    const C = "CUSTOMER" as const, O = "OPERATOR" as const, B = "BOT" as const;
    const DONE = "✅ ¡Listo! Mensaje final inventado.";
    const FLOW = "¿Tu pedido es con cobertura médica o lo abonás de forma particular?";
    const ids: Record<string, string> = {};
    const add = async (key: string, msgs: Msg[], created?: string) => { ids[key] = await conv(prisma, key, msgs, created); };

    await add("pedidoPago", [[C, "Pedir medicamentos"], [B, FLOW], [C, "A mi domicilio"], [B, DONE], [O, "Te paso el link de pago"], [C, "Listo, ya pagué"]]);
    await add("pedidoRetiro", [[C, "Pedir medicamentos"], [C, "Retiro en sucursal"], [B, DONE], [O, "Ya está listo, puede pasar a retirar"]]);
    await add("pedidoSinMenu", [[C, "Hola, necesito un producto inventado"], [O, "El total es 100, le paso el alias"]]);
    await add("meducar", [[C, "Hola, quiero realizar un pedido sobre esta receta: https://cdn.meducar.com/r/inventada"], [B, "Texto del bot"]]);
    await add("sinConfirmar", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [O, "Hola, ¿en qué te ayudo?"]]);
    await add("menuPrecio", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Cuánto sale el producto inventado?"], [O, "Sale 100"]]);
    await add("menuAbandono", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Particular"]]);
    await add("notaPago", [[C, "Tienen el producto inventado?"], [O, "pedir el link de pago", { isPrivate: true }]]);
    await add("adjunto", [[C, null, { media: "image" }], [O, "No lo trabajamos"]]);
    await add("gracias", [[C, "Muchas gracias!"], [B, "Texto del bot"]]);
    await add("graciasFoto", [[C, "Gracias"], [C, null, { media: "image" }]]);
    await add("horariosBoton", [[C, "Suc. y Horarios"], [B, "Estas son nuestras sucursales"]]);
    await add("cobertura", [[C, "Trabajan con obra social inventada"]]);
    await add("medioPago", [[C, "Aceptan tarjeta en cuotas"]]);
    await add("tienda", [[C, "Tienda online"], [B, "Texto del bot"]]);
    await add("obraSocialBoton", [[C, "Obra Social"], [C, "Me pasás la info"]]);
    await add("reclamo", [[C, "Pedir medicamentos"], [O, "Te paso el link de pago"], [C, "Me mandaron otro producto, no es lo que pedí"]]);
    await add("sinClasificar", [[C, "Soy la hija de la señora inventada"]]);
    await add("fuera", [[C, "Cuánto sale"]], "2026-03-10T10:00");
    await add("noche", [[C, "Cuánto sale el producto"]], "2026-03-04T23:59");

    const rows = await loadKindRows("2026-03-02", "2026-03-04");
    const by = new Map(rows.map((r) => [r.conversationId, classifyKind(r)]));
    const k = (key: string) => { const v = by.get(ids[key]); return v ? `${v.main}${v.sub ? `/${v.sub}` : ""}` : null; };

    await check("pedido: pago o coordinación, con la modalidad del bot; sin menú queda sin modalidad", () => {
      assert.deepEqual([k("pedidoPago"), k("pedidoRetiro"), k("pedidoSinMenu"), k("meducar")], ["PEDIDO/DOMICILIO", "PEDIDO/RETIRO", "PEDIDO/SIN_MODALIDAD", "PEDIDO/MEDUCAR"]);
    });
    await check("pedido sin confirmar: completó el bot y le respondieron, sin pago ni coordinación", () => {
      assert.equal(k("sinConfirmar"), "PEDIDO_SIN_CONFIRMAR");
    });
    await check("consulta desde el menú de pedido: pregunta el precio y no hay evidencia de pedido", () => {
      assert.equal(k("menuPrecio"), "CONSULTA/PRECIO");
    });
    await check("tocó botones y abandonó: sin contenido", () => {
      assert.equal(k("menuAbandono"), "SIN_CONTENIDO");
    });
    await check("la nota interna del operador no es evidencia de pago", () => {
      assert.equal(k("notaPago"), "CONSULTA/STOCK");
    });
    await check("adjunto sin otra evidencia: consulta; agradecimiento solo: sin contenido; con foto: consulta", () => {
      assert.deepEqual([k("adjunto"), k("gracias"), k("graciasFoto")], ["CONSULTA/OTRAS", "SIN_CONTENIDO", "CONSULTA/OTRAS"]);
    });
    await check("subtipos: horarios por botón, cobertura y medio de pago por palabras, tienda online por botón", () => {
      assert.deepEqual([k("horariosBoton"), k("cobertura"), k("medioPago"), k("tienda")], ["CONSULTA/HORARIOS", "CONSULTA/COBERTURA", "CONSULTA/PAGO", "CONSULTA/TIENDA_ONLINE"]);
    });
    await check("el botón 'Obra Social' del recorrido de pedido no es una consulta de cobertura", () => {
      assert.equal(k("obraSocialBoton"), "SIN_CLASIFICAR");
    });
    await check("reclamo: gana sobre el pedido; lo que no alcanza ninguna regla queda sin clasificar", () => {
      assert.deepEqual([k("reclamo"), k("sinClasificar")], ["RECLAMO", "SIN_CLASIFICAR"]);
    });
    await check("período y hora: lo creado fuera no entra; las 23:59 quedan en su día de Buenos Aires", async () => {
      assert.equal(by.has(ids.fuera), false);
      const p = await getKindsPayload("2026-03-02", "2026-03-04", at("2026-03-05T12:00"));
      assert.equal(p.conversations, Object.keys(ids).length - 1);
      assert.equal(p.byDay.find((d) => d.day === "2026-03-04")!.CONSULTA, 1);
      assert.equal(p.byHour[23].CONSULTA, 1);
      const dump = JSON.stringify(p);
      assert.ok(!dump.includes("+549") && !/inventad|kd-/i.test(dump), "solo conteos");
    });
  });

  console.log(`\nmetrics/kinds.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
