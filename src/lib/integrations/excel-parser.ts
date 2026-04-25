import * as XLSX from "xlsx";

export interface ParsedBalanceRow {
  sucursal: string;
  banco: string;
  saldo: number;
  cheques: number | null;
  saldoAnterior: number | null;
  fuentePestana: string;
}

export interface ParseResult {
  rows: ParsedBalanceRow[];
  warnings: string[];
  sheetsProcessed: string[];
  sheetsSkipped: string[];
  totalRows: number;
}

export interface BranchMapping {
  id: string;
  name: string;
  aliases: string[];
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase().replace(/\s+/g, " ");
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).replace(/[^\d.,-]/g, "").replace(",", ".");
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/** Encuentra el índice de la fila de header buscando "SALDO" en col C. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (normalizeText(row[2]) === "SALDO") return i;
  }
  return -1;
}

function parseSheet(sheetName: string, sheet: XLSX.WorkSheet, warnings: string[]): ParsedBalanceRow[] {
  let rawRows: unknown[][];
  try {
    rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  } catch (e) {
    warnings.push(`Sheet "${sheetName}": error al parsear — ${String(e)}`);
    return [];
  }
  if (rawRows.length === 0) return [];

  // Header dinámico — saltea fila 1 (título + fecha en B1) y cualquier preámbulo
  const headerIdx = findHeaderRow(rawRows);
  if (headerIdx === -1) {
    warnings.push(`Sheet "${sheetName}": no se encontró header con "SALDO" en col C — sheet ignorada`);
    return [];
  }

  const results: ParsedBalanceRow[] = [];
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row)) continue;
    const colA = row[0];
    const colC = row[2];

    // Skip filas vacías intercaladas (col A Y col C ambas vacías)
    const aEmpty = colA === null || colA === undefined || String(colA).trim() === "";
    const cEmpty = colC === null || colC === undefined || String(colC).trim() === "";
    if (aEmpty && cEmpty) continue;
    // Sucursal vacía con saldo presente → fila inconsistente, skip
    if (aEmpty) continue;

    const sucursal = normalizeText(colA);
    const saldo = parseNumber(colC);
    if (saldo === null) {
      warnings.push(`Sheet "${sheetName}" fila ${i + 1}: saldo vacío para "${sucursal}" — ignorada`);
      continue;
    }

    results.push({
      sucursal,
      banco: normalizeText(row[1]),
      saldo,
      cheques: parseNumber(row[3]),
      saldoAnterior: parseNumber(row[4]),
      fuentePestana: sheetName,
    });
  }
  return results;
}

export function parseBalancesExcel(buffer: ArrayBuffer): ParseResult {
  const warnings: string[] = [];
  const sheetsProcessed: string[] = [];
  const sheetsSkipped: string[] = [];
  let allRows: ParsedBalanceRow[] = [];
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    throw new Error(`No se pudo leer el Excel: ${String(e)}`);
  }
  // Solo la primera hoja (índice 0 — "SALDOS"). Las restantes se ignoran explícitamente.
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      rows: [],
      warnings: ["Excel sin hojas"],
      sheetsProcessed: [],
      sheetsSkipped: [],
      totalRows: 0,
    };
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (sheet) {
    const rows = parseSheet(firstSheetName, sheet, warnings);
    if (rows.length > 0) {
      allRows = rows;
      sheetsProcessed.push(firstSheetName);
    } else {
      sheetsSkipped.push(firstSheetName);
    }
  } else {
    sheetsSkipped.push(firstSheetName);
  }
  // Las hojas restantes se registran como skipped (no se leen)
  for (let i = 1; i < workbook.SheetNames.length; i++) {
    sheetsSkipped.push(workbook.SheetNames[i]);
  }

  return { rows: allRows, warnings, sheetsProcessed, sheetsSkipped, totalRows: allRows.length };
}

export function resolveBranchId(sucursalNormalized: string, branches: BranchMapping[]): string | null {
  for (const branch of branches) {
    if (normalizeText(branch.name) === sucursalNormalized) return branch.id;
    if (branch.aliases.some((a) => normalizeText(a) === sucursalNormalized)) return branch.id;
  }
  return null;
}
