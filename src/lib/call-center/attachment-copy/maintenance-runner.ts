/**
 * B6.3-C4b — Camino "solo mantenimiento" del endpoint (copia apagada): M1–M3, sin preflight,
 * sin R2, sin reservar ni copiar. NO importa el SDK de R2 (ni el worker): el endpoint lo carga
 * con import dinámico para que este camino no arrastre @aws-sdk.
 *
 * SyncLog ATTACHMENT_STORAGE con los mismos criterios que el worker: solo si hubo M1/M2 (ERROR),
 * M3 (PARTIAL) o si el mantenimiento falló (ERROR). Solo códigos y conteos.
 */
import type { PrismaClient } from "@prisma/client";
import { safeErrorCode } from "../safe-error";
import { runMaintenance, type MaintenanceResult } from "./maintenance";
import type { SourceFetcher } from "./source-fetcher";

export interface MaintenanceOnlyResult {
  /** null si el mantenimiento falló. */
  maintenance: MaintenanceResult | null;
  ok: boolean;
}

export async function runMaintenanceOnly(prisma: PrismaClient, now: Date, fetchers: readonly SourceFetcher[]): Promise<MaintenanceOnlyResult> {
  let maintenance: MaintenanceResult | null = null;
  const warnings: string[] = [];
  try {
    maintenance = await runMaintenance(prisma, now, fetchers);
  } catch (e) {
    const code = safeErrorCode(e, "copy.maintenance");
    warnings.push(`MAINTENANCE_FAILED:${code}`);
    console.error("[attachment-copy] maintenance failed", JSON.stringify({ code }));
  }

  const m = maintenance;
  if (m) {
    if (m.leasesRecovered) warnings.push(`M1_LEASE_EXPIRED_MAX:${m.leasesRecovered}`);
    if (m.attachmentsTtlNoOrigin) warnings.push(`M2_SOURCE_TTL_EXPIRED:${m.attachmentsTtlNoOrigin}`);
    if (m.webhookUrlsCleared) warnings.push(`M3_WEBHOOK_URLS_CLEARED:${m.webhookUrlsCleared}`);
  }
  if (warnings.length) {
    const severe = !m || m.leasesRecovered > 0 || m.attachmentsTtlNoOrigin > 0;
    try {
      await prisma.syncLog.create({
        data: {
          source: "ATTACHMENT_STORAGE",
          status: severe ? "ERROR" : "PARTIAL",
          message: "attachment-copy: maintenance_only",
          rowsProcessed: 0,
          warnings,
          syncDate: now,
          triggeredBy: "CRON",
        },
      });
    } catch (e) {
      console.error("[attachment-copy] synclog failed", JSON.stringify({ code: safeErrorCode(e, "copy.synclog") }));
    }
  }
  return { maintenance: m, ok: m !== null };
}
