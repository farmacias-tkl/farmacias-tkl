/**
 * Resultado de cierre confirmado por el operador. PURO, datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/closure-outcome.test.ts
 */
import assert from "node:assert/strict";
import { closureMapOf, closureOutcomeOf } from "./closure-outcome";
import { buildAccountsReport, type PeriodClosureRow, type OperatorMessageRow } from "./accounts";
import type { ConfigVersion } from "./config";
import { closureLabelOf } from "../ingest";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const map = closureMapOf({ closureLabels: [{ label: "venta_concretada", outcome: "VENTA" }, { label: "solo_consulta", outcome: "CONSULTA" }] });
const conv = (over: Partial<Parameters<typeof closureOutcomeOf>[0]> = {}) => ({ resolved: true, closureTypeName: null, labels: [] as string[], ...over });

test("el resultado sale del que guardó la ingesta; si no hay, de las etiquetas de la conversación", () => {
  assert.deepEqual(closureOutcomeOf(conv({ closureTypeName: "venta_concretada", labels: ["solo_consulta"] }), map), { label: "venta_concretada", outcome: "VENTA" });
  assert.deepEqual(closureOutcomeOf(conv({ labels: ["a_mi_domicilio", "solo_consulta"] }), map), { label: "solo_consulta", outcome: "CONSULTA" });
  // Un nombre guardado que la configuración no conoce (un tipo de cierre de Emozion) no es un resultado: se miran las etiquetas.
  assert.deepEqual(closureOutcomeOf(conv({ closureTypeName: "Tipo inventado", labels: ["venta_concretada"] }), map)?.outcome, "VENTA");
});

test("etiquetas que no son de cierre, conversación reabierta o configuración sin etiquetas: sin resultado", () => {
  assert.equal(closureOutcomeOf(conv({ labels: ["a_mi_domicilio", "retiro_en_sucursal", "tkl_san_miguel", "dr_app"] }), map), null);
  assert.equal(closureOutcomeOf(conv({ resolved: false, closureTypeName: "venta_concretada", labels: ["venta_concretada"] }), map), null);
  assert.equal(closureOutcomeOf(conv({ closureTypeName: "venta_concretada" }), closureMapOf(null)), null);
  assert.equal(closureMapOf({}).size, 0);
});

test("ingesta: la etiqueta de cierre es la última de la lista que la configuración define como de cierre", () => {
  const set = new Set(["venta_concretada", "solo_consulta"]);
  assert.equal(closureLabelOf(["a_mi_domicilio", "solo_consulta", "dr_app"], set), "solo_consulta");
  assert.equal(closureLabelOf(["solo_consulta", "venta_concretada"], set), "venta_concretada");
  assert.equal(closureLabelOf(["a_mi_domicilio", "tkl_san_miguel"], set), null);
  assert.equal(closureLabelOf(null, set), null);
  assert.equal(closureLabelOf(["solo_consulta"], new Set()), null);
});

test("ingesta: la etiqueta de cierre se decide por diferencia contra las etiquetas guardadas", () => {
  const set = new Set(["venta_concretada", "solo_consulta"]);
  // La que el evento agrega, aunque no sea la última de la lista.
  assert.equal(closureLabelOf(["venta_concretada", "a_mi_domicilio", "solo_consulta"], set, ["a_mi_domicilio", "solo_consulta"]), "venta_concretada");
  // No agrega ninguna de cierre y hay una sola: esa (evento repetido, o misma resolución otra vez).
  assert.equal(closureLabelOf(["a_mi_domicilio", "solo_consulta"], set, ["a_mi_domicilio", "solo_consulta"]), "solo_consulta");
  // No agrega ninguna de cierre y hay varias: no se puede saber cuál vale.
  assert.equal(closureLabelOf(["solo_consulta", "venta_concretada"], set, ["venta_concretada", "solo_consulta"]), null);
  // Agrega una etiqueta que no es de cierre: no cambia nada de lo anterior.
  assert.equal(closureLabelOf(["solo_consulta", "venta_concretada", "dr_app"], set, ["solo_consulta", "venta_concretada"]), null);
});

