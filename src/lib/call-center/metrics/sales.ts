/**
 * Ventas SIAF de los vendedores del Call Center (nivel A): importe bruto, comprobantes y
 * descuentos por sucursal, día y vendedor.
 *
 * Qué vendedor es del Call Center se resuelve DÍA POR DÍA con la versión de la configuración
 * que regía ese día (configForDay), igual que el horario y la meta. Un vendedor que entra a
 * la lista desde una fecha suma solo desde esa fecha, y uno que sale deja de sumar desde la
 * suya, aunque el período consultado cruce el cambio. Nunca se aplica una sola versión a
 * todo el rango.
 *
 * Un día sin configuración vigente no suma y NO se muestra como cero: se informa aparte.
 *
 * Límites de la fuente (ver indicators.ts): el importe es bruto y ya descuenta las notas de
 * crédito; "comprobantes" incluye las notas de crédito; los descuentos se informan aparte y
 * no se restan para mostrar un cobrado; los coseguros no se suman; las ventas llegan con un
 * día de atraso. Comprobantes cada 100 pedidos es una relación de volúmenes, no conversión.
 *
 * buildSalesReport es PURO. loadVendorSalesRows es de solo lectura.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { configForDay, type ConfigVersion } from "./config";

/** Ventas de un vendedor en una sucursal y un día, tal como las guarda la sincronización. */
export interface VendorSalesRow {
  /** Día del comprobante, "YYYY-MM-DD". */
  day: string;
  branchId: string;
  branchName: string;
  code: string;
  /** Nombre que trae SIAF. Sale de la base; se muestra solo dentro del bloque de ventas. */
  name: string;
  gross: number;
  receipts: number;
  discounts: number;
  units: number;
}

export interface SalesTotals {
  gross: number;
  receipts: number;
  discounts: number;
  units: number;
}

export interface SalesVendorLine extends SalesTotals {
  branchId: string;
  branchName: string;
  code: string;
  name: string;
  /** Días del período en que este vendedor contó como Call Center y tuvo ventas. */
  days: number;
  firstDay: string;
  lastDay: string;
}

export interface SalesDayLine extends SalesTotals {
  day: string;
  /** Vendedores del Call Center con ventas ese día. */
  vendors: number;
}

export interface SalesBranchLine extends SalesTotals {
  branchId: string;
  branchName: string;
}

/** Una sucursal dentro de la ficha de un operador. */
export interface SalesOperatorBranchLine {
  branchId: string;
  branchName: string;
  code: string;
  gross: number;
  receipts: number;
}

/**
 * Ventas de una persona: todos los códigos de SIAF asociados a su cuenta de operador en la
 * configuración. Un código sin cuenta asociada va en su propia ficha (account null).
 */
export interface SalesOperatorLine extends SalesTotals {
  /** externalId de la cuenta; null si el código no tiene cuenta asociada. */
  account: string | null;
  /** Alias de la cuenta en la configuración que regía su último día con ventas; null si no tiene. */
  alias: string | null;
  /** Nombre que trae SIAF, del día más reciente. Se usa de título cuando no hay cuenta asociada. */
  name: string;
  /** Días del período con comprobantes. */
  days: number;
  /** Por sucursal, en orden alfabético. */
  branches: SalesOperatorBranchLine[];
}

export interface SalesReport {
  from: string;
  to: string;
  total: SalesTotals;
  byDay: SalesDayLine[];
  byBranch: SalesBranchLine[];
  byVendor: SalesVendorLine[];
  /** Por persona: primero las cuentas, por alias; después los códigos sin cuenta asociada, por nombre. No por importe. */
  byOperator: SalesOperatorLine[];
  /** Días con ventas cargadas pero sin configuración vigente: no suman y no son cero. */
  daysWithoutConfig: string[];
  /** Versiones de configuración que se usaron dentro del período, de la más vieja a la más nueva. */
  configVersionsUsed: Array<{ id: string; validFrom: string }>;
  /** Último día con ventas cargadas dentro del período; null si no hay ninguno. */
  lastLoadedDay: string | null;
  /** Días del período con ventas cargadas (de cualquier vendedor), en orden. */
  loadedDays: string[];
  /**
   * Vendedor y día con importe negativo: ese día las notas de crédito superaron a las ventas.
   * Es lo único que la fuente deja ver de las notas de crédito: no las informa por separado.
   */
  negativeVendorDays: number;
}

