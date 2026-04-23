import { prisma } from "@/lib/prisma";
import { downloadSalesCSVs } from "@/lib/integrations/google-drive";
import {
  parseSalesCSV,
  parseSalesVendedoresCSV,
  parseSalesOSSocialCSV,
} from "@/lib/integrations/csv-sales-parser";
import type {
  ParsedVendorDay,
  ParsedOSocialDay,
} from "@/lib/integrations/csv-sales-parser";
import { resolveBranchId, type BranchMapping } from "@/lib/integrations/excel-parser";
import type { SyncStatus, Prisma } from "@prisma/client";

export interface SyncSalesResult {
  status:        SyncStatus;
  message:       string;
  rowsProcessed: number;
  rowsSkipped:   number;
  warnings:      string[];
  durationMs:    number;
  syncDate:      Date;
}

export async function syncSales(): Promise<SyncSalesResult> {
  const startTime = Date.now();
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const warnings: string[] = [];
  let rowsProcessed = 0;
  let rowsSkipped   = 0;

  const folderId = process.env.GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID not set");

  const branchSets = await downloadSalesCSVs(folderId);
  if (branchSets.length === 0) {
    const result: SyncSalesResult = {
      status: "NO_FILE",
      message: "No hay CSVs de ventas en la carpeta de Drive",
      rowsProcessed: 0, rowsSkipped: 0, warnings: [],
      durationMs: Date.now() - startTime, syncDate: today,
    };
    await writeSyncLog(result, today);
    return result;
  }

  const branches: BranchMapping[] = await prisma.branch.findMany({
    where: { active: true },
    select: { id: true, name: true, aliases: true },
  });

  for (const set of branchSets) {
    const branchId = resolveBranchId(set.sucursalName.toUpperCase(), branches);
    if (!branchId) {
      warnings.push(`Sucursal "${set.sucursalName}" no encontrada en DB — skip`);
      rowsSkipped++;
      continue;
    }

    if (!set.ventas) {
      warnings.push(`[${set.sucursalName}] falta ventas.csv — skip sucursal`);
      rowsSkipped++;
      continue;
    }

    // Parsear los 3 CSVs
    let ventasRows;
    try {
      ventasRows = parseSalesCSV(set.ventas.csvContent);
    } catch (e) {
      warnings.push(`[${set.sucursalName}] parse error ventas.csv: ${String(e)}`);
      rowsSkipped++;
      continue;
    }

    let vendedoresRows: ParsedVendorDay[] = [];
    if (set.vendedores) {
      try {
        vendedoresRows = parseSalesVendedoresCSV(set.vendedores.csvContent);
      } catch (e) {
        warnings.push(`[${set.sucursalName}] parse error vendedores.csv: ${String(e)} — continuando sin detalle vendedores`);
      }
    } else {
      warnings.push(`[${set.sucursalName}] falta vendedores.csv — continuando sin detalle vendedores`);
    }

    let ossocialRows: ParsedOSocialDay[] = [];
    if (set.ossocial) {
      try {
        ossocialRows = parseSalesOSSocialCSV(set.ossocial.csvContent);
      } catch (e) {
        warnings.push(`[${set.sucursalName}] parse error ossocial.csv: ${String(e)} — continuando sin detalle OS`);
      }
    } else {
      warnings.push(`[${set.sucursalName}] falta ossocial.csv — continuando sin detalle OS`);
    }

    // Indexar vendedores y OS por fecha para lookup rápido
    const vendorsByDate = new Map<string, ParsedVendorDay[]>();
    for (const v of vendedoresRows) {
      const arr = vendorsByDate.get(v.fecha) ?? [];
      arr.push(v);
      vendorsByDate.set(v.fecha, arr);
    }
    const osByDate = new Map<string, ParsedOSocialDay[]>();
    for (const o of ossocialRows) {
      const arr = osByDate.get(o.fecha) ?? [];
      arr.push(o);
      osByDate.set(o.fecha, arr);
    }

    // Procesar cada día de la sucursal
    for (const row of ventasRows) {
      const snapshotDate = new Date(row.fecha);
      snapshotDate.setHours(0, 0, 0, 0);

      // Construir rawData enriquecido — solo incluir listas si tienen contenido real
      const vendors = (vendorsByDate.get(row.fecha) ?? [])
        .sort((a, b) => b.ventas - a.ventas)
        .map(v => ({
          codigo:     v.codigoVendedor,
          nombre:     v.nombreVendedor,
          ventas:     v.ventas,
          tickets:    v.tickets,
          descuentos: v.descuentos,
        }));

      const obrasSoc = (osByDate.get(row.fecha) ?? [])
        .sort((a, b) => b.ventasNeto - a.ventasNeto)
        .map(o => ({
          codigo:       o.codigoOS,
          nombre:       o.nombreOS,
          ventas_bruto: o.ventasBruto,
          descuentos:   o.descuentos,
          ventas_neto:  o.ventasNeto,
        }));

      const rawData: Prisma.InputJsonValue = {
        source:         "siaf",
        efectivo:       row.ventasEfectivo,
        tarjeta:        row.ventasTarjeta,
        obra_social:    row.ventasObraSocial,
        vendedores:     vendors,
        obras_sociales: obrasSoc,
      };

      try {
        await prisma.salesSnapshot.upsert({
          where: { branchId_snapshotDate: { branchId, snapshotDate } },
          update: {
            totalSales: row.totalVentas,
            units:      row.totalUnidades,
            receipts:   row.totalTickets,
            avgTicket:  row.ticketPromedio,
            rawData,
            dataSource: "siaf",
          },
          create: {
            branchId, snapshotDate,
            totalSales: row.totalVentas,
            units:      row.totalUnidades,
            receipts:   row.totalTickets,
            avgTicket:  row.ticketPromedio,
            rawData,
            dataSource: "siaf",
          },
        });
        rowsProcessed++;
      } catch (e) {
        warnings.push(`[${set.sucursalName}] error upsert ${row.fecha}: ${String(e)}`);
        rowsSkipped++;
      }
    }
  }

  const finalStatus: SyncStatus =
    rowsSkipped > 0 && rowsProcessed === 0 ? "ERROR" :
    rowsSkipped > 0                         ? "PARTIAL" : "SUCCESS";

  const result: SyncSalesResult = {
    status:  finalStatus,
    message: `${rowsProcessed} filas procesadas, ${rowsSkipped} ignoradas. ${branchSets.length} sucursales.`,
    rowsProcessed, rowsSkipped, warnings,
    durationMs: Date.now() - startTime, syncDate: today,
  };
  await writeSyncLog(result, today);
  return result;
}

async function writeSyncLog(result: SyncSalesResult, syncDate: Date) {
  try {
    await prisma.syncLog.create({
      data: {
        source:        "SALES_API",
        status:        result.status,
        message:       result.message,
        rowsProcessed: result.rowsProcessed,
        warnings:      result.warnings.length > 0 ? result.warnings : undefined,
        durationMs:    result.durationMs,
        syncDate,
        triggeredBy:   "WEBHOOK",
      },
    });
  } catch (e) {
    console.error("Error escribiendo sync_log (sales):", e);
  }
}
