/**
 * load-vacation-requests.ts — Carga en lote de solicitudes de vacaciones que
 * llegaron por mail. Quedan Solicitadas (PENDING_SUPERVISOR), como si las
 * hubiera creado un encargado; después se aprueban en la plataforma.
 *
 *   solicitudes.csv (en una carpeta FUERA del repo):
 *     apellido_nombre, contrato, desde, hasta, nota
 *   (formato y reglas en src/lib/vacations/bulk-requests.ts)
 *
 * Por defecto es DRY-RUN: lee la base y el archivo, no escribe nada. Informa
 * por sucursal donde trabaja la persona una fila por solicitud (empleado,
 * fechas, días, saldo actual y cómo quedaría, advertencias) y los totales: a
 * crear, ya existentes y con error. Usa la misma validación que la API.
 *
 * Con --apply: valida todo antes; si hay un solo error no escribe nada. Crea
 * las solicitudes, su historial y la auditoría en una transacción corta, por
 * lotes. No descuenta saldo (se descuenta al aprobar). Requiere --host (host
 * de DATABASE_URL) y --actor (email del usuario que queda como quien pidió;
 * tiene que poder crear solicitudes, como en la API).
 *
 * Uso:
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-vacation-requests.ts --dir <carpeta>
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-vacation-requests.ts --dir <carpeta> --apply --host <host> --actor <email>
 *
 * Código de salida: 0 ok · 1 hay errores (no se escribió) · 2 uso incorrecto.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Args { dir: string; apply: boolean; host?: string; actor?: string }

function usage(msg: string): never {
  console.error(`ERROR: ${msg}`);
  console.error("Uso: npx tsx scripts/load-vacation-requests.ts --dir <carpeta> [--apply --host <host> --actor <email>]");
  process.exit(2);
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { dir: "", apply: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i] ?? usage(`falta el valor de ${k}`);
    if (k === "--dir") a.dir = val();
    else if (k === "--apply") a.apply = true;
    else if (k === "--host") a.host = val();
    else if (k === "--actor") a.actor = val();
    else usage(`opción desconocida ${k}`);
  }
  if (!a.dir) usage("falta --dir");
  if (a.apply && !a.host) usage("--apply requiere --host <host de DATABASE_URL>");
  if (a.apply && !a.actor) usage("--apply requiere --actor <email de un usuario>");
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir);
  const repo = resolve(process.cwd());
  if (repo === dir || dir.startsWith(repo + "\\") || dir.startsWith(repo + "/")) {
    usage("la carpeta de datos tiene que estar FUERA del repo (los datos reales no van al repo)");
  }
  const { REQUESTS_FILE } = await import("../src/lib/vacations/bulk-requests");
  const file = join(dir, REQUESTS_FILE);
  if (!existsSync(file)) usage(`no existe ${file}`);
  const csv = readFileSync(file, "utf8");

  const url = process.env.DATABASE_URL ?? "";
  if (!url) usage("DATABASE_URL no está definida");
  const dbHost = new URL(url).hostname;
  console.log(`Base: ${dbHost} · modo: ${args.apply ? "APPLY" : "dry-run (no escribe)"}`);
  if (args.apply && args.host !== dbHost) usage(`--host ${args.host} no coincide con el host de DATABASE_URL (${dbHost})`);

  const { PrismaClient } = await import("@prisma/client");
  const { can } = await import("../src/lib/permissions");
  const { planVacationRequests, formatRequestsReport, planHasErrors, applyVacationRequests } =
    await import("../src/lib/vacations/bulk-requests");
  const db = new PrismaClient();
  try {
    // El actor se verifica antes de validar, para no esperar la validación en vano.
    let actorId: string | null = null;
    if (args.apply) {
      const actor = await db.user.findUnique({ where: { email: args.actor! }, select: { id: true, active: true, role: true } });
      if (!actor || !actor.active) usage(`--actor ${args.actor}: no hay un usuario activo con ese email`);
      if (!can.createVacation(actor.role)) usage(`--actor ${args.actor}: su rol (${actor.role}) no puede crear solicitudes de vacaciones`);
      actorId = actor.id;
    }

    const t0 = Date.now();
    const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    console.log("Validando (misma validación que la API)...");
    const plan = await planVacationRequests(db, csv);
    console.log(`  [${secs()}] validación terminada.`);
    console.log(formatRequestsReport(plan));
    if (planHasErrors(plan)) {
      console.log("\nHay errores: no se escribe nada. Corregí el archivo y volvé a correr.");
      process.exitCode = 1;
      return;
    }
    if (!args.apply) {
      console.log("\nDry-run: no se escribió nada. Para escribir: --apply --host <host> --actor <email>.");
      return;
    }
    console.log("\nAplicando (una transacción, por lotes)...");
    const result = await applyVacationRequests(db, plan, { userId: actorId! }, {
      onProgress: (msg) => console.log(`  [${secs()}] ${msg}`),
    });
    console.log(`  [${secs()}] transacción confirmada.`);
    console.log("\nAplicado:", JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /load-vacation-requests\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