const zero = (): SalesTotals => ({ gross: 0, receipts: 0, discounts: 0, units: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;
function add(t: SalesTotals, r: VendorSalesRow): void {
  t.gross += r.gross; t.receipts += r.receipts; t.discounts += r.discounts; t.units += r.units;
}
const done = <T extends SalesTotals>(t: T): T => ({ ...t, gross: round2(t.gross), discounts: round2(t.discounts) });

/** Clave de un vendedor: los códigos de SIAF son por sucursal. */
export const vendorKey = (branchId: string, code: string) => `${branchId}|${code}`;

/**
 * Informe de ventas del Call Center. PURO. Cada fila se incluye o no según la versión de
 * configuración que regía SU día.
 */
export function buildSalesReport(
  rows: readonly VendorSalesRow[],
  opts: { from: string; to: string; versions: readonly ConfigVersion[] },
): SalesReport {
  // Conjunto de vendedores del Call Center por versión, armado una sola vez.
  // El valor es la cuenta de operador asociada a ese código en esa versión (null si no tiene).
  const vendorSets = new Map<string, Map<string, string | null>>();
  const setFor = (v: ConfigVersion) => {
    let s = vendorSets.get(v.id);
    if (!s) {
      s = new Map(v.data.callCenterVendors.map((x) => [vendorKey(x.branchId, x.code), x.accountId ?? null]));
      vendorSets.set(v.id, s);
    }
    return s;
  };
  const versionByDay = new Map<string, ConfigVersion | null>();
  const versionFor = (day: string) => {
    if (!versionByDay.has(day)) versionByDay.set(day, configForDay(opts.versions, day));
    return versionByDay.get(day) ?? null;
  };

  const total = zero();
  const byDay = new Map<string, SalesTotals & { vendors: Set<string> }>();
  const byBranch = new Map<string, SalesBranchLine>();
  const byVendor = new Map<string, SalesVendorLine & { daySet: Set<string> }>();
  const byOperator = new Map<string, SalesTotals & { account: string | null; alias: string | null; name: string; lastDay: string; daySet: Set<string>; branches: Map<string, SalesOperatorBranchLine> }>();
  const withoutConfig = new Set<string>();
  const used = new Map<string, string>();
  let lastLoadedDay: string | null = null;
  const loaded = new Set<string>();
  let negativeVendorDays = 0;

  for (const r of rows) {
    if (r.day < opts.from || r.day > opts.to) continue;
    if (lastLoadedDay === null || r.day > lastLoadedDay) lastLoadedDay = r.day;
    loaded.add(r.day);

    const version = versionFor(r.day);
    if (!version) { withoutConfig.add(r.day); continue; }
    used.set(version.id, version.validFrom);
    const key = vendorKey(r.branchId, r.code);
    if (!setFor(version).has(key)) continue;

    add(total, r);
    if (r.gross < 0) negativeVendorDays++;

    const d = byDay.get(r.day) ?? { ...zero(), vendors: new Set<string>() };
    add(d, r); d.vendors.add(key);
    byDay.set(r.day, d);

    const b = byBranch.get(r.branchId) ?? { ...zero(), branchId: r.branchId, branchName: r.branchName };
    add(b, r);
    byBranch.set(r.branchId, b);

    const v = byVendor.get(key) ?? {
      ...zero(), branchId: r.branchId, branchName: r.branchName, code: r.code, name: r.name,
      days: 0, firstDay: r.day, lastDay: r.day, daySet: new Set<string>(),
    };
    add(v, r);
    v.daySet.add(r.day);
    if (r.day < v.firstDay) v.firstDay = r.day;
    if (r.day >= v.lastDay) { v.lastDay = r.day; v.name = r.name; } // el nombre más reciente
    byVendor.set(key, v);

    // Por persona: la cuenta asociada sale de la versión que regía ESE día.
    const account = setFor(version).get(key) ?? null;
    const opKey = account !== null ? `a|${account}` : `v|${key}`;
    const o = byOperator.get(opKey) ?? { ...zero(), account, alias: null, name: r.name, lastDay: "", daySet: new Set<string>(), branches: new Map<string, SalesOperatorBranchLine>() };
    add(o, r);
    o.daySet.add(r.day);
    if (r.day >= o.lastDay) {
      o.lastDay = r.day;
      o.name = r.name;
      o.alias = account !== null ? version.data.accounts.find((a) => a.externalId === account)?.alias ?? null : null;
    }
    const ob = o.branches.get(key) ?? { branchId: r.branchId, branchName: r.branchName, code: r.code, gross: 0, receipts: 0 };
    ob.gross += r.gross; ob.receipts += r.receipts;
    o.branches.set(key, ob);
    byOperator.set(opKey, o);
  }
  const operatorLabel = (o: { account: string | null; alias: string | null; name: string }) =>
    o.account !== null ? o.alias ?? `Cuenta ${o.account}` : o.name;

  return {
    from: opts.from,
    to: opts.to,
    total: done(total),
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, d]) => done({ day, gross: d.gross, receipts: d.receipts, discounts: d.discounts, units: d.units, vendors: d.vendors.size })),
    byBranch: [...byBranch.values()].sort((a, b) => a.branchName.localeCompare(b.branchName, "es")).map(done),
    byVendor: [...byVendor.values()]
      .sort((a, b) => a.branchName.localeCompare(b.branchName, "es") || a.code.localeCompare(b.code, "es"))
      .map(({ daySet, ...v }) => done({ ...v, days: daySet.size })),
    byOperator: [...byOperator.values()]
      .sort((a, b) => Number(a.account === null) - Number(b.account === null) || operatorLabel(a).localeCompare(operatorLabel(b), "es"))
      .map(({ daySet, lastDay: _lastDay, branches, ...o }) => done({
        ...o, days: daySet.size,
        branches: [...branches.values()].sort((a, b) => a.branchName.localeCompare(b.branchName, "es") || a.code.localeCompare(b.code, "es"))
          .map((b) => ({ ...b, gross: round2(b.gross) })),
      })),
    daysWithoutConfig: [...withoutConfig].sort(),
    configVersionsUsed: [...used.entries()].map(([id, validFrom]) => ({ id, validFrom })).sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
    lastLoadedDay,
    loadedDays: [...loaded].sort(),
    negativeVendorDays,
  };
}

