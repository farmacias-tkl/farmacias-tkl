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
import { buildSalesReport, loadVendorSalesRows, receiptsPer100Orders, type SalesReport } from "./sales";
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
export function toSalesPayload(report: SalesReport, orders: ReadonlyMap<string, number>, opts: { now: Date; hasConfig: boolean }): SalesPayload {
  const byDay = report.byDay.map((d) => {
    const n = orders.get(d.day) ?? 0;
    return { ...d, orders: n, receiptsPer100Orders: receiptsPer100Orders(d.receipts, n) };
  });
  // Solo los días con comprobantes del Call Center: los dos lados de la relación cubren los mismos días.
  const totalOrders = byDay.reduce((n, d) => n + d.orders, 0);
  return {
    ...report,
    generatedAt: opts.now.toISOString(),
    byDay,
    orders: totalOrders,
    receiptsPer100Orders: receiptsPer100Orders(report.total.receipts, totalOrders),
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

  const [{ versions }, sales, entries] = await Promise.all([loadConfigVersions(), loadVendorSalesRows(from, to), loadEntryRows(from, to)]);
  const payload = toSalesPayload(buildSalesReport(sales, { from, to, versions }), ordersByDay(entries), {
    now, hasConfig: configForDay(versions, arDayISO(now)) !== null,
  });

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= ttl) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}
