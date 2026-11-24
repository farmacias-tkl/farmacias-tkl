/**
 * Operador en la bandeja y en la vista de conversación. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/operator-display.test.ts
 */
import assert from "node:assert/strict";
import {
  agoLabel, operatorFilterValue, operatorInfo, operatorOptions, operatorWhere, parseOperatorFilter, shortHistory, type HistoryRow,
} from "./operator-display";
import { inboxHref } from "./inbox-pagination";
import { closureMapOf } from "./metrics/closure-outcome";
import { isSyncNote } from "./sync-note";
import { accountRef, assigneeAccount, ownerKeyOf } from "./metrics/account-label";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const acc = (externalId: string, over: object = {}) => ({ externalId, alias: null as string | null, ...over });
const accounts = [
  acc("9000", { system: true, alias: "Automática inventada" }), acc("9001", { alias: "Alias inventado" }), acc("9002"),
  acc("9007", { supervision: true, alias: "Supervisión inventada" }), acc("9008", { system: true }),
];

test("operador de una conversación: asignado medido; el último en responder solo si falta o difiere", () => {
  assert.deepEqual(operatorInfo("9001", "9001", accounts), { attendedBy: "Alias inventado", hasAssignee: true, lastResponder: null });
  assert.deepEqual(operatorInfo("9001", "9002", accounts), { attendedBy: "Alias inventado", hasAssignee: true, lastResponder: "Cuenta 9002" });
  assert.deepEqual(operatorInfo("9000", "9001", accounts), { attendedBy: "Sin tomar", hasAssignee: true, lastResponder: "Alias inventado" });
  assert.deepEqual(operatorInfo(null, "9007", accounts), { attendedBy: "Sin dato de asignado", hasAssignee: false, lastResponder: "Supervisión inventada · supervisión" });
  assert.deepEqual(operatorInfo(null, null, accounts), { attendedBy: "Sin dato de asignado", hasAssignee: false, lastResponder: null });
  assert.equal(operatorInfo("9007", null, accounts).attendedBy, "Supervisión inventada · supervisión");
  // Cuenta sin configurar y sin configuración cargada: por número.
  assert.equal(operatorInfo("9999", null, accounts).attendedBy, "Cuenta 9999");
  assert.equal(operatorInfo("9001", null, []).attendedBy, "Cuenta 9001");
});

test("filtro por operador: cuenta, sin tomar o sin dato; lo raro no filtra", () => {
  assert.deepEqual(parseOperatorFilter("9001"), { kind: "ACCOUNT", account: "9001" });
  assert.deepEqual(parseOperatorFilter("system"), { kind: "SYSTEM" });
  assert.deepEqual(parseOperatorFilter("none"), { kind: "NONE" });
  for (const raro of [undefined, "", "9001; DROP", "a b", "x".repeat(65)]) assert.equal(parseOperatorFilter(raro), null);
  assert.deepEqual(operatorWhere(null, accounts), {});
  const noBot = [{ externalAssigneeType: null }, { externalAssigneeType: { not: "AGENT_BOT" } }];
  assert.deepEqual(operatorWhere({ kind: "ACCOUNT", account: "9001" }, accounts), { externalAssigneeId: "9001", OR: noBot });
  assert.deepEqual(operatorWhere({ kind: "NONE" }, accounts), { externalAssigneeId: null });
  assert.deepEqual(operatorWhere({ kind: "SYSTEM" }, accounts), { OR: [{ externalAssigneeId: { in: ["9000", "9008"] } }, { externalAssigneeType: "AGENT_BOT" }] });
  assert.deepEqual(operatorWhere({ kind: "SYSTEM" }, []), { OR: [{ externalAssigneeId: { in: [] } }, { externalAssigneeType: "AGENT_BOT" }] });
  assert.deepEqual([operatorFilterValue(null), operatorFilterValue({ kind: "SYSTEM" }), operatorFilterValue({ kind: "ACCOUNT", account: "9002" })], [null, "system", "9002"]);
});

test("un bot asignado no es una cuenta de persona: cuenta como 'Sin tomar' aunque su número coincida con el de una cuenta", () => {
  // 9001 es una cuenta de operador con alias; el bot 9001 es otra cosa.
  assert.equal(assigneeAccount("9001", "AGENT_BOT"), "bot:9001");
  assert.equal(assigneeAccount("9001", "USER"), "9001");
  assert.equal(assigneeAccount("9001", null), "9001", "sin tipo vale el id, como antes");
  assert.equal(assigneeAccount(null, "AGENT_BOT"), null);
  assert.deepEqual(accountRef("bot:9001", accounts), { account: "bot:9001", label: "Bot 9001", role: "SISTEMA" });
  assert.equal(ownerKeyOf("bot:9001", accounts), "system");
  assert.equal(operatorInfo(assigneeAccount("9001", "AGENT_BOT"), null, accounts).attendedBy, "Sin tomar");
  assert.equal(operatorInfo(assigneeAccount("9001", "USER"), null, accounts).attendedBy, "Alias inventado");
  // El último operador que respondió es la cuenta 9001 (una persona): se informa, porque no es el bot asignado.
  assert.equal(operatorInfo("bot:9001", "9001", accounts).lastResponder, "Alias inventado");
});

