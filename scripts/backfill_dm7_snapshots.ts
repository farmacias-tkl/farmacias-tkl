/**
 * DM-7B2 — Backfill de snapshots históricos (employee/branch/position) para filas
 * existentes de ActionPlan, OvertimeRecord y AbsenceRecord.
 *
 *   npx tsx scripts/backfill_dm7_snapshots.ts            # DRY-RUN (no escribe)
 *   npx tsx scripts/backfill_dm7_snapshots.ts --apply    # escribe
 *
 * Contra Neon: anteponer `npx dotenv-cli -e .env.neon --`.
 *
 * Garantías:
 *  - NULL-only POR COLUMNA: solo completa columnas en NULL; jamás pisa una ya seteada.
 *  - branchNameSnapshot sale del branch PINNEADO del record (record.branchId / record.branch),
 *    nunca de employee.currentBranchId.
 *  - Idempotente: una 2ª corrida da 0 cambios.
 *
 * Límite: para empleados que ya cambiaron de puesto/nombre desde la creación del
 * registro, se congela el valor ACTUAL (posiblemente ya incorrecto); no recupera el
 * original perdido. El branch sí es el histórico correcto (viene del record).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const anyNull = {
  OR: [
    { employeeNameSnapshot: null },
    { branchNameSnapshot: null },
    { positionNameSnapshot: null },
  ],
};

const include = {
  employee: { select: { firstName: true, lastName: true, position: { select: { name: true } } } },
  branch:   { select: { name: true } },
} as const;

function dbHost(): string {
  try { return new URL(process.env.DATABASE_URL ?? "").host; }
  catch { return "(DATABASE_URL inválida o ausente)"; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processTable(name: string, model: any) {
  const total = await model.count();
  const rows = await model.findMany({ where: anyNull, include });
  const pendientes = rows.length;
  let cambiarian = 0, modificados = 0;

  for (const row of rows) {
    const patch: Record<string, string> = {};
    if (row.employeeNameSnapshot === null) patch.employeeNameSnapshot = `${row.employee.firstName} ${row.employee.lastName}`;
    if (row.positionNameSnapshot === null) patch.positionNameSnapshot = row.employee.position.name;
    if (row.branchNameSnapshot   === null) patch.branchNameSnapshot   = row.branch.name;

    if (Object.keys(patch).length === 0) continue; // nada NULL derivable → no tocar
    cambiarian++;
    if (APPLY) { await model.update({ where: { id: row.id }, data: patch }); modificados++; }
  }

  console.log(
    `${name.padEnd(15)} total=${total} | completos=${total - pendientes} | pendientes=${pendientes} | ` +
    (APPLY ? `modificados=${modificados}` : `se modificarían=${cambiarian}`),
  );
}

async function main() {
  console.log(`HOST: ${dbHost()}`);
  console.log(`MODO: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}\n`);

  await processTable("ActionPlan",     prisma.actionPlan);
  await processTable("OvertimeRecord", prisma.overtimeRecord);
  await processTable("AbsenceRecord",  prisma.absenceRecord);

  console.log(
    `\nLímite: filas cuyo empleado ya cambió de puesto/nombre quedan congeladas en el ` +
    `valor ACTUAL (no se recupera el original). El branch es histórico correcto (record.branchId).`,
  );
}

main().catch(e => { console.error("ERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
