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

    await add("confirmadoPago", [[C, "Pedir medicamentos"], [B, FLOW], [C, "A mi domicilio"], [B, DONE], [O, "Te paso el link de pago"], [C, "Listo, ya pagué"]]);
    await add("confirmadoRetiro", [[C, "Pedir medicamentos"], [C, "Retiro en sucursal"], [B, DONE], [O, "Ya puede pasar a buscar su pedido"]]);
    await add("confirmadoControl", [[C, "Hola, necesito un producto inventado"], [O, "Podrá retirar con el número de control 123"]]);
    await add("confirmadoCierre", [[C, "Pedir medicamentos"], [B, FLOW], [C, "A mi domicilio"], [B, DONE], [O, "La receta fue validada, el envío lo realizamos hoy"], [O, "¡Muchas gracias por confiar en Farmacias TKL!"]]);
    await add("faltaYVenta", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [O, "La sucursal no cuenta con stock de un producto"], [O, "Podrás retirar el pedido a nombre de Inventada 1234"]]);
    await add("soloPrecio", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [O, "El producto tiene un valor de $ 100, el total es 100"]]);
    await add("recetaMeducar", [[C, "Hola, quiero realizar un pedido sobre esta receta: https://cdn.meducar.com/r/inventada"], [B, "Texto del bot"]]);
    await add("recetaOtra", [[C, "¡Hola! Quiero hacer un pedido. Tengo esta receta para descargar https://recetas.inventada.example/r/1"], [O, "Hola, ¿en qué te ayudo?"]]);
    await add("perdida", [[C, "Pedir medicamentos"], [B, FLOW], [C, "A mi domicilio"], [B, DONE], [O, "Hola"], [C, "No gracias, ya lo compré en otra farmacia"]]);
    await add("perdidaSinBot", [[C, "Hola, necesito un producto inventado"], [C, "Dejá, ya fui a la farmacia"]]);
    await add("comproTkl", [[C, "Tienen el producto inventado"], [C, "Hola, ya la compré ayer en TKL, muchas gracias"]]);
    await add("comproSucursal", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [C, "Hola ya pasé por la sucursal y compré"]]);
    await add("soloPresencial", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [O, "Este tipo de medicación se vende únicamente de forma presencial. No contamos con stock"]]);
    await add("recetaNada", [[C, "¡Hola! Quiero hacer un pedido. Tengo esta receta para descargar https://recetas.inventada.example/r/2"], [O, "Hola, ¿en qué te ayudo?"], [C, "En nada. Gracias!"]]);
    await add("preguntaProducto", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Particular"], [B, DONE], [C, "Cuánto está el producto inventado, tienen?"]]);
    await add("seguimiento", [[C, "Hola! quería saber si se pudo registrar el pago"], [O, "Sí"]]);
    await add("graciasLargo", [[C, "Muchísimas gracias por su respuesta, le envío cordiales saludos agradeciendo nuevamente su atención"]]);
    await add("sinStock", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [O, "La sucursal no cuenta con stock por una falta del laboratorio"]]);
    await add("derivado", [[C, "Pedir medicamentos"], [B, FLOW], [C, "A mi domicilio"], [B, DONE], [O, "La sucursal ya no cuenta con personal en el sector de pedidos. Podés realizar la compra de forma presencial"]]);
    await add("sinConfirmar", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Retiro en sucursal"], [B, DONE], [O, "Hola, ¿en qué te ayudo?"]]);
    await add("stockSinPedido", [[C, "Tienen el producto inventado"], [O, "Por el momento no contamos con stock"]]);
    await add("menuAbandono", [[C, "Pedir medicamentos"], [B, FLOW], [C, "Particular"]]);
    await add("notaConfirma", [[C, "Tienen el producto inventado"], [O, "avisar que ya puede pasar a retirar", { isPrivate: true }]]);
    await add("adjunto", [[C, null, { media: "image" }], [O, "No lo trabajamos"]]);
    await add("gracias", [[C, "Muchas gracias!"], [B, "Texto del bot"]]);
    await add("queTal", [[C, "Hola, qué tal"], [O, "Hola, ¿en qué te ayudo?"]]);
    await add("graciasFoto", [[C, "Gracias"], [C, null, { media: "image" }]]);
    await add("horariosBoton", [[C, "Suc. y Horarios"], [B, "Estas son nuestras sucursales"]]);
    await add("cobertura", [[C, "Trabajan con obra social inventada"]]);
    await add("medioPago", [[C, "Aceptan tarjeta en cuotas"]]);
    await add("tienda", [[C, "Tienda online"], [B, "Texto del bot"]]);
    await add("vacuna", [[C, "Quiero saber por la vacuna inventada"], [O, "Sí, la aplicamos"]]);
    await add("soloRespondida", [[C, "Soy la hija de la señora inventada"], [O, "Hola, ¿en qué te ayudo?"]]);
    await add("reclamo", [[C, "Pedir medicamentos"], [O, "Te paso el link de pago"], [C, "Me mandaron otro producto, no es lo que pedí"]]);
    await add("fuera", [[C, "Cuánto sale"]], "2026-03-10T10:00");
    await add("noche", [[C, "Cuánto sale el producto"]], "2026-03-04T23:59");

    const rows = await loadKindRows("2026-03-02", "2026-03-04");
    const by = new Map(rows.map((r) => [r.conversationId, classifyKind(r)]));
    const k = (key: string) => { const v = by.get(ids[key]); return v ? `${v.main}${v.sub ? `/${v.sub}` : ""}` : null; };

    await check("pedido confirmado: pago, aviso de retiro o número de control; la modalidad sale del bot", () => {
      assert.deepEqual([k("confirmadoPago"), k("confirmadoRetiro"), k("confirmadoControl")], ["PEDIDO/DOMICILIO", "PEDIDO/RETIRO", "PEDIDO/SIN_MODALIDAD"]);
    });
    await check("cierre fijo de venta y aviso de envío confirman; si después de una falta se concretó, es un pedido", () => {
      assert.deepEqual([k("confirmadoCierre"), k("faltaYVenta")], ["PEDIDO/DOMICILIO", "PEDIDO/RETIRO"]);
    });
    await check("compró en TKL: venta presencial, no venta perdida", () => {
      assert.deepEqual([k("comproTkl"), k("comproSucursal")], ["COMPRO_TKL", "COMPRO_TKL"]);
    });
    await check("derivado por tipo de medicamento; receta sin necesidad; pregunta de producto desde el menú de pedido", () => {
      assert.deepEqual([k("soloPresencial"), k("recetaNada"), k("preguntaProducto")], ["NO_SE_PUDO_TOMAR/DERIVADO_MEDICAMENTO", "SIN_MOTIVO", "CONSULTA/PRECIO"]);
    });
    await check("seguimiento de un pago; un agradecimiento largo es un saludo", () => {
      assert.deepEqual([k("seguimiento"), k("graciasLargo")], ["SEGUIMIENTO", "SALUDO"]);
    });
    await check("que el operador informe un precio no confirma el pedido", () => {
      assert.equal(k("soloPrecio"), "PEDIDO_SIN_CONFIRMAR");
    });
    await check("receta digital: es pedido sin importar el dominio del enlace", () => {
      assert.deepEqual([k("recetaMeducar"), k("recetaOtra")], ["PEDIDO/RECETA", "PEDIDO/RECETA"]);
    });
    await check("venta perdida: por el texto del cliente, con o sin recorrido del bot", () => {
      assert.deepEqual([k("perdida"), k("perdidaSinBot")], ["VENTA_PERDIDA/OTRO_LADO", "VENTA_PERDIDA/NO_DICE_DONDE"]);
    });
    await check("no se pudo tomar: sin stock y derivado a compra presencial; sin pedido, la falta es una consulta de stock", () => {
      assert.deepEqual([k("sinStock"), k("derivado"), k("stockSinPedido")], ["NO_SE_PUDO_TOMAR/SIN_STOCK", "NO_SE_PUDO_TOMAR/DERIVADO_PRESENCIAL", "CONSULTA/STOCK"]);
    });
    await check("pedido sin confirmar: completó el bot y le respondieron, sin confirmación", () => {
      assert.equal(k("sinConfirmar"), "PEDIDO_SIN_CONFIRMAR");
    });
    await check("la nota interna del operador no confirma un pedido", () => {
      assert.equal(k("notaConfirma"), "CONSULTA/STOCK");
    });
    await check("saludo o agradecimiento: gracias, qué tal, o solo botones; con foto es una consulta", () => {
      assert.deepEqual([k("gracias"), k("queTal"), k("menuAbandono"), k("graciasFoto"), k("adjunto")], ["SALUDO", "SALUDO", "SALUDO", "CONSULTA/OTRAS", "CONSULTA/OTRAS"]);
    });
    await check("consulta por palabras: cobertura, pago y vacunas; los botones del bot sin texto no alcanzan", () => {
      assert.deepEqual([k("horariosBoton"), k("cobertura"), k("medioPago"), k("tienda"), k("vacuna")],
        ["SALUDO", "CONSULTA/COBERTURA", "CONSULTA/PAGO", "SALUDO", "CONSULTA/SERVICIOS"]);
    });
    await check("que un operador haya respondido no alcanza: sin motivo claro; el reclamo gana sobre el pedido", () => {
      assert.deepEqual([k("soloRespondida"), k("reclamo")], ["SIN_MOTIVO", "RECLAMO"]);
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
