// =============================================================================
// CSV mínimo para los archivos de personal (RFC 4180): campos entre comillas
// (con "" para una comilla), CRLF o LF, BOM opcional. El separador se detecta
// en la cabecera: ";" si la cabecera no tiene ",", si no ",".
// "Apellido, Nombre" lleva coma: con separador "," va entre comillas.
// =============================================================================

export interface CsvRow {
  line: number; // número de línea en el archivo (cabecera = 1)
  values: Record<string, string>;
}

export interface CsvFile {
  headers: string[];
  rows: CsvRow[];
}

function splitRecords(text: string, sep: string): Array<{ line: number; fields: string[] }> {
  const out: Array<{ line: number; fields: string[] }> = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === sep) { fields.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") {
      fields.push(field);
      out.push({ line: recordLine, fields });
      fields = []; field = "";
      line++; recordLine = line;
      continue;
    }
    field += c;
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    out.push({ line: recordLine, fields });
  }
  return out;
}

export function parseCsv(content: string): CsvFile {
  const text = content.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes(",") ? "," : firstLine.includes(";") ? ";" : ",";
  const records = splitRecords(text, sep).filter((r) => r.fields.some((f) => f.trim() !== ""));
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].fields.map((h) => h.trim().toLowerCase());
  const rows = records.slice(1).map((r) => ({
    line: r.line,
    values: Object.fromEntries(headers.map((h, i) => [h, (r.fields[i] ?? "").trim()])),
  }));
  return { headers, rows };
}
