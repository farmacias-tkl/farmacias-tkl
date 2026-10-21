/**
 * Carga diaria de {Sucursal}_coseguros.csv (carpeta diario/ de Drive) a CoseguroDaily.
 *
 * - Se dispara con SU PROPIA llamada: POST /api/sync/trigger {"source":"coseguros"}
 *   (workflow .github/workflows/coseguros-sync.yml). "sales" y "all" no la corren.
 * - Apagada salvo COSEGUROS_SYNC_ENABLED === "true".
 * - Termina de verdad dentro de COSEGUROS_DEADLINE_MS (default 8 s, por debajo del
 *   límite más bajo de Vercel): cada llamada a Drive lleva timeout y se cancela con
 *   AbortSignal al vencer; cada archivo se escribe en UNA transacción con timeout =
 *   tiempo restante (si vence, Prisma la revierte: nada a medias); no se empiezan
 *   archivos sin tiempo. Se reserva 1 s para dejar el SyncLog (SALES_COSEGUROS).
 *   La autenticación con Google entra en ese mismo límite (google-drive.ts), y
 *   esperar para empezar la transacción + ejecutarla también (transactionLimits).
 * - Si el SyncLog no se puede escribir, el resultado es ERROR (la ruta lo devuelve
 *   como error y el run de Actions queda en rojo), con `loadStatus` de la carga.
 * - Completa solo si las 11 sucursales esperadas (EXPECTED_SIAF_BRANCHES, las de
 *   FOLDER_MAP en siaf_to_drive.py) se reconocen y se cargaron. Si no: PARTIAL (o
 *   ERROR si no se cargó ninguna) y el mensaje dice cuáles faltaron y por qué.
 * - Archivo inválido: la sucursal no se carga (ni sus filas válidas). Nada se borra.
 */
import { prisma } from "@/lib/prisma";
import {
  listCosegurosFiles, downloadDriveFileText, type CoseguroFileRef, type DriveCallLimits,
} from "@/lib/integrations/google-drive";
import type { BranchMapping } from "@/lib/integrations/excel-parser";
import type { Prisma, SyncStatus } from "@prisma/client";
import {
  parseCoseguroRows, prismaCoseguroStore, resolveCoseguroBranch, type CoseguroRow, type CoseguroStore,
} from "./coseguros-upsert";

/** Las 11 que procesa hoy la carga de ventas (FOLDER_MAP de scripts/server/siaf_to_drive.py). */
export const EXPECTED_SIAF_BRANCHES = [
  "America", "Facultad", "Etcheverry", "Galesa", "Larcade", "La Perla",
  "Naveira", "Quintana", "San Agustin", "San Miguel", "Tekiel",
] as const;

export const DEFAULT_DEADLINE_MS = 8_000;  // total de la corrida, SyncLog incluido
export const LOG_RESERVE_MS      = 1_000;  // del total, reservado para escribir el SyncLog
export const DRIVE_CALL_MAX_MS   = 5_000;  // tope por llamada a Drive
export const DB_READ_MAX_MS      = 3_000;  // tope para leer las sucursales
export const MIN_FILE_MS         = 300;    // con menos tiempo no se empieza un archivo

export type MissingReason =
  | "no reconocida en DB" | "sin archivo" | "archivo duplicado"
  | "archivo inválido" | "tiempo agotado" | "error";

export interface SyncCosegurosResult {
  status:        SyncStatus;   // ERROR si no quedó el SyncLog, aunque la carga haya andado
  loadStatus:    SyncStatus;   // cómo terminó la carga en sí
  logWritten:    boolean;
  complete:      boolean;
  message:       string;
  rowsProcessed: number;   // creadas + actualizadas
  loaded:        string[];
  missing:       { sucursal: string; reason: MissingReason }[];
  warnings:      string[];
  durationMs:    number;
  syncDate:      Date;
}

