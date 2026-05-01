/**
 * Parser de los CSV generados por scripts/server/siaf_to_drive.py.
 *
 * Formato esperado (una sola fila de datos por archivo):
 *   sucursal,fecha,total_ventas,total_tickets,ticket_promedio,total_unidades,ventas_efectivo,ventas_tarjeta,ventas_obra_social
 *   America,2026-04-21,1234567.89,89,13871.10,245,450000.00,650000.00,134567.89
 */
export interface ParsedSalesDay {
  sucursal:         string;
  fecha:            string;  // YYYY-MM-DD
  totalVentas:      number;
  totalTickets:     number;
  ticketPromedio:   number;
  totalUnidades:    number;
  ventasEfectivo:   number;
  ventasTarjeta:    number;
  ventasObraSocial: number;
}

const EXPECTED_HEADER = [
  "sucursal", "fecha", "total_ventas", "total_tickets", "ticket_promedio",
  "total_unidades", "ventas_efectivo", "ventas_tarjeta", "ventas_obra_social",
] as const;

function toNum(s: string): number {
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : 0;
}

function toInt(s: string): number {
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseSalesCSV(csvContent: string): ParsedSalesDay[] {
  // Remover BOM UTF-8 si está presente (Python csv a veces lo agrega)
  const cleaned = csvContent.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];

  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(EXPECTED_HEADER.map((k) => [k, header.indexOf(k)]));

  const missing = EXPECTED_HEADER.filter((k) => idx[k] < 0);
  if (missing.length > 0) {
    throw new Error(
      `CSV header inválido. Faltan columnas: ${missing.join(", ")}. Recibido: ${header.join(",")}`,
    );
  }

  const rows: ParsedSalesDay[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < EXPECTED_HEADER.length) continue;

    rows.push({
      sucursal:         cols[idx.sucursal],
      fecha:            cols[idx.fecha],
      totalVentas:      toNum(cols[idx.total_ventas]),
      totalTickets:     toInt(cols[idx.total_tickets]),
      ticketPromedio:   toNum(cols[idx.ticket_promedio]),
      totalUnidades:    toInt(cols[idx.total_unidades]),
      ventasEfectivo:   toNum(cols[idx.ventas_efectivo]),
      ventasTarjeta:    toNum(cols[idx.ventas_tarjeta]),
      ventasObraSocial: toNum(cols[idx.ventas_obra_social]),
    });
  }

  return rows;
}

// ============================================================================
// Parser de {Sucursal}_vendedores.csv
// Columnas: sucursal, fecha, codigo_vendedor, nombre_vendedor, ventas, tickets, descuentos
// ============================================================================
export interface ParsedVendorDay {
  sucursal:       string;
  fecha:          string;
  codigoVendedor: string;
  nombreVendedor: string;
  ventas:         number;
  tickets:        number;
  descuentos:     number;
  unidades?:      number;
}

// Columnas obligatorias — `unidades` es opcional para soportar transición:
// CSVs generados por el script Python anterior no la traen y se completa con 0.
const VENDORS_HEADER_REQUIRED = [
  "sucursal", "fecha", "codigo_vendedor", "nombre_vendedor",
  "ventas", "tickets", "descuentos",
] as const;
const VENDORS_HEADER_OPTIONAL = ["unidades"] as const;

export function parseSalesVendedoresCSV(csvContent: string): ParsedVendorDay[] {
  const cleaned = csvContent.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];

  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const allKeys = [...VENDORS_HEADER_REQUIRED, ...VENDORS_HEADER_OPTIONAL];
  const idx = Object.fromEntries(allKeys.map((k) => [k, header.indexOf(k)]));

  const missing = VENDORS_HEADER_REQUIRED.filter((k) => idx[k] < 0);
  if (missing.length > 0) {
    throw new Error(
      `Vendedores CSV header inválido. Faltan columnas: ${missing.join(", ")}. Recibido: ${header.join(",")}`,
    );
  }

  const minCols = VENDORS_HEADER_REQUIRED.length;
  const rows: ParsedVendorDay[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < minCols) continue;
    rows.push({
      sucursal:       cols[idx.sucursal],
      fecha:          cols[idx.fecha],
      codigoVendedor: cols[idx.codigo_vendedor],
      nombreVendedor: cols[idx.nombre_vendedor],
      ventas:         toNum(cols[idx.ventas]),
      tickets:        toInt(cols[idx.tickets]),
      descuentos:     toNum(cols[idx.descuentos]),
      unidades:       idx.unidades >= 0 ? toInt(cols[idx.unidades] ?? "0") : 0,
    });
  }
  return rows;
}

// ============================================================================
// Parser de {Sucursal}_ossocial.csv
// Columnas: sucursal, fecha, codigo_os, nombre_os, ventas_bruto, descuentos,
//           ventas_neto, tickets, unidades
// Nota: codigo_os puede venir vacío (PARTICULAR).
// ============================================================================
export interface ParsedOSocialDay {
  sucursal:    string;
  fecha:       string;
  codigoOS:    string;
  nombreOS:    string;
  ventasBruto: number;
  descuentos:  number;
  ventasNeto:  number;
  tickets:     number;
  unidades:    number;
}

// Columnas obligatorias — `tickets` y `unidades` son opcionales para soportar
// transición: CSVs generados por el script Python anterior no las traen y se
// completan con 0 hasta que el servidor regenere los CSVs.
const OSSOCIAL_HEADER_REQUIRED = [
  "sucursal", "fecha", "codigo_os", "nombre_os",
  "ventas_bruto", "descuentos", "ventas_neto",
] as const;
const OSSOCIAL_HEADER_OPTIONAL = ["tickets", "unidades"] as const;

export function parseSalesOSSocialCSV(csvContent: string): ParsedOSocialDay[] {
  const cleaned = csvContent.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];

  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const allKeys = [...OSSOCIAL_HEADER_REQUIRED, ...OSSOCIAL_HEADER_OPTIONAL];
  const idx = Object.fromEntries(allKeys.map((k) => [k, header.indexOf(k)]));

  const missing = OSSOCIAL_HEADER_REQUIRED.filter((k) => idx[k] < 0);
  if (missing.length > 0) {
    throw new Error(
      `OS Social CSV header inválido. Faltan columnas: ${missing.join(", ")}. Recibido: ${header.join(",")}`,
    );
  }

  const minCols = OSSOCIAL_HEADER_REQUIRED.length;
  const rows: ParsedOSocialDay[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < minCols) continue;
    rows.push({
      sucursal:    cols[idx.sucursal],
      fecha:       cols[idx.fecha],
      codigoOS:    cols[idx.codigo_os],
      nombreOS:    cols[idx.nombre_os],
      ventasBruto: toNum(cols[idx.ventas_bruto]),
      descuentos:  toNum(cols[idx.descuentos]),
      ventasNeto:  toNum(cols[idx.ventas_neto]),
      tickets:     idx.tickets  >= 0 ? toInt(cols[idx.tickets]  ?? "0") : 0,
      unidades:    idx.unidades >= 0 ? toInt(cols[idx.unidades] ?? "0") : 0,
    });
  }
  return rows;
}
