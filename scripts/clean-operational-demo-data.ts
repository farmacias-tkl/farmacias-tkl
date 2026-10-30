/**
 * clean-operational-demo-data.ts — Lista y (con --apply) borra los datos
 * ficticios de la parte operativa: empleados sin nameKey y puestos fuera del
 * catálogo, con todo lo que cuelga de ellos. Detalle y lista de tablas que NO
 * toca en src/lib/personal/cleanup.ts.
 *
 * Por defecto es DRY-RUN: solo cuenta. Frena (no borra nada) si algún usuario
 * apunta a un empleado ficticio, si hay PositionPermission en un puesto
 * ficticio o si personal real usa un puesto ficticio.
 *
 * Uso:
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/clean-operational-demo-data.ts
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/clean-operational-demo-data.ts --apply --host <host>
 *
 * Código de salida: 0 ok · 1 frenado · 2 uso incorrecto.
 */

function usage(msg: string): never {
  console.error(`ERROR: ${msg}`);
  console.error("Uso: npx tsx scripts/clean-operational-demo-data.ts [--apply --host <host>]");
  process.exit(2);
}

export function parseArgs(argv: string[]): { apply: boolean; host?: string } {
  const a: { apply: boolean; host?: string } = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--apply") a.apply = true;
    else if (k === "--host") a.host = argv[++i] ?? usage("falta el valor de --host");
    else usage(`opción desconocida ${k}`);
  }
  if (a.apply && !a.host) usage("--apply requiere --host <host de DATABASE_URL>");
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? "";
  if (!url) usage("DATABASE_URL no está definida");
  const dbHost = new URL(url).hostname;
  console.log(`Base: ${dbHost} · modo: ${args.apply ? "APPLY" : "dry-run (no borra)"}`);
  if (args.apply && args.host !== dbHost) usage(`--host ${args.host} no coincide con el host de DATABASE_URL (${dbHost})`);

  const { PrismaClient } = await import("@prisma/client");
  const { planCleanup, applyCleanup, formatCleanupReport } = await import("../src/lib/personal/cleanup");
  const db = new PrismaClient();
  try {
    const plan = await planCleanup(db);
    console.log(formatCleanupReport(plan));
    if (plan.blockers.length > 0) {
      console.log("\nFrenado: no se borra nada.");
      process.exitCode = 1;
      return;
    }
    if (!args.apply) {
      console.log("\nDry-run: no se borró nada. Para borrar: --apply --host <host>.");
      return;
    }
    const deleted = await applyCleanup(db, plan);
    console.log("\nBorrado:", JSON.stringify(deleted));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /clean-operational-demo-data\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
