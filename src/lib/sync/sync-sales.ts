import { prisma } from "@/lib/prisma";
import { downloadSalesCSVs } from "@/lib/integrations/google-drive";
import { parseSalesCSV } from "@/lib/integrations/csv-sales-parser";
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
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const warnings: string[] = [];
  let rowsProcessed = 0;
  let rowsSkipped = 0;

  const folderId = process.env.GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID not set");

  const csvs = await downloadSalesCSVs(folderId);
  if (csvs.length === 0) {
    const result: SyncSalesResult = {
      status: "NO_FILE",
      message: "No hay CSVs de ventas recientes en Drive",
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

  for (const csv of csvs) {
    // Idempotency: skip si ya procesamos este fileId antes
    const processed = await prisma.sourceFile.findUnique({ where: { driveFileId: csv.driveFileId } });
    if (processed?.status === "processed") {
      continue;
    }

    let rows;
    try {
      rows = parseSalesCSV(csv.csvContent);
    } catch (e) {
      warnings.push(`Parse error en ${csv.driveFileName}: ${String(e)}`);
      rowsSkipped++;
      continue;
    }

    for (const row of rows) {
      const branchId = resolveBranchId(row.sucursal.toUpperCase(), branches);
      if (!branchId) {
        warnings.push(`Sucursal "${row.sucursal}" no encontrada (archivo ${csv.driveFileName})`);
        rowsSkipped++;
        continue;
      }

      const snapshotDate = new Date(row.fecha);
      snapshotDate.setHours(0, 0, 0, 0);

      const rawData: Prisma.InputJsonValue = {
        source:      "siaf",
        efectivo:    row.ventasEfectivo,
        tarjeta:     row.ventasTarjeta,
        obra_social: row.ventasObraSocial,
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
        warnings.push(`Error guardando ${row.sucursal}/${row.fecha}: ${String(e)}`);
        rowsSkipped++;
      }
    }

    // Marcar el archivo como procesado (idempotency)
    try {
      await prisma.sourceFile.upsert({
        where: { driveFileId: csv.driveFileId },
        update: { status: "processed", rowsCount: rows.length, processedAt: new Date() },
        create: {
          driveFileId: csv.driveFileId,
          filename:    csv.driveFileName,
          fileDate:    new Date(csv.fileDate),
          processedAt: new Date(),
          rowsCount:   rows.length,
          status:      "processed",
        },
      });
    } catch (e) {
      warnings.push(`Error marcando SourceFile ${csv.driveFileName}: ${String(e)}`);
    }
  }

  const finalStatus: SyncStatus =
    rowsSkipped > 0 && rowsProcessed === 0 ? "ERROR" :
    rowsSkipped > 0                         ? "PARTIAL" : "SUCCESS";

  const result: SyncSalesResult = {
    status:  finalStatus,
    message: `${rowsProcessed} filas procesadas, ${rowsSkipped} ignoradas. ${csvs.length} archivos.`,
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
