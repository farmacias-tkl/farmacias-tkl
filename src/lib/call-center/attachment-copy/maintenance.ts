/**
 * B6.3-C3 — Mantenimiento del job de copia. Corre ANTES de copiar, en cada invocación, aun con
 * la copia apagada. Idempotente: cada paso es un único updateMany.
 *
 *  M1: COPYING con lease vencido y attempts ≥ MAX → FAILED 'LEASE_EXPIRED_MAX' (URL y lease NULL).
 *  M2: origen con TTL vencido (por fetcher/source) → NO_ORIGIN 'SOURCE_TTL_EXPIRED' (URL NULL).
 *      No pisa un lease vigente (ese worker cierra; si falla, la próxima corrida lo barre).
 *  M3: WebhookEvent RECEIVED/ERROR con > 72 h → transientSourceUrls = DbNull (SQL NULL).
 *
 * Los adjuntos históricos sin URL NO se tocan (ningún paso los selecciona).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { MAX_ATTEMPTS, WEBHOOK_TRANSIENT_TTL_HOURS } from "./constants";
import type { SourceFetcher } from "./source-fetcher";

export interface MaintenanceResult {
  leasesRecovered: number;
  attachmentsTtlNoOrigin: number;
  webhookUrlsCleared: number;
}

export async function runMaintenance(
  prisma: PrismaClient,
  now: Date,
  fetchers: readonly SourceFetcher[],
): Promise<MaintenanceResult> {
  // M1
  const m1 = await prisma.conversationAttachment.updateMany({
    where: { storageStatus: "COPYING", storageNextRetryAt: { lte: now }, storageAttemptCount: { gte: MAX_ATTEMPTS } },
    data: { storageStatus: "FAILED", sourceFetchUrl: null, storageLeaseId: null, storageNextRetryAt: null, storageLastError: "LEASE_EXPIRED_MAX" },
  });

  // M2 (por proveedor: cada fetcher trae su TTL)
  let m2 = 0;
  for (const f of fetchers) {
    const cutoff = new Date(now.getTime() - f.sourceTtlMs);
    const r = await prisma.conversationAttachment.updateMany({
      where: {
        source: f.source,
        sourceFetchUrl: { not: null },
        sourceFetchCapturedAt: { lt: cutoff },
        storageStatus: { in: ["PENDING", "FAILED", "COPYING"] },
        OR: [{ storageStatus: { not: "COPYING" } }, { storageNextRetryAt: null }, { storageNextRetryAt: { lte: now } }],
      },
      data: { storageStatus: "NO_ORIGIN", sourceFetchUrl: null, storageLeaseId: null, storageNextRetryAt: null, storageLastError: "SOURCE_TTL_EXPIRED" },
    });
    m2 += r.count;
  }

  // M3
  const m3 = await prisma.webhookEvent.updateMany({
    where: {
      status: { in: ["RECEIVED", "ERROR"] },
      receivedAt: { lt: new Date(now.getTime() - WEBHOOK_TRANSIENT_TTL_HOURS * 3600_000) },
      transientSourceUrls: { not: Prisma.DbNull },
    },
    data: { transientSourceUrls: Prisma.DbNull },
  });

  return { leasesRecovered: m1.count, attachmentsTtlNoOrigin: m2, webhookUrlsCleared: m3.count };
}