/** Comprobantes cada 100 pedidos: relación de volúmenes. null sin pedidos (no cero). */
export function receiptsPer100Orders(receipts: number, orders: number): number | null {
  return orders > 0 ? Math.round((receipts / orders) * 1000) / 10 : null;
}

/**
 * Último día con ventas de SIAF cargadas con detalle de vendedores, en toda la base (no solo
 * en el período). null si no hay ninguno. Solo lectura.
 */
export async function loadLastSalesDay(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ day: string | null }>>(Prisma.sql`
    SELECT to_char(max(s."snapshotDate"), 'YYYY-MM-DD') AS "day"
    FROM "SalesSnapshot" s
    WHERE CASE WHEN jsonb_typeof(s."rawData"::jsonb -> 'vendedores') = 'array'
               THEN jsonb_array_length(s."rawData"::jsonb -> 'vendedores') > 0
               ELSE false END
  `);
  return rows[0]?.day ?? null;
}

interface RawVendorSalesRow {
  day: string; branchId: string; branchName: string; code: string; name: string | null;
  gross: number | null; receipts: number | null; discounts: number | null; units: number | null;
}

/**
 * Ventas por vendedor entre dos días, inclusive, de TODOS los vendedores con detalle: el
 * filtro de quién es del Call Center lo aplica buildSalesReport, día por día. Solo lectura.
 */
export async function loadVendorSalesRows(fromDay: string, toDayInclusive: string): Promise<VendorSalesRow[]> {
  const rows = await prisma.$queryRaw<RawVendorSalesRow[]>(Prisma.sql`
    SELECT to_char(s."snapshotDate", 'YYYY-MM-DD') AS "day",
      s."branchId" AS "branchId", b.name AS "branchName",
      v->>'codigo' AS "code", v->>'nombre' AS "name",
      (v->>'ventas')::float8 AS "gross",
      (v->>'tickets')::float8 AS "receipts",
      (v->>'descuentos')::float8 AS "discounts",
      (v->>'unidades')::float8 AS "units"
    FROM "SalesSnapshot" s
    JOIN "Branch" b ON b.id = s."branchId"
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s."rawData"::jsonb -> 'vendedores') = 'array' THEN s."rawData"::jsonb -> 'vendedores' ELSE '[]'::jsonb END
    ) v
    WHERE s."snapshotDate" >= ${fromDay}::date AND s."snapshotDate" <= ${toDayInclusive}::date
      AND coalesce(v->>'codigo', '') <> ''
  `);
  return rows.map((r) => ({
    day: r.day, branchId: r.branchId, branchName: r.branchName, code: r.code, name: r.name ?? r.code,
    gross: Number(r.gross ?? 0), receipts: Number(r.receipts ?? 0), discounts: Number(r.discounts ?? 0), units: Number(r.units ?? 0),
  }));
}
