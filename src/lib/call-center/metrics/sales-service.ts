/**
 * Bloque "Ventas SIAF": comprobantes de los vendedores del Call Center en un período, con
 * caché en memoria.
 *
 * Junta el informe de ventas (sales.ts, por fecha del comprobante) con los pedidos de cada
 * día (conversaciones de tipo pedido creadas ese día), para la relación "comprobantes cada
 * 100 pedidos". Es una relación de volúmenes: no hay vínculo entre conversación y comprobante.
 *
 * toSalesPayload es PURO. El registro de cada vista en AccessLog lo hace la ruta, no la
 * caché: una respuesta servida de caché también se registra.
 */
import { loadEntryRows, type EntryRow } from "./attention";
import { arDayISO } from "./business-time";
import { configForDay, loadConfigVersions } from "./config";
import { classifyManagementType } from "./management-type";
import { buildSalesReport, loadLastSalesDay, loadVendorSalesRows, receiptsPer100Orders, type SalesReport } from "./sales";
import { addDaysISO } from "./period";
import { getAccountsPayload } from "./accounts-service";
import { SALES_CACHE_SECONDS, type SalesPayload } from "./sales-types";

/** Pedidos por día de Buenos Aires: pedido en el bot o receta de Meducar. PURO. */
export function ordersByDay(rows: readonly Pick<EntryRow, "createdAt" | "orderFlow" | "firstCustomerMessageIsMeducar">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (classifyManagementType(r) === "OTROS") continue;
    const day = arDayISO(r.createdAt);
    out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

/** Arma la respuesta. PURO. */
export function toSalesPayload(
  report: SalesReport,
  orders: ReadonlyMap<string, number>,
  opts: { now: Date; hasConfig: boolean; siafLastDay: string | null; attendedByAccount?: ReadonlyMap<string, number> | null },
): SalesPayload {
  const byDay = report.byDay.map((d) => {
    const n = orders.get(d.day) ?? 0;
    return { ...d, orders: n, receiptsPer100Orders: receiptsPer100Orders(d.receipts, n) };
  });
  // La relación usa solo los días con ventas cargadas y configuración vigente: un día sin
  // datos de SIAF todavía tiene pedidos pero no comprobantes, y bajaría la relación sin motivo.
  const withoutConfig = new Set(report.daysWithoutConfig);
  const relationDays = report.loadedDays.filter((day) => !withoutConfig.has(day));
  const totalOrders = relationDays.reduce((n, day) => n + (orders.get(day) ?? 0), 0);

  // Días del período posteriores al último cargado: todavía no hay datos, no valen cero.
  const today = arDayISO(opts.now);
  const end = report.to < today ? report.to : today;
  const daysNotLoaded: string[] = [];
  for (let day = opts.siafLastDay && opts.siafLastDay >= report.from ? addDaysISO(opts.siafLastDay, 1) : report.from; day <= end; day = addDaysISO(day, 1)) {
    daysNotLoaded.push(day);
  }
  return {
    ...report,
    generatedAt: opts.now.toISOString(),
    byDay,
    byOperator: report.byOperator.map((o) => ({
      ...o,
      // Una cuenta sin mensajes en el período no figura en Operadores: son cero conversaciones.
      conversations: o.account !== null && opts.attendedByAccount ? opts.attendedByAccount.get(o.account) ?? 0 : null,
    })),
    orders: totalOrders,
    relationDays: relationDays.length,
    receiptsPer100Orders: receiptsPer100Orders(report.total.receipts, totalOrders),
    siafLastDay: opts.siafLastDay,
    siafDelayed: opts.siafLastDay !== null && opts.siafLastDay < addDaysISO(today, -1),
    daysNotLoaded,
    hasConfig: opts.hasConfig,
  };
}

/** Tope de períodos guardados: al llenarse se descartan los vencidos y, si no alcanza, todos. */
const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; payload: SalesPayload }>();

/** Informe de ventas del Call Center entre dos días, inclusive. */
export async function getSalesPayload(from: string, to: string, now: Date = new Date()): Promise<SalesPayload> {
  const key = `${from}|${to}`;
  const ttl = SALES_CACHE_SECONDS * 1000;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < ttl) return hit.payload;

  const [{ versions }, sales, entries, siafLastDay, accounts] = await Promise.all([
    loadConfigVersions(), loadVendorSalesRows(from, to), loadEntryRows(from, to), loadLastSalesDay(),
    // Conversaciones atendidas por cuenta, del informe de Operadores. Si falla, las ventas se muestran igual.
    getAccountsPayload(from, to, now).catch(() => null),
  ]);
  const attendedByAccount = accounts
    ? new Map(accounts.accounts.flatMap((a) => (a.account !== null ? [[a.account, a.conversations] as [string, number]] : [])))
    : null;
  const payload = toSalesPayload(buildSalesReport(sales, { from, to, versions }), ordersByDay(entries), {
    now, siafLastDay, hasConfig: configForDay(versions, arDayISO(now)) !== null, attendedByAccount,
  });

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= ttl) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}
