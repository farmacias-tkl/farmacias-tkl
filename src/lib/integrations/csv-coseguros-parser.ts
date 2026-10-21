/**
 * Parser de {Sucursal}_coseguros.csv, generado por scripts/server/siaf_to_drive.py.
 *
 * Formato (una fila por día y código de coseguro; la sucursal sale del nombre
 * del archivo):
 *   fecha,codigo_coseguro,nombre_coseguro,comprobantes,notas_credito,importe_coseguro
 *   2026-05-21,XYZ,NOMBRE DEL COSEGURO,3,1,1500.0
 *
 * - Solo encabezado = archivo válido con 0 filas.
 * - El nombre puede venir entre comillas (csv de Python) y tener comas.
 * - El importe se conserva tal cual (negativo o cero es válido) como texto
 *   normalizado a 2 decimales, para cargarlo en Decimal(15,2) sin pasar por float.
 * - A diferencia de los parsers de ventas, una fila inválida NO se saltea:
 *   tira error y la sucursal no se carga (una fila menos cambiaría los totales).
 */
export interface ParsedCoseguroDay {
  fecha:        string;  // YYYY-MM-DD
  codigo:       string;
  nombre:       string;
  comprobantes: number;
  notasCredito: number;
  importe:      string;  // "-1234.50"
}

export const COSEGUROS_HEADER = [
  "fecha", "codigo_coseguro", "nombre_coseguro",
  "comprobantes", "notas_credito", "importe_coseguro",
] as const;

/** Separa una línea CSV (RFC 4180: comillas dobles, "" escapa una comilla). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (quoted) throw new Error("comillas sin cerrar");
  out.push(cur);
  return out;
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "1000.0" → "1000.00", "-0.5" → "-0.50". Sin pasar por float. */
export function normalizeAmount(raw: string): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) return null;
  const [, sign, ent, dec = ""] = m;
  if (dec.length > 2 && /[1-9]/.test(dec.slice(2))) return null; // más de 2 decimales reales
  const intPart = ent.replace(/^0+(?=\d)/, "");
  const decPart = (dec + "00").slice(0, 2);
  const isZero = /^0+$/.test(intPart) && decPart === "00";
  return `${isZero ? "" : sign}${intPart}.${decPart}`;
}

function toNonNegInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseCosegurosCSV(csvContent: string): ParsedCoseguroDay[] {
  const cleaned = csvContent.replace(/^﻿/, "").trim();
  if (!cleaned) throw new Error("archivo vacío (sin encabezado)");

  const lines = cleaned.split(/\r?\n/);
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(COSEGUROS_HEADER.map((k) => [k, header.indexOf(k)]));
  const missing = COSEGUROS_HEADER.filter((k) => idx[k] < 0);
  if (missing.length > 0) {
    throw new Error(`encabezado inválido. Faltan columnas: ${missing.join(", ")}. Recibido: ${header.join(",")}`);
  }

  const rows: ParsedCoseguroDay[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    const where = `línea ${i + 1}`;
    let cols: string[];
    try { cols = splitCsvLine(lines[i]); }
    catch (e) { throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`); }
    if (cols.length !== header.length) {
      throw new Error(`${where}: ${cols.length} columnas, se esperaban ${header.length}`);
    }
    const get = (k: (typeof COSEGUROS_HEADER)[number]) => cols[idx[k]].trim();

    const fecha = get("fecha");
    if (!isValidIsoDate(fecha)) throw new Error(`${where}: fecha inválida "${fecha}"`);
    const codigo = get("codigo_coseguro");
    if (!codigo) throw new Error(`${where}: codigo_coseguro vacío`);
    const comprobantes = toNonNegInt(get("comprobantes"));
    if (comprobantes === null) throw new Error(`${where}: comprobantes inválido "${get("comprobantes")}"`);
    const notasCredito = toNonNegInt(get("notas_credito"));
    if (notasCredito === null) throw new Error(`${where}: notas_credito inválido "${get("notas_credito")}"`);
    const importe = normalizeAmount(get("importe_coseguro"));
    if (importe === null) throw new Error(`${where}: importe_coseguro inválido "${get("importe_coseguro")}"`);

    const key = `${fecha}|${codigo}`;
    if (seen.has(key)) throw new Error(`${where}: fecha + código repetidos (${fecha}, ${codigo})`);
    seen.add(key);

    rows.push({ fecha, codigo, nombre: get("nombre_coseguro") || codigo, comprobantes, notasCredito, importe });
  }
  return rows;
}
