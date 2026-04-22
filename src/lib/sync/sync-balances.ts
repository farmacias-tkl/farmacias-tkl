import { prisma } from "@/lib/prisma";
import { getBalancesFileBuffer } from "@/lib/integrations/google-drive";
import { parseBalancesExcel, resolveBranchId, type BranchMapping } from "@/lib/integrations/excel-parser";
import type { SyncStatus } from "@prisma/client";

export interface SyncBalancesResult {
  status: SyncStatus;
  message: string;
  rowsProcessed: number;
  rowsSkipped: number;
  warnings: string[];
  durationMs: number;
  isStale: boolean;
  syncDate: Date;
}

export async function syncBalances(): Promise<SyncBalancesResult> {
  const startTime = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warnings: string[] = [];
  let rowsProcessed = 0;
  let rowsSkipped = 0;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID not set");

  const fileResult = await getBalancesFileBuffer(folderId);
  if (!fileResult) {
    const result: SyncBalancesResult = {
      status: "NO_FILE",
      message: "No se encontró archivo en Drive",
      rowsProcessed: 0, rowsSkipped: 0, warnings: [],
      durationMs: Date.now() - startTime, isStale: false, syncDate: today,
    };
    await writeSyncLog(result, today);
    return result;
  }

  const { buffer, file, isStale } = fileResult;
  const alreadyProcessed = await prisma.sourceFile.findUnique({ where: { driveFileId: file.id } });
  if (alreadyProcessed?.status === "processed") {
    return {
      status: "SUCCESS",
      message: `Archivo ${file.name} ya procesado (idempotente)`,
      rowsProcessed: alreadyProcessed.rowsCount, rowsSkipped: 0, warnings: [],
      durationMs: Date.now() - startTime, isStale, syncDate: today,
    };
  }

  let parseResult;
  try {
    parseResult = parseBalancesExcel(buffer);
  } catch (e) {
    const result: SyncBalancesResult = {
      status: "ERROR",
      message: `Error parseando Excel: ${String(e)}`,
      rowsProcessed: 0, rowsSkipped: 0, warnings: [],
      durationMs: Date.now() - startTime, isStale, syncDate: today,
    };
    await writeSyncLog(result, today);
    return result;
  }

  warnings.push(...parseResult.warnings);
  if (parseResult.totalRows === 0) {
    const result: SyncBalancesResult = {
      status: "PARTIAL",
      message: "Sin filas válidas en el Excel",
      rowsProcessed: 0, rowsSkipped: 0, warnings,
      durationMs: Date.now() - startTime, isStale, syncDate: today,
    };
    await writeSyncLog(result, today);
    return result;
  }

  const branches: BranchMapping[] = await prisma.branch.findMany({
    where: { active: true },
    select: { id: true, name: true, aliases: true },
  });
  const snapshotDate = isStale ? new Date(file.modifiedTime) : new Date(today);
  snapshotDate.setHours(0, 0, 0, 0);

  for (const row of parseResult.rows) {
    const branchId = resolveBranchId(row.sucursal, branches);
    if (!branchId) {
      warnings.push(`Sucursal "${row.sucursal}" no encontrada en DB`);
      rowsSkipped++;
      continue;
    }
    try {
      await prisma.bankBalanceSnapshot.upsert({
        where: {
          branchId_bankName_accountLabel_snapshotDate: {
            branchId, bankName: row.banco, accountLabel: row.banco, snapshotDate,
          },
        },
        update: {
          balance: row.saldo, checks: row.cheques, prevBalance: row.saldoAnterior,
          sourceSheet: row.fuentePestana,
        },
        create: {
          branchId, bankName: row.banco, accountLabel: row.banco,
          balance: row.saldo, checks: row.cheques, prevBalance: row.saldoAnterior,
          snapshotDate, sourceSheet: row.fuentePestana,
        },
      });
      rowsProcessed++;
    } catch (e) {
      warnings.push(`Error guardando "${row.sucursal}/${row.banco}": ${String(e)}`);
      rowsSkipped++;
    }
  }

  await prisma.sourceFile.upsert({
    where: { driveFileId: file.id },
    update: {
      status: rowsProcessed > 0 ? "processed" : "error",
      rowsCount: rowsProcessed, processedAt: new Date(),
    },
    create: {
      driveFileId: file.id, filename: file.name, fileDate: snapshotDate,
      processedAt: new Date(), rowsCount: rowsProcessed,
      status: rowsProcessed > 0 ? "processed" : "error",
    },
  });

  const finalStatus: SyncStatus =
    rowsSkipped > 0 && rowsProcessed === 0 ? "ERROR" :
    rowsSkipped > 0                        ? "PARTIAL" :
    isStale                                ? "STALE" : "SUCCESS";

  const result: SyncBalancesResult = {
    status: finalStatus,
    message: `${rowsProcessed} filas procesadas, ${rowsSkipped} ignoradas. Archivo: ${file.name}`,
    rowsProcessed, rowsSkipped, warnings,
    durationMs: Date.now() - startTime, isStale, syncDate: today,
  };
  await writeSyncLog(result, today);
  return result;
}

async function writeSyncLog(result: SyncBalancesResult, syncDate: Date) {
  try {
    await prisma.syncLog.create({
      data: {
        source: "GOOGLE_DRIVE",
        status: result.status,
        message: result.message,
        rowsProcessed: result.rowsProcessed,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
        durationMs: result.durationMs,
        syncDate,
        triggeredBy: "WEBHOOK",
      },
    });
  } catch (e) {
    console.error("Error escribiendo sync_log:", e);
  }
}
