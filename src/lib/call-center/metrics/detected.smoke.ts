/**
 * SMOKE de "Reclamos y pérdidas" contra una base Postgres LOCAL EFÍMERA (nunca Neon): prueba
 * las expresiones reales sobre textos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/detected.smoke.ts
 */
import assert from "node:assert/strict";
import type { PrismaClient, ConversationStatus } from "@prisma/client";
import { withEphemeralDb } from "./smoke-db";

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
let seq = 0;

async function conv(prisma: PrismaClient, key: string, texts: string[], o: { status?: ConversationStatus; created?: string; operator?: string } = {}) {
  const customer = await prisma.customer.create({ data: { phone: `+54911000003${String(++seq).padStart(3, "0")}` } });
  const created = at(o.created ?? "2026-03-03T10:00");
  const c = await prisma.conversation.create({
    data: { customerId: customer.id, status: o.status ?? "RESUELTA", source: "EMOZION", externalConversationId: `det-${key}`, createdAt: created },
  });
  let n = 0;
  for (const body of texts) {
    await prisma.conversationMessage.create({
      data: { conversationId: c.id, author: "CUSTOMER", body, sentAt: new Date(created.getTime() + ++n * 60_000), externalMessageId: `det-${key}-${n}` },
    });
  }
  if (o.operator) {
    await prisma.conversationMessage.create({
      data: { conversationId: c.id, author: "OPERATOR", body: o.operator, sentAt: new Date(created.getTime() + 600_000), externalMessageId: `det-${key}-op` },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_detected_smoke", async (prisma) => {
    const { loadDetectedRows, classifySale, claimsOf, getDetectedPayload } = await import("./detected");
    await prisma.branch.create({ data: { name: "Sucursal Inventada" } });
    await prisma.branch.create({ data: { name: "Villa Ejemplo" } });
    const ids: Record<string, string> = {};
    const add = async (key: string, texts: string[], o?: Parameters<typeof conv>[3]) => { ids[key] = await conv(prisma, key, texts, o); };

    // Ventas
    await add("otraFarmacia", ["Hola, ya compré en otra farmacia. Gracias"]);
    await add("otroLado", ["Gracias, ya lo conseguí por otro lado"]);
    await add("cancelo", ["Cancelo la compra, gracias"]);
    await add("otroLadoPrecio", ["Necesito el precio de un producto y por otro lado el de otro"]);
    await add("yaCompre", ["Sisi ya fui y la compré"]);
    await add("yaPase", ["Hola, nada, ya pasé a comprar el remedio"]);
    await add("enTkl", ["Ya lo compré ayer en tkl, gracias"]);
    await add("enSucursal", ["Ya compré en villa ejemplo"]);
    await add("enLaFarmacia", ["Ya fui a la farmacia"]);
    await add("retire", ["Ya lo retiré, muchas gracias"]);
    await add("puedoRetirar", ["¿Ya puedo pasar a retirar?"]);
    // Reclamos del Call Center
    await add("demora", ["Hace horas que escribí y nadie me responde"]);
    await add("novedades", ["Hice mi pedido hace varios días y no tengo novedades"]);
    await add("noLlegoAPasar", ["Gracias, hoy no llego a pasar por la farmacia"]);
    await add("incorrecto", ["Me mandaron otro producto, no es lo que pedí"]);
    await add("stock", ["Me dijeron que no tienen stock"]);
    await add("facturaQueja", ["Todavía no me llegó la factura"]);
    await add("facturaComun", ["Necesito factura A, por favor"]);
    await add("precio", ["Me cobraron de más, no me aplicaron el descuento"]);
    await add("devolucion", ["Quiero pedir la devolución del dinero"]);
    await add("trato", ["Pésima atención, una vergüenza"]);
    await add("otros", ["Quiero hacer un reclamo"]);
    // Envíos
    await add("envioNoLlego", ["Todavía no llegó el pedido y sigo esperando"]);
    await add("envioDireccion", ["Ayer mandaron la moto a mi domicilio anterior"]);
    await add("envioSeFue", ["El repartidor vino y se fue sin tocar timbre"]);
    await add("envioAyer", ["Ayer no llegó el envío"]);
    await add("envioNuncaVino", ["Quedaron en pasar y nunca vino"]);
    await add("envioNadaDomicilio", ["A mi domicilio", "No me llegó nada aún"]);
    await add("nadaSinDomicilio", ["No me llegó nada"]);
    await add("aunNoLlegoDomicilio", ["A mi domicilio", "Buenas noches, aún no llegó"]);
    await add("ayerNoLlegoSolo", ["Ayer no llegó"]);
    await add("pasaDireccion", ["Esta vez el envío es en otra dirección, te paso otra dirección"]);
    await add("enviarAOtra", ["¿Lo pueden enviar a otra dirección?"]);
    await add("programar", ["Quiero programar el envío para mañana a la tarde"]);
    await add("motoSeFue", ["Mando una moto a retirar, la otra vez la moto se fue sin el pedido"]);
    await add("siLlego", ["Quiero saber si llegó mi compra, no me avisaron si llegó"]);
    await add("devolucionNoLlega", ["No me llega la devolución del dinero"]);
    await add("motoPropia", ["Mando una moto de Uber a retirar, ¿puede ser?"]);
    await add("coordinacion", ["Avisame cuando llegue el repartidor, el horario es de 8 a 17"]);
    // Tienda online
    await add("webMail", ["Compré por la página y no me llegó el mail de confirmación"]);
    await add("webNingunMail", ["Lo hice pero no llego ningún mail"]);
    await add("webNumero", ["No tengo número de pedido, solo tengo el pago"]);
    await add("webPagina", ["La página no me deja pagar"]);
    await add("webCupon", ["El cupón no funciona"]);
    // Fuera de alcance
    await add("gracias", ["Muchas gracias!"]);
    await add("soloOperador", ["Hola"], { operator: "Ya compré en otra farmacia" }); // lo dijo el operador, no el cliente
    await add("fueraDePeriodo", ["Ya compré en otra farmacia"], { created: "2026-03-10T10:00" });
    await add("abierta", ["Quiero hacer un reclamo"], { status: "ASIGNADA", created: "2026-03-04T23:59" });

    const { rows, conversations } = await loadDetectedRows("2026-03-02", "2026-03-04");
    const by = new Map(rows.map((r) => [r.conversationId, r]));
    const sale = (k: string) => { const r = by.get(ids[k]); return r ? classifySale(r) : null; };
    const claims = (k: string) => { const r = by.get(ids[k]); return r ? claimsOf(r) : []; };

    await check("pérdida confirmada: otra farmacia, otro lado al hablar de comprar, y cancela", () => {
      assert.deepEqual([sale("otraFarmacia"), sale("otroLado"), sale("cancelo")], ["ELSEWHERE", "ELSEWHERE", "ELSEWHERE"]);
    });
    await check("'por otro lado' sin hablar de comprar no es una pérdida", () => {
      assert.equal(sale("otroLadoPrecio"), null);
    });
    await check("compró y no dice dónde: va aparte", () => {
      assert.deepEqual([sale("yaCompre"), sale("yaPase")], ["UNKNOWN_PLACE", "UNKNOWN_PLACE"]);
    });
    await check("compró en TKL: menciona TKL, una sucursal de la tabla o 'la farmacia', o ya retiró", () => {
      assert.deepEqual([sale("enTkl"), sale("enSucursal"), sale("enLaFarmacia"), sale("retire")], ["AT_TKL", "AT_TKL", "AT_TKL", "AT_TKL"]);
    });
    await check("'ya puedo pasar a retirar' es una pregunta, no una compra", () => {
      assert.equal(sale("puedoRetirar"), null);
    });
    await check("reclamos del Call Center: un motivo por caso", () => {
      assert.deepEqual([claims("demora"), claims("novedades"), claims("incorrecto"), claims("stock")], [["DEMORA"], ["SIN_NOVEDADES"], ["INCORRECTO"], ["STOCK"]]);
      assert.deepEqual([claims("precio"), claims("devolucion"), claims("trato"), claims("otros")], [["PRECIO"], ["PAGO"], ["TRATO"], ["OTROS"]]);
    });
    await check("factura: solo con una queja; un pedido común de factura no es reclamo", () => {
      assert.deepEqual([claims("facturaQueja"), claims("facturaComun")], [["FACTURA"], []]);
    });
    await check("'no llego a pasar' no es un pedido sin novedades ni un envío que no llegó", () => {
      assert.deepEqual(claims("noLlegoAPasar"), []);
    });
    await check("envíos: no llegó el pedido y problemas con la entrega", () => {
      assert.ok(claims("envioNoLlego").includes("ENVIO_NO_LLEGO"));
      assert.deepEqual([claims("envioDireccion"), claims("envioSeFue")], [["ENVIO_ENTREGA"], ["ENVIO_ENTREGA"]]);
    });
    await check("envíos: mandar una moto propia o coordinar el horario no es un reclamo", () => {
      assert.deepEqual([claims("motoPropia"), claims("coordinacion"), claims("motoSeFue")], [[], [], []]);
    });
    await check("envíos: 'ayer no llegó el envío' y 'nunca vino' cuentan como pedido que no llegó", () => {
      assert.deepEqual([claims("envioAyer"), claims("envioNuncaVino")], [["ENVIO_NO_LLEGO"], ["ENVIO_NO_LLEGO"]]);
    });
    await check("'no me llegó nada': envío que no llegó solo si eligió envío a domicilio; solo, no alcanza", () => {
      assert.deepEqual([claims("envioNadaDomicilio"), claims("nadaSinDomicilio")], [["ENVIO_NO_LLEGO"], []]);
      assert.deepEqual([claims("aunNoLlegoDomicilio"), claims("ayerNoLlegoSolo")], [["ENVIO_NO_LLEGO"], []]);
    });
    await check("envíos: que el cliente pase otra dirección o programe el envío no es un problema con la entrega", () => {
      assert.deepEqual([claims("pasaDireccion"), claims("enviarAOtra"), claims("programar")], [[], [], []]);
    });
    await check("'quiero saber si llegó' es seguimiento, no reclamo; 'no me llega la devolución' es pago o devolución", () => {
      // Preguntar por un pedido en curso no es un reclamo (la misma regla que "Motivos de contacto").
      assert.deepEqual([by.has(ids.siLlego) ? claims("siLlego") : [], claims("devolucionNoLlega")], [[], ["PAGO"]]);
    });
    await check("tienda online: sin confirmación y problemas con la página, fuera de los reclamos del Call Center", () => {
      assert.deepEqual([claims("webMail"), claims("webNingunMail"), claims("webNumero")], [["WEB_SIN_CONFIRMACION"], ["WEB_SIN_CONFIRMACION"], ["WEB_SIN_CONFIRMACION"]]);
      assert.deepEqual([claims("webPagina"), claims("webCupon")], [["WEB_PAGINA"], ["WEB_PAGINA"]]);
    });
    await check("fuera de alcance: agradecimiento, lo que dijo el operador y lo creado fuera del período", () => {
      assert.deepEqual([by.has(ids.gracias), by.has(ids.soloOperador), by.has(ids.fueraDePeriodo)], [false, false, false]);
    });
    await check("el día es el de Buenos Aires y el estado es el actual", () => {
      assert.equal(by.get(ids.abierta)!.open, true);
      assert.equal(conversations, Object.keys(ids).length - 1);
    });
    await check("motivos de reclamo de un conjunto dado de conversaciones (\"Ahora\"): las mismas reglas que el informe, solo para esas", async () => {
      const { loadClaimMotives } = await import("./detected");
      const keys = Object.keys(ids);
      const some = await loadClaimMotives(keys.map((k) => ids[k]));
      // Coincide con el informe en todas las conversaciones del período que tienen un reclamo.
      for (const k of keys) {
        const r = by.get(ids[k]);
        if (r) assert.deepEqual(some.get(ids[k]) ?? [], claimsOf(r), k);
      }
      assert.deepEqual(some.get(ids["demora"]), ["DEMORA"]);
      // Solo las pedidas, y las que no tienen reclamo no aparecen.
      const one = await loadClaimMotives([ids["demora"], ids["abierta"]]);
      assert.deepEqual([...one.keys()].sort(), [ids["demora"], ids["abierta"]].sort());
      assert.equal((await loadClaimMotives([])).size, 0);
    });
    await check("respuesta de la API: grupos, conteos y lista con enlace; sin teléfono ni texto", async () => {
      const p = await getDetectedPayload("2026-03-02", "2026-03-04", at("2026-03-05T12:00"));
      const n = (k: string) => p.sales.byMotive.find((b) => b.motive === k)!.count;
      assert.deepEqual([n("ELSEWHERE"), n("UNKNOWN_PLACE"), n("AT_TKL")], [3, 2, 4]);
      assert.deepEqual([p.claims.ENVIOS.conversations, p.claims.TIENDA_ONLINE.conversations], [7, 5]);
      assert.ok(p.sales.cases.every((c) => Object.values(ids).includes(c.conversationId)));
      const dump = JSON.stringify(p);
      assert.ok(!dump.includes("+549") && !/farmacia|gracias|reclamo|det-/i.test(dump));
    });
  });

  console.log(`\nmetrics/detected.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