export interface SyncCosegurosDeps {
  env:          Record<string, string | undefined>;
  listFiles:    (folderId: string, limits: DriveCallLimits) => Promise<CoseguroFileRef[]>;
  downloadText: (fileId: string, limits: DriveCallLimits) => Promise<string>;
  getBranches:  () => Promise<BranchMapping[]>;
  store:        CoseguroStore;
  writeLog:     (data: Prisma.SyncLogCreateInput) => Promise<unknown>;
}

function defaultDeps(): SyncCosegurosDeps {
  return {
    env:          process.env,
    listFiles:    listCosegurosFiles,
    downloadText: downloadDriveFileText,
    getBranches:  () => prisma.branch.findMany({ where: { active: true }, select: { id: true, name: true, aliases: true } }),
    store:        prismaCoseguroStore(prisma),
    writeLog:     (data) => prisma.syncLog.create({ data }),
  };
}

export function deadlineFromEnv(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2_000 && n <= 600_000 ? n : DEFAULT_DEADLINE_MS;
}

class TimeoutError extends Error {}

/** Solo para LECTURAS o el propio SyncLog: si vence, se deja de esperar. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TimeoutError(`${what}: sin respuesta en ${ms} ms`)), Math.max(ms, 0)); }),
  ]).finally(() => clearTimeout(t));
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Devuelve null si está apagada (no hace nada, ni SyncLog). Nunca tira. */
export async function syncCoseguros(deps: SyncCosegurosDeps = defaultDeps()): Promise<SyncCosegurosResult | null> {
  if (deps.env.COSEGUROS_SYNC_ENABLED !== "true") return null;

  const start      = Date.now();
  const budget     = deadlineFromEnv(deps.env.COSEGUROS_DEADLINE_MS);
  const workUntil  = start + budget - LOG_RESERVE_MS;
  const remaining  = () => workUntil - Date.now();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), Math.max(remaining(), 0));
  const driveLimits = (): DriveCallLimits => ({ signal: controller.signal, timeoutMs: Math.max(1, Math.min(DRIVE_CALL_MAX_MS, remaining())) });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const warnings: string[] = [];
  const loaded: string[] = [];
  const missing: SyncCosegurosResult["missing"] = [];
  let created = 0, updated = 0, unchanged = 0;
  let fatal: string | null = null;
  const timedOut = () => controller.signal.aborted || remaining() < MIN_FILE_MS;

  try {
    const folderId = deps.env.GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID;
    if (!folderId) throw new Error("GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID not set");

    const branches = await within(deps.getBranches(), Math.min(DB_READ_MAX_MS, remaining()), "lectura de sucursales");
    const files    = await deps.listFiles(folderId, driveLimits());

    // Sucursal esperada → branchId (o null si no se reconoce en DB)
    const expected = EXPECTED_SIAF_BRANCHES.map((name) => ({ name, branchId: resolveCoseguroBranch(name, branches) }));
    const filesByBranch = new Map<string, CoseguroFileRef[]>();
    for (const f of files) {
      const id = resolveCoseguroBranch(f.sucursalName, branches);
      if (!id || !expected.some((e) => e.branchId === id)) {
        warnings.push(`Archivo ${f.driveFileName}: no corresponde a ninguna de las 11 sucursales esperadas — no se carga`);
        continue;
      }
      filesByBranch.set(id, [...(filesByBranch.get(id) ?? []), f]);
    }

    for (const e of expected) {
      if (!e.branchId) { missing.push({ sucursal: e.name, reason: "no reconocida en DB" }); continue; }
      const fs = filesByBranch.get(e.branchId) ?? [];
      if (fs.length === 0) { missing.push({ sucursal: e.name, reason: "sin archivo" }); continue; }
      if (fs.length > 1) {
        missing.push({ sucursal: e.name, reason: "archivo duplicado" });
        warnings.push(`[${e.name}] ${fs.length} archivos: ${fs.map((f) => f.driveFileName).join(", ")} — no se carga ninguno`);
        continue;
      }
      if (timedOut()) { missing.push({ sucursal: e.name, reason: "tiempo agotado" }); continue; }

      const f = fs[0];
      let text: string;
      try {
        text = await deps.downloadText(f.driveFileId, driveLimits());
      } catch (err) {
        missing.push({ sucursal: e.name, reason: timedOut() ? "tiempo agotado" : "error" });
        warnings.push(`[${e.name}] descarga de ${f.driveFileName} falló: ${errMsg(err)}`);
        continue;
      }
      let rows: CoseguroRow[];
      try {
        rows = parseCoseguroRows(text);
      } catch (err) {
        missing.push({ sucursal: e.name, reason: "archivo inválido" });
        warnings.push(`[${e.name}] ${f.driveFileName} inválido: ${errMsg(err)} — sucursal sin cargar`);
        continue;
      }
      if (timedOut()) { missing.push({ sucursal: e.name, reason: "tiempo agotado" }); continue; }

      try {
        const w = await deps.store.upsertFile(e.branchId, rows, `drive:${f.driveFileName}@${f.modifiedTime}`, { timeoutMs: remaining() });
        created += w.created; updated += w.updated; unchanged += w.plan.unchanged;
        loaded.push(e.name);
        if (w.plan.orphans.length > 0) {
          warnings.push(`[${e.name}] ${w.plan.orphans.length} fila(s) en Neon sin par en el archivo para esas fechas — no se borran`);
        }
      } catch (err) {
        // La transacción se revirtió: nada escrito de esta sucursal.
        missing.push({ sucursal: e.name, reason: timedOut() ? "tiempo agotado" : "error" });
        warnings.push(`[${e.name}] escritura revertida: ${errMsg(err)}`);
      }
    }
  } catch (err) {
    fatal = timedOut() || err instanceof TimeoutError ? `tiempo agotado (${errMsg(err)})` : errMsg(err);
  } finally {
    clearTimeout(abortTimer);
  }

  if (missing.some((m) => m.reason === "tiempo agotado")) {
    warnings.unshift(`Tiempo agotado: límite de la corrida ${budget} ms (COSEGUROS_DEADLINE_MS)`);
  }

  const total = EXPECTED_SIAF_BRANCHES.length;
  const complete = fatal === null && missing.length === 0 && loaded.length === total;
  const status: SyncStatus = complete ? "SUCCESS" : loaded.length > 0 ? "PARTIAL" : "ERROR";
  const counts = `${created} filas nuevas, ${updated} actualizadas, ${unchanged} sin cambios.`;
  const message = complete
    ? `Completa: ${total} de ${total} sucursales. ${counts}`
    : fatal !== null
      ? `Incompleta: ${loaded.length} de ${total} sucursales. Falló la carga: ${fatal}`
      : `Incompleta: ${loaded.length} de ${total} sucursales. Faltan: ${missing.map((m) => `${m.sucursal} (${m.reason})`).join(", ")}. ${counts}`;

  const result: SyncCosegurosResult = {
    status, loadStatus: status, logWritten: true, complete, message, rowsProcessed: created + updated,
    loaded, missing, warnings, durationMs: Date.now() - start, syncDate: today,
  };
  try {
    await within(deps.writeLog({
      source:        "SALES_COSEGUROS",
      status:        result.status,
      message:       result.message,
      rowsProcessed: result.rowsProcessed,
      warnings:      result.warnings.length > 0 ? result.warnings : undefined,
      durationMs:    result.durationMs,
      syncDate:      today,
      triggeredBy:   "WEBHOOK",
    }), LOG_RESERVE_MS, "SyncLog");
  } catch (e) {
    // Sin registro la corrida no puede informarse como éxito: ERROR, para que la
    // ruta lo devuelva como error y el run de Actions quede en rojo. `loadStatus`
    // conserva cómo había terminado la carga en sí.
    console.error("Error escribiendo sync_log (coseguros):", e);
    result.logWritten = false;
    result.status     = "ERROR";
    result.message    = `No quedó registrada en SyncLog (${errMsg(e)}). Resultado de la carga: ${result.message}`;
  }
  return result;
}
