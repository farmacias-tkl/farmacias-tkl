/**
 * Carga de {Sucursal}_coseguros.csv a CoseguroDaily, compartida por la carga
 * diaria (sync-coseguros.ts) y el histórico (scripts/load-coseguros-history.ts).
 *
 * Clave: branchId + date + code. Por archivo se leen las filas existentes de
 * esa sucursal en las fechas del archivo y se arma un plan:
 *   - toCreate:  claves nuevas → createMany(skipDuplicates)
 *   - toUpdate:  claves existentes con otro valor → update por clave
 *   - unchanged: claves existentes iguales → no se escriben
 *   - orphans:   filas de Neon en esas fechas sin par en el archivo → solo se informan, no se borran
 * Una recarga del mismo archivo no duplica ni reescribe nada.
 *
 * No toca SalesSnapshot ni ninguna otra tabla.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseCosegurosCSV } from "@/lib/integrations/csv-coseguros-parser";
import { resolveBranchId, type BranchMapping } from "@/lib/integrations/excel-parser";

export interface CoseguroRow {
  date:        string;  // YYYY-MM-DD
  code:        string;
  name:        string;
  receipts:    number;
  creditNotes: number;
  amount:      string;  // 2 decimales, "-1234.50"
}

export interface CoseguroPlan {
  toCreate:  CoseguroRow[];
  toUpdate:  { row: CoseguroRow; before: CoseguroRow }[];
  unchanged: number;
  orphans:   CoseguroRow[];
}

export interface CoseguroWriteResult { plan: CoseguroPlan; created: number; updated: number }

export interface CoseguroStore {
  /** Solo lectura (dry-run del histórico). */
  findExisting(branchId: string, dates: string[]): Promise<CoseguroRow[]>;
  /**
   * Un archivo de sucursal en UNA transacción, todo o nada: lee lo existente,
   * arma el plan y escribe. `timeoutMs` es el tiempo TOTAL: esperar para empezar
   * la transacción + ejecutarla (ver transactionLimits). Si se pasa (o falla
   * cualquier sentencia) la transacción se revierte y no queda nada escrito.
   */
  upsertFile(branchId: string, rows: CoseguroRow[], sourceFile: string, opts: { timeoutMs: number }): Promise<CoseguroWriteResult>;
}

const keyOf = (r: { date: string; code: string }) => `${r.date}|${r.code}`;

function sameValues(a: CoseguroRow, b: CoseguroRow): boolean {
  return a.name === b.name && a.receipts === b.receipts &&
    a.creditNotes === b.creditNotes && a.amount === b.amount;
}

export function planCoseguroChanges(rows: CoseguroRow[], existing: CoseguroRow[]): CoseguroPlan {
  const byKey = new Map(existing.map((e) => [keyOf(e), e]));
  const plan: CoseguroPlan = { toCreate: [], toUpdate: [], unchanged: 0, orphans: [] };
  const inFile = new Set<string>();
  for (const row of rows) {
    inFile.add(keyOf(row));
    const before = byKey.get(keyOf(row));
    if (!before) plan.toCreate.push(row);
    else if (sameValues(row, before)) plan.unchanged++;
    else plan.toUpdate.push({ row, before });
  }
  plan.orphans = existing.filter((e) => !inFile.has(keyOf(e)));
  return plan;
}

const toUtcDate = (iso: string) => new Date(iso + "T00:00:00.000Z");

const datesOf = (rows: CoseguroRow[]) => Array.from(new Set(rows.map((r) => r.date))).sort();

async function readExisting(client: Prisma.TransactionClient, branchId: string, dates: string[]): Promise<CoseguroRow[]> {
  if (dates.length === 0) return [];
  const found = await client.coseguroDaily.findMany({
    where:  { branchId, date: { in: dates.map(toUtcDate) } },
    select: { date: true, code: true, name: true, receipts: true, creditNotes: true, amount: true },
  });
  return found.map((f) => ({
    date:        f.date.toISOString().slice(0, 10),
    code:        f.code,
    name:        f.name,
    receipts:    f.receipts,
    creditNotes: f.creditNotes,
    amount:      f.amount.toFixed(2),
  }));
}

export const TX_MAX_WAIT_MS = 2_000;

/**
 * Reparte el tiempo que queda entre los dos límites de Prisma, que corren por
 * separado: `maxWait` (esperar conexión para empezar) y `timeout` (ejecutar, desde
 * que empezó). Suman `budgetMs`, así que esperar + ejecutar nunca pasa de ahí.
 * La espera se lleva hasta 1/4 del tiempo (tope 2 s).
 */
export function transactionLimits(budgetMs: number): { maxWait: number; timeout: number } {
  const budget  = Math.max(Math.floor(budgetMs), 2);
  const maxWait = Math.min(TX_MAX_WAIT_MS, Math.max(1, Math.floor(budget / 4)));
  return { maxWait, timeout: budget - maxWait };
}

/**
 * El `timeout` de Prisma no corta una sentencia que ya está corriendo: marca la
 * transacción como vencida y la revierte recién cuando la sentencia vuelve. Por
 * eso, antes de cada sentencia se fija `statement_timeout` (SET LOCAL: solo esta
 * transacción) al tiempo que le queda, y Postgres cancela la que se pase. Además,
 * la promesa rechaza al cumplirse `budgetMs` pase lo que pase; para entonces la
 * transacción ya venció en Prisma, así que no puede confirmarse después.
 */