test("Operadores: cierres del período por la fila de cierre del historial, con el mapa vigente ese día, el tipo de asignado y la cobertura", () => {
  const at = (s: string) => new Date(`${s}:00.000-03:00`);
  const msg = (account: string, conversationId: string): OperatorMessageRow => ({ account, conversationId, sentAt: at("2026-03-03T11:00"), isPrivate: false });
  const messages = [msg("9001", "c1"), msg("9001", "c2"), msg("9002", "c1")];
  const week = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };
  const data = (closureLabels: Array<{ label: string; outcome: "VENTA" | "CONSULTA" | "SIN_STOCK" }>) =>
    ({ schemaVersion: 1 as const, publicHours: week, operatorHours: week, firstResponseGoalMinutes: 15, accounts: [], callCenterVendors: [], closureLabels });
  // Hasta el 02/03 "cierre_x" quería decir consulta; desde el 03/03, venta.
  const versions = [
    { id: "v1", validFrom: "2026-03-01", createdAt: new Date("2026-02-28T00:00:00Z"), data: data([{ label: "cierre_x", outcome: "CONSULTA" }, { label: "cierre_stock", outcome: "SIN_STOCK" }]) },
    { id: "v2", validFrom: "2026-03-03", createdAt: new Date("2026-03-02T00:00:00Z"), data: data([{ label: "cierre_x", outcome: "VENTA" }, { label: "cierre_stock", outcome: "SIN_STOCK" }]) },
  ] as unknown as ConfigVersion[];
  const row = (conversationId: string, closed: string, over: Partial<PeriodClosureRow> = {}): PeriodClosureRow =>
    ({ conversationId, closedAt: at(closed), closureTypeName: "cierre_x", labelsSeen: ["cierre_x"], account: "9001", assigneeType: "USER", ...over });
  const closures = [
    row("c1", "2026-03-02T12:00", { account: "9002" }),               // mapa del 02/03: consulta. Escribieron 9001 y 9002; la cerró 9002.
    row("c2", "2026-03-03T12:00"),                                     // mapa del 03/03: venta.
    row("c3", "2026-03-03T13:00", { account: null, assigneeType: null }), // sin asignado.
    row("c4", "2026-03-03T14:00", { account: "9003" }),               // 9003 no escribió en el período.
    row("c5", "2026-03-03T15:00", { account: "37", assigneeType: "AGENT_BOT" }), // la tenía un bot: nadie la tomó.
    row("c6", "2026-03-03T16:00", { closureTypeName: null, labelsSeen: [] }),    // sin tipo.
    row("c7", "2026-03-03T17:00", { closureTypeName: null, labelsSeen: ["cierre_x", "cierre_stock"] }), // dos resultados: ambiguo.
    row("c8", "2026-03-03T18:00", { closureTypeName: null, labelsSeen: ["otra", "cierre_stock"] }),     // un solo resultado entre las vistas.
    // Dos cierres de la misma conversación: vale el último del período.
    row("c9", "2026-03-03T09:00", { closureTypeName: "cierre_stock" }), row("c9", "2026-03-03T19:00"),
  ];
  const r = buildAccountsReport({ messages, followups: [], facts: [], closures }, { now: at("2026-03-04T12:00"), versions });
  const of = (a: string) => r.accounts.find((x) => x.account === a)!;
  assert.deepEqual([of("9002").closures!.closed, of("9002").closures!.byOutcome.CONSULTA, of("9002").closures!.byOutcome.VENTA], [1, 1, 0], "el resultado es el del mapa vigente el día del cierre");
  const c1 = of("9001").closures!;
  assert.deepEqual([c1.closed, c1.byOutcome.VENTA, c1.byOutcome.SIN_STOCK, c1.untyped, c1.ambiguous], [5, 2, 1, 1, 1], "escribir en una conversación no es cerrarla");
  assert.deepEqual([of("9003").closures!.byOutcome.VENTA, of("9003").conversations], [1, 0], "la cuenta que cerró aparece aunque no haya escrito");
  const t = r.closures!;
  assert.deepEqual([t.total.closed, t.withoutAccount.closed, t.byBot.closed], [9, 1, 1], "cada conversación una sola vez; sin asignado y con bot no se atribuyen a una persona");
  assert.equal(r.accounts.some((a) => a.account === "37"), false, "el bot no aparece como cuenta");
  assert.equal(t.coverage, 7 / 9);
  // Sin los cierres cargados: sin dato, no cero.
  const sin = buildAccountsReport({ messages, followups: [], facts: [] }, { now: at("2026-03-04T12:00"), versions: [] });
  assert.deepEqual([sin.accounts[0].closures, sin.closures], [null, null]);
});

console.log(`\nmetrics/closure-outcome: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
