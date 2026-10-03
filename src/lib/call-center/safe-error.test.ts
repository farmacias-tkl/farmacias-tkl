/**
 * Tests de safeErrorCode / tagErrorStage (B6.3-C2b). PUROS: sin DB/red.
 *   npx tsx src/lib/call-center/safe-error.test.ts
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { safeErrorCode, tagErrorStage } from "./safe-error";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Mensaje de error estilo Prisma: incluye los ARGS del create (URL con token + texto de cliente).
const URL_SENTINEL = "https://files.example/rails/active_storage/blobs/SENTINEL_TOKEN/receta.pdf";
const PII_SENTINEL = "SENTINEL_CLIENTE hola necesito mi receta";
const LEAKY_MESSAGE = `Invalid \`tx.conversationAttachment.create()\` invocation:\n{ data: { sourceFetchUrl: "${URL_SENTINEL}", body: "${PII_SENTINEL}" } }`;
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(LEAKY_MESSAGE, { code, clientVersion: "5.22.0", meta } as any);
const noLeak = (s: string) => {
  for (const leak of ["SENTINEL", "files.example", "receta", "hola", "invocation", "sourceFetchUrl"]) {
    assert.ok(!s.includes(leak), `no debe contener "${leak}": ${s}`);
  }
};

test("1. Prisma known error con message filtrante → solo stage|name|code; sin sentinelas", () => {
  const s = safeErrorCode(known("P2020"), "processor.tx");
  assert.equal(s, "processor.tx|PrismaClientKnownRequestError|P2020|");
  noLeak(s);
});

test("2. meta.target válido (array de columnas) → se incluye", () => {
  assert.equal(safeErrorCode(known("P2002", { target: ["sourceExternalId"] }), "processor.tx"), "processor.tx|PrismaClientKnownRequestError|P2002|sourceExternalId");
  assert.equal(safeErrorCode(known("P2002", { target: ["a", "b_2"] }), "x"), "x|PrismaClientKnownRequestError|P2002|a,b_2");
});

test("3. meta.target raro (string, valores, objetos, vacío, demasiados) → se omite", () => {
  for (const target of [
    "Customer_phone_key",                    // string (nombre de constraint) → omitido
    [URL_SENTINEL],                          // valor con URL
    ["phone", "+54 9 11 1234"],              // un valor no-columna invalida todo
    [{ col: "x" }],
    [],
    Array.from({ length: 11 }, (_, i) => `c${i}`),
  ]) {
    const s = safeErrorCode(known("P2002", { target, modelName: PII_SENTINEL }), "processor.tx");
    assert.equal(s, "processor.tx|PrismaClientKnownRequestError|P2002|");
    noLeak(s);
  }
});

test("4. PrismaClientValidationError (overflow de Int con args en el message) → sin message", () => {
  const e = new Prisma.PrismaClientValidationError(LEAKY_MESSAGE, { clientVersion: "5.22.0" } as any);
  const s = safeErrorCode(e, "processor.tx");
  assert.equal(s, "processor.tx|PrismaClientValidationError||");
  noLeak(s);
});

test("5. Error genérico / no-Error / name y code raros → nada de su contenido", () => {
  assert.equal(safeErrorCode(new Error(PII_SENTINEL), "route.create"), "route.create|Error||");
  assert.equal(safeErrorCode(PII_SENTINEL, "route.create"), "route.create|NonError||");
  assert.equal(safeErrorCode(null, "route.create"), "route.create|NonError||");
  const weird = Object.assign(new Error(PII_SENTINEL), { name: "Bad name with spaces SENTINEL", code: "sentinel lower" });
  const s = safeErrorCode(weird, "route.create");
  assert.equal(s, "route.create|Error||");
  noLeak(s);
  // code propio/sistema en UPPER_SNAKE sí se conserva
  assert.equal(safeErrorCode(Object.assign(new Error("x"), { code: "ECONNRESET" }), "s"), "s|Error|ECONNRESET|");
});

test("6. stage inválido → 'unknown'; resultado truncado a 200", () => {
  assert.equal(safeErrorCode(new Error("x"), "Stage Con Espacios"), "unknown|Error||");
  const e = Object.assign(new Error("x"), { name: "N".repeat(64) });
  assert.ok(safeErrorCode(e, "s").length <= 200);
});

test("7. tagErrorStage: stage etiquetado prevalece; no cambia tipo/instanceof; no enumerable; no se re-etiqueta", () => {
  const e = known("P2002", { target: ["sourceExternalId"] });
  const t = tagErrorStage(e, "ingest.attachment");
  assert.equal(t, e, "misma identidad");
  assert.ok(t instanceof Prisma.PrismaClientKnownRequestError, "instanceof intacto");
  assert.equal((t as any).code, "P2002");
  assert.equal(safeErrorCode(t, "processor.tx"), "ingest.attachment|PrismaClientKnownRequestError|P2002|sourceExternalId");
  assert.ok(!Object.keys(t).some((k) => k.includes("Stage")), "no enumerable");
  tagErrorStage(t, "otro.stage");
  assert.ok(safeErrorCode(t, "x").startsWith("ingest.attachment|"), "el primer tag (el más interno) gana");
  assert.equal(tagErrorStage("no-objeto", "s"), "no-objeto");
});

console.log(`\nsafe-error: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