export function prismaCoseguroStore(db: PrismaClient): CoseguroStore {
  return {
    findExisting: (branchId, dates) => readExisting(db, branchId, dates),
    upsertFile(branchId, rows, sourceFile, { timeoutMs }) {
      const limits = transactionLimits(timeoutMs);
      const work = db.$transaction(async (tx) => {
        const txUntil = Date.now() + limits.timeout;
        const bounded = async () => {
          const left = Math.max(1, Math.floor(txUntil - Date.now()));
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${left}`);
        };
        await bounded();
        const plan = planCoseguroChanges(rows, await readExisting(tx, branchId, datesOf(rows)));
        let created = 0;
        if (plan.toCreate.length > 0) {
          await bounded();
          created = (await tx.coseguroDaily.createMany({
            data: plan.toCreate.map((r) => ({
              branchId, date: toUtcDate(r.date), code: r.code, name: r.name,
              receipts: r.receipts, creditNotes: r.creditNotes, amount: r.amount, sourceFile,
            })),
            skipDuplicates: true,
          })).count;
        }
        for (const { row } of plan.toUpdate) {
          await bounded();
          await tx.coseguroDaily.update({
            where: { branchId_date_code: { branchId, date: toUtcDate(row.date), code: row.code } },
            data:  { name: row.name, receipts: row.receipts, creditNotes: row.creditNotes, amount: row.amount, sourceFile },
          });
        }
        return { plan, created, updated: plan.toUpdate.length };
      }, limits);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cutoff = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`Transacción de coseguros: tiempo agotado (${timeoutMs} ms, se revierte)`)), Math.max(timeoutMs, 1));
      });
      work.catch(() => {});   // si gana el corte, el rechazo posterior de la transacción no queda suelto
      return Promise.race([work, cutoff]).finally(() => clearTimeout(timer));
    },
  };
}

// ============================================================================
// Un archivo → una sucursal
// ============================================================================

export interface CoseguroFileInput {
  sucursalName: string;   // del nombre del archivo: "La Perla" en "La Perla_coseguros.csv"
  csvContent:   string;
  sourceFile:   string;   // se guarda en cada fila escrita
}

// Centavos como number entero: exacto hasta 2^53 (≈ 90 billones de pesos).
export interface CoseguroTotals { receipts: number; creditNotes: number; amountCents: number }

export type CoseguroFileOutcome =
  | { kind: "branch_not_found"; sucursalName: string }
  | { kind: "parse_error"; sucursalName: string; error: string }
  | {
      kind: "ok"; sucursalName: string; branchId: string;
      rows: CoseguroRow[]; plan: CoseguroPlan;
      written: { created: number; updated: number } | null;  // null = no se escribió (dry-run)
    };

/** Parsea el CSV a filas de CoseguroDaily. Tira con el detalle si el archivo es inválido. */
export function parseCoseguroRows(csvContent: string): CoseguroRow[] {
  return parseCosegurosCSV(csvContent).map((p) => ({
    date: p.fecha, code: p.codigo, name: p.nombre,
    receipts: p.comprobantes, creditNotes: p.notasCredito, amount: p.importe,
  }));
}

/** "-1234.50" → -123450 (amount ya normalizado a 2 decimales por el parser). */
export function toCents(amount: string): number {
  const neg = amount.startsWith("-");
  const [ent, dec] = amount.replace("-", "").split(".");
  const cents = Number(ent) * 100 + Number(dec);
  return neg ? -cents : cents;
}

export function formatCents(c: number): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function totalsOf(rows: CoseguroRow[]): CoseguroTotals {
  return rows.reduce<CoseguroTotals>(
    (t, r) => ({ receipts: t.receipts + r.receipts, creditNotes: t.creditNotes + r.creditNotes, amountCents: t.amountCents + toCents(r.amount) }),
    { receipts: 0, creditNotes: 0, amountCents: 0 },
  );
}

/** Mapea la sucursal igual que syncSales: resolveBranchId(nombre.toUpperCase(), sucursales activas). */
export function resolveCoseguroBranch(sucursalName: string, branches: BranchMapping[]): string | null {
  return resolveBranchId(sucursalName.toUpperCase(), branches);
}

/** Usado por el histórico: write=false arma el plan sin escribir; write=true escribe con upsertFile (todo o nada). */
export async function processCoseguroFile(
  input: CoseguroFileInput,
  branches: BranchMapping[],
  store: CoseguroStore,
  opts: { write: boolean; timeoutMs?: number },
): Promise<CoseguroFileOutcome> {
  const branchId = resolveCoseguroBranch(input.sucursalName, branches);
  if (!branchId) return { kind: "branch_not_found", sucursalName: input.sucursalName };

  let rows: CoseguroRow[];
  try {
    rows = parseCoseguroRows(input.csvContent);
  } catch (e) {
    return { kind: "parse_error", sucursalName: input.sucursalName, error: e instanceof Error ? e.message : String(e) };
  }

  if (opts.write) {
    const w = await store.upsertFile(branchId, rows, input.sourceFile, { timeoutMs: opts.timeoutMs ?? 120_000 });
    return { kind: "ok", sucursalName: input.sucursalName, branchId, rows, plan: w.plan, written: { created: w.created, updated: w.updated } };
  }
  const plan = planCoseguroChanges(rows, await store.findExisting(branchId, datesOf(rows)));
  return { kind: "ok", sucursalName: input.sucursalName, branchId, rows, plan, written: null };
}
