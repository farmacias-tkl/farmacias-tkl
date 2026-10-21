/**
 * Tests PUROS del parser de {Sucursal}_coseguros.csv. Datos inventados.
 *   npx tsx src/lib/integrations/csv-coseguros-parser.test.ts
 */
import assert from "node:assert/strict";
import { parseCosegurosCSV, normalizeAmount } from "./csv-coseguros-parser";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const H = "fecha,codigo_coseguro,nombre_coseguro,comprobantes,notas_credito,importe_coseguro";

test("solo encabezado → 0 filas, no es error", () => {
  assert.deepEqual(parseCosegurosCSV(H + "\r\n"), []);
  assert.deepEqual(parseCosegurosCSV(H), []);
  assert.deepEqual(parseCosegurosCSV("﻿" + H + "\n\n"), []);
});

test("archivo vacío (sin encabezado) → error", () => {
  assert.throws(() => parseCosegurosCSV(""), /vacío/);
  assert.throws(() => parseCosegurosCSV("  \r\n"), /vacío/);
});

test("filas con NCR e importe negativo se conservan tal cual", () => {
  const rows = parseCosegurosCSV([H, "2026-03-02,AAA,COSEGURO A,4,1,1500.0", "2026-03-02,BBB,COSEGURO B,1,1,-250.5"].join("\r\n"));
  assert.deepEqual(rows, [
    { fecha: "2026-03-02", codigo: "AAA", nombre: "COSEGURO A", comprobantes: 4, notasCredito: 1, importe: "1500.00" },
    { fecha: "2026-03-02", codigo: "BBB", nombre: "COSEGURO B", comprobantes: 1, notasCredito: 1, importe: "-250.50" },
  ]);
});

test("importe cero es válido", () => {
  const [r] = parseCosegurosCSV(`${H}\n2026-03-03,CCC,COSEGURO C,2,0,0.0`);
  assert.equal(r.importe, "0.00");
});

test("nombre entre comillas, con coma y comilla escapada (csv de Python)", () => {
  const [r] = parseCosegurosCSV(`${H}\n2026-03-04,DDD,"COSEGURO ""D"", PLAN 2",1,0,10.25`);
  assert.equal(r.nombre, 'COSEGURO "D", PLAN 2');
  assert.equal(r.importe, "10.25");
});

test("nombre vacío → se usa el código", () => {
  const [r] = parseCosegurosCSV(`${H}\n2026-03-04,EEE,,1,0,10`);
  assert.equal(r.nombre, "EEE");
});

test("columnas en otro orden se leen por nombre", () => {
  const [r] = parseCosegurosCSV("importe_coseguro,fecha,codigo_coseguro,nombre_coseguro,notas_credito,comprobantes\n-5,2026-01-01,FFF,X,1,2");
  assert.deepEqual(r, { fecha: "2026-01-01", codigo: "FFF", nombre: "X", comprobantes: 2, notasCredito: 1, importe: "-5.00" });
});

test("filas inválidas → error con número de línea (la sucursal no se carga)", () => {
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-30,AAA,A,1,0,1`), /línea 2: fecha inválida/);
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,,A,1,0,1`), /codigo_coseguro vacío/);
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,AAA,A,1.5,0,1`), /comprobantes inválido/);
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,AAA,A,1,-1,1`), /notas_credito inválido/);
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,AAA,A,1,0,abc`), /importe_coseguro inválido/);
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,AAA,A,1,0`), /columnas/);
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,AAA,"A,1,0,1`), /comillas/);
  assert.throws(() => parseCosegurosCSV(`${H}\nx\n2026-02-01,AAA,A,1,0,1`), /línea 2/);
});

test("fecha + código repetidos en el mismo archivo → error", () => {
  assert.throws(() => parseCosegurosCSV(`${H}\n2026-02-01,AAA,A,1,0,1\n2026-02-01,AAA,A,2,0,3`), /repetidos/);
});

test("encabezado incompleto → error", () => {
  assert.throws(() => parseCosegurosCSV("fecha,codigo_coseguro,comprobantes\n2026-01-01,A,1"), /Faltan columnas: nombre_coseguro, notas_credito, importe_coseguro/);
});

test("normalizeAmount: 2 decimales sin pasar por float", () => {
  assert.equal(normalizeAmount("12345678.91"), "12345678.91");
  assert.equal(normalizeAmount("1000.0"), "1000.00");
  assert.equal(normalizeAmount("1000"), "1000.00");
  assert.equal(normalizeAmount("-0.5"), "-0.50");
  assert.equal(normalizeAmount("-0.0"), "0.00");
  assert.equal(normalizeAmount("0.10"), "0.10");
  assert.equal(normalizeAmount("12.340"), "12.34");
  assert.equal(normalizeAmount("12.345"), null);
  assert.equal(normalizeAmount("1e-05"), null);
  assert.equal(normalizeAmount(""), null);
});

console.log(`\n${passed} de ${passed + failures.length} verificaciones pasan`);
if (failures.length > 0) process.exit(1);
