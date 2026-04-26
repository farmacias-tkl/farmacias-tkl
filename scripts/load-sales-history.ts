/**
 * load-sales-history.ts — Carga inicial del historial de ventas SIAF a Neon.
 *
 * Uso:
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-sales-history.ts
 *
 * Requisitos en .env.neon:
 *   DATABASE_URL                       (Neon production)
 *   GOOGLE_SERVICE_ACCOUNT_JSON         (JSON completo, en una sola línea, con comillas simples)
 *   GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID     (folder ID de Drive con los CSVs SIAF)
 *
 * El script reusa syncSales() y bypassa el límite de timeout serverless de Vercel.
 * Usa el patrón createMany + filter-by-lastSnapshot, así que la primera carga es pesada
 * pero las subsiguientes son incrementales y rápidas.
 *
 * Después de correrlo: BORRAR .env.neon — contiene secretos (SA JSON).
 */
import { config } from "dotenv";
config({ path: ".env.neon" });

const REQUIRED_VARS = [
  "DATABASE_URL",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID",
];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`ERROR: env var ${key} no está definida en .env.neon`);
    console.error("Asegurate de tener las 3 vars antes de correr el script.");
    process.exit(1);
  }
}

const dbHost = (process.env.DATABASE_URL || "").split("@")[1]?.split("/")[0] ?? "unknown";
console.log("=".repeat(60));
console.log("Carga inicial de historial de ventas SIAF");
console.log("=".repeat(60));
console.log("Target DB host: ", dbHost);
console.log("Folder ID:      ", process.env.GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID);
console.log();

// Importar dinámicamente DESPUÉS de cargar dotenv para que las env vars
// estén presentes cuando syncSales construya su Prisma client.
async function main() {
  const { syncSales } = await import("../src/lib/sync/sync-sales");

  console.log("Iniciando carga (sin timeout — puede tardar varios minutos)...");
  console.log();

  const start = Date.now();
  try {
    const result = await syncSales();
    const elapsedSec = Math.round((Date.now() - start) / 1000);

    console.log();
    console.log("=".repeat(60));
    console.log("Resultado:");
    console.log("  Status:           ", result.status);
    console.log("  Mensaje:          ", result.message);
    console.log("  Rows insertadas:  ", result.rowsProcessed);
    console.log("  Rows skip:        ", result.rowsSkipped);
    console.log("  Duración:         ", elapsedSec, "segundos");
    if (result.warnings.length > 0) {
      console.log();
      console.log(`Warnings (${result.warnings.length}):`);
      result.warnings.slice(0, 30).forEach((w) => console.log("  -", w));
      if (result.warnings.length > 30) {
        console.log(`  ... y ${result.warnings.length - 30} más`);
      }
    }
    console.log("=".repeat(60));
    console.log();
    console.log("⚠️  RECORDATORIO: borrá el archivo .env.neon ahora");
    console.log("   contiene el Service Account JSON (secreto)");
  } catch (e) {
    console.error("ERROR fatal:", e);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
