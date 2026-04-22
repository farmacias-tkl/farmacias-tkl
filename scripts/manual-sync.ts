import { config } from "dotenv";
config({ path: ".env.local" });
import { syncBalances } from "../src/lib/sync/sync-balances";

async function main() {
  console.log("Iniciando sync manual...");
  const result = await syncBalances();
  console.log("Status:",           result.status);
  console.log("Mensaje:",          result.message);
  console.log("Filas procesadas:", result.rowsProcessed);
  console.log("Filas ignoradas:",  result.rowsSkipped);
  console.log("Duración:",         result.durationMs + "ms");
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    result.warnings.forEach((w) => console.log(" -", w));
  }
  if (result.status === "ERROR") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
