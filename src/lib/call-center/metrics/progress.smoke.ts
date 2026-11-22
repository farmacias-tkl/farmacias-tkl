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
    const { loadShiftRows, buildShiftProgress } = await import("./progress");
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
  });

  console.log(`\nmetrics/progress.smoke: ${pass} ok, ${fails.length} fail`);
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
