/**
 * "Reclamos y pérdidas". PURO, sin base. Datos inventados.
 *
 *   npx tsx src/lib/call-center/metrics/detected.test.ts
 */
import assert from "node:assert/strict";
import { buildDetectedReport, claimsOf, classifySale, type DetectedRow } from "./detected";
import { CLAIM_GROUP_OF, CLAIM_MOTIVES, branchNamesRegex, type ClaimMotive } from "./detected-patterns";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const at = (s: string) => new Date(`${s}:00.000-03:00`);
const noClaims = () => Object.fromEntries(CLAIM_MOTIVES.map((m) => [m, false])) as Record<ClaimMotive, boolean>;
const row = (id: string, over: Partial<Omit<DetectedRow, "claims">> & { claims?: ClaimMotive[] } = {}): DetectedRow => {
  const { claims, ...rest } = over;
  const c = noClaims();
  for (const m of claims ?? []) c[m] = true;
  return { conversationId: id, createdAt: at("2026-03-03T10:00"), open: false, elsewhere: false, pickedUp: false, boughtAtTkl: false, bought: false, ...rest, claims: c };
};
const build = (rows: DetectedRow[], maxRows?: number) =>
  buildDetectedReport(rows, { now: at("2026-03-05T12:00"), from: "2026-03-02", to: "2026-03-04", conversations: 100, maxRows });
const count = (r: ReturnType<typeof build>, k: string) => r.sales.byMotive.find((b) => b.motive === k)!.count;

test("ventas: otra farmacia es pérdida confirmada aunque también diga que compró", () => {
  assert.equal(classifySale(row("a", { elsewhere: true, bought: true, boughtAtTkl: true })), "ELSEWHERE");
});

test("ventas: compró y menciona TKL, o ya retiró el pedido, es compra en TKL y no pérdida", () => {
  assert.equal(classifySale(row("a", { bought: true, boughtAtTkl: true })), "AT_TKL");
  assert.equal(classifySale(row("a", { pickedUp: true })), "AT_TKL");
});

test("ventas: compró sin decir dónde va aparte; sin ninguna marca no hay categoría", () => {
  assert.equal(classifySale(row("a", { bought: true })), "UNKNOWN_PLACE");
  assert.equal(classifySale(row("a")), null);
});

test("encabezado: pérdidas confirmadas y 'no dice dónde' se cuentan por separado", () => {
  const r = build([row("a", { elsewhere: true }), row("b", { bought: true }), row("c", { bought: true }), row("d", { pickedUp: true }), row("e")]);
  assert.deepEqual([count(r, "ELSEWHERE"), count(r, "UNKNOWN_PLACE"), count(r, "AT_TKL"), r.sales.conversations], [1, 2, 1, 4]);
});

test("reclamos: una conversación puede tener varios motivos y cada uno va a su grupo", () => {
  const r = build([row("a", { claims: ["DEMORA", "ENVIO_NO_LLEGO", "WEB_SIN_CONFIRMACION"] }), row("b", { claims: ["DEMORA", "FACTURA"] })]);
  assert.deepEqual(claimsOf(row("a", { claims: ["WEB_PAGINA", "DEMORA"] })), ["DEMORA", "WEB_PAGINA"]);
  const cc = r.claims.CALL_CENTER;
  assert.deepEqual([cc.conversations, cc.casesTotal], [2, 3]);
  assert.equal(cc.byMotive.find((b) => b.motive === "DEMORA")!.count, 2);
  assert.equal(cc.byMotive.find((b) => b.motive === "FACTURA")!.count, 1);
  assert.deepEqual([r.claims.ENVIOS.conversations, r.claims.TIENDA_ONLINE.conversations], [1, 1]);
});

test("cada motivo tiene un grupo, y los grupos listan todos sus motivos aunque estén en cero", () => {
  const r = build([]);
  assert.deepEqual(r.claims.ENVIOS.byMotive, [{ motive: "ENVIO_NO_LLEGO", count: 0 }, { motive: "ENVIO_ENTREGA", count: 0 }]);
  assert.deepEqual(r.claims.TIENDA_ONLINE.byMotive.map((b) => b.motive), ["WEB_SIN_CONFIRMACION", "WEB_PAGINA"]);
  assert.equal(r.claims.CALL_CENTER.byMotive.length, 9);
  assert.equal(CLAIM_MOTIVES.every((m) => CLAIM_GROUP_OF[m] !== undefined), true);
  assert.deepEqual([r.sales.conversations, r.sales.casesTotal, r.conversations], [0, 0, 100]);
});

test("lista: de la más nueva a la más vieja, con fecha, motivo y estado; el tope no cambia los conteos", () => {
  const rows = [
    row("vieja", { elsewhere: true, createdAt: at("2026-03-02T09:00") }),
    row("nueva", { bought: true, createdAt: at("2026-03-04T09:00"), open: true }),
    row("media", { pickedUp: true, createdAt: at("2026-03-03T09:00") }),
  ];
  const r = build(rows);
  assert.deepEqual(r.sales.cases.map((c) => [c.conversationId, c.motive, c.open]), [["nueva", "UNKNOWN_PLACE", true], ["media", "AT_TKL", false], ["vieja", "ELSEWHERE", false]]);
  assert.equal(r.sales.cases[0].createdAt, at("2026-03-04T09:00").toISOString());
  const top = build(rows, 2);
  assert.deepEqual([top.sales.cases.length, top.sales.casesTotal, count(top, "ELSEWHERE")], [2, 3, 1]);
});

test("nombres de sucursales: sin acentos, sin 'Call Center' y con los lugares que nombran los clientes", () => {
  const rx = new RegExp(`(^|[^a-záéíóú])(${branchNamesRegex(["America", "San Agustin", "Call Center", "La Perla"])})([^a-záéíóú]|$)`, "i");
  assert.equal(rx.test("ya compré en américa"), true);
  assert.equal(rx.test("fui a san agustín"), true);
  assert.equal(rx.test("en tkl congreso"), true);
  assert.equal(rx.test("le escribí al call center"), false);
  assert.equal(new RegExp(branchNamesRegex([]), "i").test("callao"), true);
});

test("la respuesta no lleva teléfono, nombre ni texto", () => {
  const json = JSON.stringify(build([row("a", { elsewhere: true, claims: ["DEMORA"] })]));
  assert.ok(!/phone|displayName|body/i.test(json));
});

console.log(`\nmetrics/detected: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
