/**
 * load-coseguros-history.ts — Carga local del histórico de coseguros a CoseguroDaily.
 *
 * Lee los {Sucursal}_coseguros.csv de una carpeta (la salida del modo --prueba de
 * siaf_to_drive.py, copiada a esta PC) y hace el mismo upsert que la carga
 * diaria (clave sucursal + fecha + código). No corre en el servidor del pipeline.
 *
 * Por defecto es DRY-RUN: no escribe nada. Muestra por sucursal filas, período,
 * totales (comprobantes, NCR, importe) y cuántas filas se insertarían, cuántas
 * ya existen y cuántas de esas cambian de valor.
 *
 * Uso:
 *   # Solo archivos, sin base (totales de control):
 *   npx tsx scripts/load-coseguros-history.ts --dir <carpeta> --sin-db [--control 2026-01-01:2026-10-12]
 *
 *   # Dry-run contra la base (solo lecturas):
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-coseguros-history.ts --dir <carpeta>
 *
 *   # Escribir (requiere confirmar el host de DATABASE_URL):
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/load-coseguros-history.ts --dir <carpeta> --apply --host <host>
 *
 * Código de salida: 0 ok · 1 hubo archivos con problemas (no se escribieron) · 2 uso incorrecto.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COSEGUROS_FILENAME_RE } from "../src/lib/integrations/google-drive";
import { parseCosegurosCSV } from "../src/lib/integrations/csv-coseguros-parser";
import {
  formatCents, processCoseguroFile, totalsOf,
  type CoseguroFileOutcome, type CoseguroRow, type CoseguroStore,
} from "../src/lib/sync/coseguros-upsert";
import type { BranchMapping } from "../src/lib/integrations/excel-parser";

interface Args { dir: string; apply: boolean; host?: string; sinDb: boolean; control?: { desde: string; hasta: string } }

function usage(msg: string): never {
  console.error(`ERROR: ${msg}`);
  console.error("Uso: npx tsx scripts/load-coseguros-history.ts --dir <carpeta> [--sin-db] [--control DESDE:HASTA] [--apply --host <host>]");
  process.exit(2);
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { dir: "", apply: false, sinDb: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i] ?? usage(`falta el valor de ${k}`);
    if (k === "--dir") a.dir = val();
    else if (k === "--apply") a.apply = true;
    else if (k === "--host") a.host = val();
    else if (k === "--sin-db") a.sinDb = true;
    else if (k === "--control") {
      const m = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(val());
      if (!m) usage("--control tiene que ser AAAA-MM-DD:AAAA-MM-DD");
      a.control = { desde: m[1], hasta: m[2] };
    } else usage(`opción desconocida ${k}`);
  }
  if (!a.dir) usage("falta --dir");
  if (a.apply && a.sinDb) usage("--apply y --sin-db no van juntos");
  if (a.apply && !a.host) usage("--apply requiere --host <host de DATABASE_URL>");
  return a;
}

const fmtTotals = (rows: CoseguroRow[]) => {
  const t = totalsOf(rows);
  return `comprobantes=${t.receipts} · NCR=${t.creditNotes} · importe=${formatCents(t.amountCents)}`;
};

const period = (rows: CoseguroRow[]) =>
  rows.length === 0 ? "sin filas" : `${rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date)} → ${rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date)}`;

function listFiles(dir: string) {
  return readdirSync(dir)
    .map((name) => ({ name, m: name.match(COSEGUROS_FILENAME_RE) }))
    .filter((x): x is { name: string; m: RegExpMatchArray } => x.m !== null)
    .map(({ name, m }) => ({ name, sucursalName: m[1], path: join(dir, name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir);
  const files = listFiles(dir);
  console.log("=".repeat(70));
  console.log(`Histórico de coseguros · ${args.apply ? "APPLY (escribe)" : args.sinDb ? "DRY-RUN sin base" : "DRY-RUN (solo lectura)"}`);
  console.log(`Carpeta: ${dir} · ${files.length} archivo(s) _coseguros.csv`);
  if (files.length === 0) { console.error("No hay archivos {Sucursal}_coseguros.csv en la carpeta."); process.exit(1); }

  let problems = 0;

  if (args.sinDb) {
    for (const f of files) {
      try {
        const rows = parseCosegurosCSV(readFileSync(f.path, "utf8")).map((p) => ({
          date: p.fecha, code: p.codigo, name: p.nombre, receipts: p.comprobantes, creditNotes: p.notasCredito, amount: p.importe,
        }));
        console.log(`\n[${f.sucursalName}] ${f.name}: ${rows.length} filas · ${period(rows)} · ${fmtTotals(rows)}`);
        if (args.control) {
          const c = rows.filter((r) => r.date >= args.control!.desde && r.date <= args.control!.hasta);
          console.log(`  control ${args.control.desde} → ${args.control.hasta}: ${fmtTotals(c)}`);
        }
      } catch (e) {
        problems++;
        console.log(`\n[${f.sucursalName}] ${f.name}: INVÁLIDO — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    process.exit(problems > 0 ? 1 : 0);
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!url) usage("DATABASE_URL no está definida (o usá --sin-db)");
  const dbHost = url.split("@")[1]?.split("/")[0]?.split("?")[0] ?? "desconocido";
  console.log(`Base: ${dbHost}`);
  if (args.apply && args.host !== dbHost) usage(`--host ${args.host} no coincide con el host de DATABASE_URL (${dbHost})`);

  const { PrismaClient } = await import("@prisma/client");
  const { prismaCoseguroStore } = await import("../src/lib/sync/coseguros-upsert");
  const db = new PrismaClient();
  try {
    const branches: BranchMapping[] = await db.branch.findMany({
      where: { active: true }, select: { id: true, name: true, aliases: true },
    });
    const store: CoseguroStore = prismaCoseguroStore(db);

    // Primero todo en dry-run: si hay un archivo con problemas, no se escribe nada.
    const outcomes: { f: (typeof files)[number]; out: CoseguroFileOutcome }[] = [];
    const seen = new Map<string, string>();
    for (const f of files) {
      const out = await processCoseguroFile(
        { sucursalName: f.sucursalName, csvContent: readFileSync(f.path, "utf8"), sourceFile: `historico:${f.name}` },
        branches, store, { write: false },
      );
      if (out.kind === "ok") {
        const prev = seen.get(out.branchId);
        if (prev) { problems++; console.log(`\n[${f.sucursalName}] misma sucursal que "${prev}" — revisar nombres`); continue; }
        seen.set(out.branchId, f.sucursalName);
      }
      outcomes.push({ f, out });
    }

    let ins = 0, exist = 0, changed = 0, orphans = 0;
    for (const { f, out } of outcomes) {
      if (out.kind === "branch_not_found") { problems++; console.log(`\n[${f.sucursalName}] ${f.name}: sucursal no encontrada en DB`); continue; }
      if (out.kind === "parse_error") { problems++; console.log(`\n[${f.sucursalName}] ${f.name}: INVÁLIDO — ${out.error}`); continue; }
      const p = out.plan;
      ins += p.toCreate.length; exist += p.toUpdate.length + p.unchanged; changed += p.toUpdate.length; orphans += p.orphans.length;
      console.log(`\n[${f.sucursalName}] ${f.name}: ${out.rows.length} filas · ${period(out.rows)} · ${fmtTotals(out.rows)}`);
      if (args.control) {
        const c = out.rows.filter((r) => r.date >= args.control!.desde && r.date <= args.control!.hasta);
        console.log(`  control ${args.control.desde} → ${args.control.hasta}: ${fmtTotals(c)}`);
      }
      console.log(`  se insertarían ${p.toCreate.length} · ya existen ${p.toUpdate.length + p.unchanged} (cambian de valor ${p.toUpdate.length}, iguales ${p.unchanged}) · en Neon sin par en el archivo ${p.orphans.length}`);
      for (const { row, before } of p.toUpdate.slice(0, 10)) {
        console.log(`    cambia ${row.date} ${row.code}: comprobantes ${before.receipts}→${row.receipts}, NCR ${before.creditNotes}→${row.creditNotes}, importe ${before.amount}→${row.amount}${before.name !== row.name ? `, nombre "${before.name}"→"${row.name}"` : ""}`);
      }
      if (p.toUpdate.length > 10) console.log(`    … y ${p.toUpdate.length - 10} más`);
    }
    console.log("\n" + "=".repeat(70));
    console.log(`Total: se insertarían ${ins} · ya existen ${exist} (cambian de valor ${changed}) · sin par en el archivo ${orphans} · archivos con problemas ${problems}`);

    if (!args.apply) { console.log("DRY-RUN: no se escribió nada."); process.exit(problems > 0 ? 1 : 0); }
    if (problems > 0) { console.log("APPLY cancelado: hay archivos con problemas. No se escribió nada."); process.exit(1); }

    let created = 0, updated = 0;
    for (const { f, out } of outcomes) {
      if (out.kind !== "ok") continue;
      // Una transacción por archivo (todo o nada); el plan se recalcula adentro.
      const w = await store.upsertFile(out.branchId, out.rows, `historico:${f.name}`, { timeoutMs: 120_000 });
      created += w.created; updated += w.updated;
      console.log(`[${f.sucursalName}] escritas: ${w.created} nuevas, ${w.updated} actualizadas`);
    }
    console.log(`APPLY terminado: ${created} nuevas, ${updated} actualizadas.`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
