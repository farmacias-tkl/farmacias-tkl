/**
 * load-personal.ts — Carga de personal real: empleados, horarios, saldos de
 * vacaciones y licencias, desde tres CSV en una carpeta FUERA del repo.
 *
 *   empleados.csv · horarios.csv · saldos.csv  (formato en src/lib/personal/load-plan.ts)
 *
 * Por defecto es DRY-RUN: lee la base y los archivos, no escribe nada. Informa
 * por sucursal cuántos empleados se crearían / actualizarían / quedan igual,
 * los errores de cada fila, los totales de saldo por sucursal de contrato y
 * las personas con situación "Vacaciones" (no se crea solicitud).
 *
 * Con --apply: todo en una transacción, idempotente (la segunda corrida con los
 * mismos archivos no cambia nada), no borra nada. Si hay errores no escribe.
 * Requiere --host (host de DATABASE_URL) y --actor (email del usuario que
 * queda como autor en AuditLog, movimientos de saldo y licencias).
 *
 * Saldos: si una persona ya tiene movimientos CONSUME o REFUND, su saldo NO se
 * recarga (el dry-run lo informa como "frenado"), salvo con --force-saldos:
 * ahí se pisa el valor y queda un movimiento LOAD_ADJUST.
 *
 * Uso:
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-personal.ts --dir <carpeta>
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-personal.ts --dir <carpeta> --apply --host <host> --actor <email>
 *   (agregar --force-saldos, en dry-run y en apply, para recargar saldos con consumos)
 *
 * Código de salida: 0 ok · 1 hay errores en los archivos (no se escribió) · 2 uso incorrecto.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildLoadPlan, formatPlanReport, type FileName } from "../src/lib/personal/load-plan";

interface Args { dir: string; apply: boolean; forceBalances: boolean; host?: string; actor?: string }

function usage(msg: string): never {
  console.error(`ERROR: ${msg}`);
  console.error("Uso: npx tsx scripts/load-personal.ts --dir <carpeta> [--force-saldos] [--apply --host <host> --actor <email>]");
  process.exit(2);
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { dir: "", apply: false, forceBalances: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i] ?? usage(`falta el valor de ${k}`);
    if (k === "--dir") a.dir = val();
    else if (k === "--apply") a.apply = true;
    else if (k === "--force-saldos") a.forceBalances = true;
    else if (k === "--host") a.host = val();
    else if (k === "--actor") a.actor = val();
    else usage(`opción desconocida ${k}`);
  }
  if (!a.dir) usage("falta --dir");
  if (a.apply && !a.host) usage("--apply requiere --host <host de DATABASE_URL>");
  if (a.apply && !a.actor) usage("--apply requiere --actor <email de un usuario>");
  return a;
}

const FILES: FileName[] = ["empleados.csv", "horarios.csv", "saldos.csv"];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir);
  if (resolve(process.cwd()) === dir || dir.startsWith(resolve(process.cwd()) + "\\") || dir.startsWith(resolve(process.cwd()) + "/")) {
    usage("la carpeta de datos tiene que estar FUERA del repo (los datos reales no van al repo)");
  }
  const files = {} as Record<FileName, string>;
  for (const f of FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) usage(`no existe ${p}`);
    files[f] = readFileSync(p, "utf8");
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!url) usage("DATABASE_URL no está definida");
  const dbHost = new URL(url).hostname;
  console.log(`Base: ${dbHost} · modo: ${args.apply ? "APPLY" : "dry-run (no escribe)"}`);
  if (args.apply && args.host !== dbHost) usage(`--host ${args.host} no coincide con el host de DATABASE_URL (${dbHost})`);

  const { PrismaClient } = await import("@prisma/client");
  const { loadSnapshot, applyLoadPlan } = await import("../src/lib/personal/load-apply");
  const db = new PrismaClient();
  try {
    const plan = buildLoadPlan(files, await loadSnapshot(db), { forceBalances: args.forceBalances });
    console.log(formatPlanReport(plan));
    if (plan.errors.length > 0) {
      console.log("\nHay errores: no se escribe nada. Corregí los archivos y volvé a correr.");
      process.exitCode = 1;
      return;
    }
    if (!args.apply) {
      console.log("\nDry-run: no se escribió nada. Para escribir: --apply --host <host> --actor <email>.");
      return;
    }
    const actor = await db.user.findUnique({ where: { email: args.actor! }, select: { id: true, active: true } });
    if (!actor || !actor.active) usage(`--actor ${args.actor}: no hay un usuario activo con ese email`);
    const t0 = Date.now();
    const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    console.log("\nAplicando (una transacción, por lotes)...");
    const result = await applyLoadPlan(db, plan, { userId: actor.id }, {
      onProgress: (msg) => console.log(`  [${secs()}] ${msg}`),
    });
    console.log(`  [${secs()}] transacción confirmada.`);
    console.log("\nAplicado:", JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /load-personal\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
