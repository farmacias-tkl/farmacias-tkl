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

function parseSheet(sheetName: string, sheet: XLSX.WorkSheet, warnings: string[]): ParsedBalanceRow[] {
  let rawRows: unknown[][];
  try {
    rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  } catch (e) {
    warnings.push(`Sheet "${sheetName}": error al parsear — ${String(e)}`);
    return [];
  }
  if (rawRows.length === 0) return [];
  const results: ParsedBalanceRow[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row)) continue;
    const colA = row[0];
    if (!colA || String(colA).trim() === "") continue;
    const sucursal = normalizeText(colA);
    if (sucursal === "SUCURSAL" || sucursal === "BRANCH") continue;
    const saldo = parseNumber(row[2]);
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
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) { sheetsSkipped.push(sheetName); continue; }
    const rows = parseSheet(sheetName, sheet, warnings);
    if (rows.length > 0) {
      allRows = allRows.concat(rows);
      sheetsProcessed.push(sheetName);
    } else {
      sheetsSkipped.push(sheetName);
    }
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