test("historial corto: una corrección de estado al comparar con Emozion no se muestra como cierre de un operador", () => {
  const rows: HistoryRow[] = [
    { changedAt: new Date("2026-03-01T10:00:00.000Z"), fromStatus: "SIN_ASIGNAR", toStatus: "RESUELTA", externalAssigneeId: null, closureTypeName: null, note: "Sincronizada con Emozion el 24/11/2026 (nota inventada)" },
  ];
  const h = shortHistory(rows, accounts, closureMapOf({ closureLabels: [] }));
  assert.equal(h.length, 1);
  assert.match(h[0].text, /estado corregido \(no es un cierre de un operador/);
  assert.ok(isSyncNote("Sincronizada con Emozion el 24/11/2026") && !isSyncNote("Cambio de estado de Emozion (webhook)") && !isSyncNote(null));
});

test("opciones del selector: cuentas que no son de sistema por número, y las dos filas especiales", () => {
  assert.deepEqual(operatorOptions(accounts, null), [
    { value: "9001", label: "Alias inventado" }, { value: "9002", label: "Cuenta 9002" },
    { value: "9007", label: "Supervisión inventada · supervisión" },
    { value: "system", label: "Sin tomar" }, { value: "none", label: "Sin dato de asignado" },
  ]);
  // Una cuenta filtrada que no está en la configuración aparece para poder verse elegida.
  assert.equal(operatorOptions(accounts, { kind: "ACCOUNT", account: "9999" }).find((o) => o.value === "9999")?.label, "Cuenta 9999");
});

test("enlaces de la bandeja: conservan estado y operador; la página 1 no lleva page", () => {
  assert.equal(inboxHref(null, 1), "/call-center");
  assert.equal(inboxHref("ASIGNADA", 2), "/call-center?status=ASIGNADA&page=2");
  assert.equal(inboxHref("ASIGNADA", 1, "9001"), "/call-center?status=ASIGNADA&operator=9001");
  assert.equal(inboxHref(null, 3, "none"), "/call-center?operator=none&page=3");
});

test("historial corto: asignaciones, resolución con resultado de cierre y reapertura", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 2, 10, 12, m));
  const h = (m: number, fromStatus: string | null, toStatus: string, externalAssigneeId: string | null = null, closureTypeName: string | null = null): HistoryRow =>
    ({ changedAt: at(m), fromStatus, toStatus, externalAssigneeId, closureTypeName });
  const map = closureMapOf({ closureLabels: [{ label: "venta_concretada", outcome: "VENTA" }] });
  const events = shortHistory([
    h(0, null, "PENDIENTE"),
    h(1, "PENDIENTE", "ASIGNADA", "9000"),
    h(2, "ASIGNADA", "ASIGNADA", "9001"),
    h(3, "ASIGNADA", "ASIGNADA", "9001"), // misma cuenta: no es una asignación nueva
    h(4, "ASIGNADA", "RESUELTA", "9001", "venta_concretada"),
    h(5, "RESUELTA", "ASIGNADA", "9007"),
    h(6, "ASIGNADA", "RESUELTA", "9007", "etiqueta_sin_configurar"),
    h(7, "RESUELTA", "PENDIENTE"),
    h(8, "PENDIENTE", "RESUELTA"),
  ], accounts, map);
  assert.deepEqual(events.map((e) => [e.kind, e.text]), [
    ["ASIGNACION", "Sin tomar (asignación automática)"],
    ["ASIGNACION", "Asignada a Alias inventado"],
    ["RESOLUCION", "Resuelta · asignada a Alias inventado · cierre: Venta"],
    ["REAPERTURA", "Reabierta · asignada a Supervisión inventada · supervisión"],
    ["RESOLUCION", "Resuelta · asignada a Supervisión inventada · supervisión · cierre: etiqueta_sin_configurar"],
    ["REAPERTURA", "Reabierta"],
    ["RESOLUCION", "Resuelta"],
  ]);
  assert.equal(events[0].at.getTime(), at(1).getTime());
  assert.deepEqual(shortHistory([h(0, null, "PENDIENTE")], accounts, map), []);
});

test("hace cuánto", () => {
  const now = new Date("2026-03-10T15:00:00.000Z");
  assert.equal(agoLabel(new Date("2026-03-10T14:48:00.000Z"), now), "hace 12 min");
  assert.equal(agoLabel(new Date("2026-03-10T11:55:00.000Z"), now), "hace 3 h 5 min");
});

console.log(`\noperator-display: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
