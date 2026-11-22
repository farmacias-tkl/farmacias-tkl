/**
 * Paginación de la bandeja. PURO.
 *
 *   npx tsx src/lib/call-center/inbox-pagination.test.ts
 */
import assert from "node:assert/strict";
import { INBOX_PAGE_SIZE, inboxHref, inboxPageInfo, parsePage } from "./inbox-pagination";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

test("parsePage: valores válidos y todo lo raro cae en 1", () => {
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage(undefined), 1);
  for (const raro of ["", "0", "-2", "1.5", "abc", "2; DROP", "9999999"]) assert.equal(parsePage(raro), 1, raro);
});

test("primera página de muchas", () => {
  const p = inboxPageInfo(22702, 1);
  assert.deepEqual([p.page, p.skip, p.from, p.to, p.hasPrev, p.hasNext], [1, 0, 1, INBOX_PAGE_SIZE, false, true]);
  assert.equal(p.totalPages, 455);
});

test("última página: incompleta, sin siguiente", () => {
  const p = inboxPageInfo(22702, 455);
  assert.deepEqual([p.from, p.to, p.hasPrev, p.hasNext], [22701, 22702, true, false]);
});

test("página pedida más allá de la última → la última", () => {
  const p = inboxPageInfo(120, 99);
  assert.deepEqual([p.page, p.skip, p.from, p.to], [3, 100, 101, 120]);
});

test("sin conversaciones: una página vacía, sin anterior ni siguiente", () => {
  const p = inboxPageInfo(0, 1);
  assert.deepEqual([p.page, p.totalPages, p.skip, p.from, p.to, p.hasPrev, p.hasNext], [1, 1, 0, 0, 0, false, false]);
});

test("total justo en el límite de página", () => {
  assert.equal(inboxPageInfo(50, 1).hasNext, false);
  assert.equal(inboxPageInfo(51, 1).hasNext, true);
  assert.deepEqual([inboxPageInfo(51, 2).from, inboxPageInfo(51, 2).to], [51, 51]);
});

test("enlaces: conservan el filtro de estado; la página 1 no lleva ?page", () => {
  assert.equal(inboxHref(null, 1), "/call-center");
  assert.equal(inboxHref(null, 3), "/call-center?page=3");
  assert.equal(inboxHref("RESUELTA", 1), "/call-center?status=RESUELTA");
  assert.equal(inboxHref("RESUELTA", 2), "/call-center?status=RESUELTA&page=2");
});

console.log(`\ninbox-pagination: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
