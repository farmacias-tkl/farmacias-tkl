/**
 * SMOKE de "Avances" (pendientes al comenzar el turno) contra una base Postgres LOCAL
 * EFÍMERA (nunca Neon). Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/progress.smoke.ts
 */
import assert from "node:assert/strict";
import type { PrismaClient, ConversationStatus, ConversationMessageAuthor } from "@prisma/client";
import { withEphemeralDb } from "./smoke-db";

const NOW = new Date("2026-03-10T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const START = hoursAgo(4); // inicio del turno

let pass = 0;
const fails: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Msg = { author: ConversationMessageAuthor; h: number; isPrivate?: boolean };
let seq = 0;
async function conv(prisma: PrismaClient, key: string, o: {
  status: ConversationStatus; createdH: number; history?: Array<{ to: ConversationStatus; h: number }>; msgs: Msg[];
}) {
  const customer = await prisma.customer.create({ data: { phone: `+54911000002${String(++seq).padStart(2, "0")}` } });
  const c = await prisma.conversation.create({
    data: { customerId: customer.id, status: o.status, source: "EMOZION", externalConversationId: `pr-${key}`, createdAt: hoursAgo(o.createdH) },
  });
  for (const h of o.history ?? []) {
    await prisma.conversationStateHistory.create({ data: { conversationId: c.id, fromStatus: "PENDIENTE", toStatus: h.to, changedAt: hoursAgo(h.h) } });
  }
  let n = 0;
  for (const m of o.msgs) {
    await prisma.conversationMessage.create({
      data: { conversationId: c.id, author: m.author, body: "texto inventado", isPrivate: !!m.isPrivate, sentAt: hoursAgo(m.h), externalMessageId: `pr-${key}-${++n}` },
    });
  }
  return c.id;
}

async function main() {
  await withEphemeralDb("tkl_cc_metrics_progress_smoke", async (prisma) => {
    const { loadShiftRows, buildShiftProgress, loadWindowRows, countWindowClosures } = await import("./progress");
    const C = "CUSTOMER" as const, O = "OPERATOR" as const;

    // Pendiente al empezar y sigue sin respuesta.
    await conv(prisma, "pendiente", { status: "SIN_ASIGNAR", createdH: 10, history: [{ to: "SIN_ASIGNAR", h: 9.9 }], msgs: [{ author: C, h: 10 }] });
    // Pendiente al empezar y atendida durante el turno.
    await conv(prisma, "atendida", { status: "ASIGNADA", createdH: 10, history: [{ to: "SIN_ASIGNAR", h: 9.9 }], msgs: [{ author: C, h: 10 }, { author: O, h: 2 }] });
    // Solo una nota interna durante el turno: no cuenta como atendida.
    await conv(prisma, "nota", { status: "ASIGNADA", createdH: 10, msgs: [{ author: C, h: 10 }, { author: O, h: 2, isPrivate: true }] });
    // Respondida antes del turno: no estaba pendiente.
    await conv(prisma, "respondida", { status: "ASIGNADA", createdH: 10, msgs: [{ author: C, h: 10 }, { author: O, h: 8 }] });
    // Cerrada antes del turno, sin respuesta: a esa hora estaba resuelta.
    await conv(prisma, "cerrada-antes", { status: "RESUELTA", createdH: 10, history: [{ to: "SIN_ASIGNAR", h: 9.9 }, { to: "RESUELTA", h: 6 }], msgs: [{ author: C, h: 10 }] });
    // Cerrada DESPUÉS de empezar el turno: a esa hora estaba abierta y pendiente.
    await conv(prisma, "cerrada-despues", { status: "RESUELTA", createdH: 10, history: [{ to: "SIN_ASIGNAR", h: 9.9 }, { to: "RESUELTA", h: 1 }], msgs: [{ author: C, h: 9 }] });
    // El cliente insistió durante el turno: la espera a esa hora arranca en su mensaje anterior.
    await conv(prisma, "insiste", { status: "SIN_ASIGNAR", createdH: 5, msgs: [{ author: C, h: 5 }, { author: C, h: 2 }] });
    // Creada después de empezar el turno: no existía.
    await conv(prisma, "nueva", { status: "SIN_ASIGNAR", createdH: 1, msgs: [{ author: C, h: 1 }] });
    // Abierta hace 10 días: antigua, fuera de la ventana de 72 horas.
    await conv(prisma, "antigua", { status: "SIN_ASIGNAR", createdH: 240, msgs: [{ author: C, h: 240 }] });

    const rows = await loadShiftRows(START);

    await check("filas: último mensaje público antes del turno es del cliente; lo creado o respondido antes queda afuera", () => {
      assert.equal(rows.length, 7);
    });
    await check("estado a esa hora: sale del historial; sin historial previo queda sin estado (abierta)", () => {
      assert.equal(rows.filter((r) => r.statusAtStart === "RESUELTA").length, 1);
      assert.equal(rows.filter((r) => r.statusAtStart === null).length, 3);
    });
    await check("atendida durante el turno: solo con respuesta pública; la nota interna no cuenta", () => {
      assert.equal(rows.filter((r) => r.attendedSince).length, 1);
    });
    await check("la espera arranca en el mensaje anterior al turno, no en la insistencia posterior", () => {
      assert.ok(rows.some((r) => r.waitStart.getTime() === hoursAgo(5).getTime()));
      assert.equal(rows.some((r) => r.waitStart.getTime() === hoursAgo(2).getTime()), false);
    });
    await check("resumen: 5 pendientes al empezar (sin la cerrada antes ni la antigua) y 1 atendida", () => {
      assert.deepEqual(buildShiftProgress(rows, START), { startedAt: START.toISOString(), pendingAtStart: 5, attendedSince: 1 });
    });
    await check("las filas no traen ids, teléfono ni texto", () => {
      const dump = JSON.stringify(rows);
      assert.ok(!dump.includes("+549") && !dump.includes("inventado") && !dump.includes("pr-"));
      assert.deepEqual(Object.keys(rows[0]).sort(), ["attendedSince", "statusAtStart", "waitStart"]);
    });

    // ── Ventanas de WhatsApp cerradas sin respuesta ──
    // Tramo: de hace 10 horas hasta ahora. La ventana cierra 24 horas después del último mensaje del cliente.
    await conv(prisma, "v-cerro", { status: "SIN_ASIGNAR", createdH: 40, msgs: [{ author: C, h: 40 }, { author: C, h: 30 }] });                    // cerró hace 6 h
    await conv(prisma, "v-tarde", { status: "ASIGNADA", createdH: 40, msgs: [{ author: C, h: 29 }, { author: O, h: 2 }] });                         // cerró hace 5 h; respuesta posterior
    await conv(prisma, "v-nota", { status: "ASIGNADA", createdH: 40, msgs: [{ author: C, h: 28 }, { author: O, h: 27, isPrivate: true }] });        // la nota interna no responde
    await conv(prisma, "v-a-tiempo", { status: "ASIGNADA", createdH: 40, msgs: [{ author: C, h: 30 }, { author: O, h: 20 }, { author: C, h: 19 }] }); // respondida dentro de la ventana
    await conv(prisma, "v-insistio", { status: "SIN_ASIGNAR", createdH: 40, msgs: [{ author: C, h: 30 }, { author: C, h: 12 }] });                  // volvió a escribir: sigue abierta
    await conv(prisma, "v-ayer", { status: "SIN_ASIGNAR", createdH: 60, msgs: [{ author: C, h: 50 }] });                                           // cerró antes del tramo
    // Solo saludó: su ventana también cerró en el tramo, pero no cuenta.
    const saludo = await conv(prisma, "v-saludo", { status: "SIN_ASIGNAR", createdH: 40, msgs: [{ author: C, h: 29.5 }] });
    await prisma.conversationMessage.updateMany({ where: { conversationId: saludo }, data: { body: "Hola, buenas tardes" } });
    const FROM = hoursAgo(10);
    const win = await loadWindowRows(FROM, NOW);

    await check("ventana cerrada sin respuesta: último mensaje del cliente antes de la primera respuesta pública", () => {
      assert.equal(countWindowClosures(win, FROM, NOW), 3);
      // La respondida a tiempo llega como candidata (su ventana cerraba en el tramo) y el conteo la descarta.
      assert.deepEqual(win.map((r) => r.lastCustomerAt.getTime()).sort(), [hoursAgo(30), hoursAgo(30), hoursAgo(29.5), hoursAgo(29), hoursAgo(28)].map((d) => d.getTime()).sort());
      assert.equal(win.filter((r) => r.firstHumanAt !== null).length, 2);
    });
    await check("ventana: vista a una hora anterior, solo cuentan los mensajes y los cierres hasta esa hora", async () => {
      // Hace 5 horas y media solo se había cerrado la primera (cerró hace 6 h).
      const cut = hoursAgo(5.5);
      assert.equal(countWindowClosures(await loadWindowRows(FROM, cut), FROM, cut), 1);
    });
    await check("ventana: las filas no traen ids, teléfono ni texto", () => {
      assert.deepEqual(Object.keys(win[0]).sort(), ["firstHumanAt", "lastCustomerAt", "onlyGreeting"]);
      assert.equal(win.filter((r) => r.onlyGreeting).length, 1);
    });
  });

  console.log(`\nmetrics/progress.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
