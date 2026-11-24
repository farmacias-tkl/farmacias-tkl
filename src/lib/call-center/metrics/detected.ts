/**
 * "Reclamos y pérdidas": conversaciones creadas en el período en las que algún mensaje del
 * cliente coincide con los patrones de detected-patterns.ts. Es nivel DETECTADO: candidatos
 * para revisar, no reclamos ni pérdidas confirmados.
 *
 * Ventas (una sola categoría por conversación, en este orden):
 *  1. pérdida confirmada: otra farmacia, otro lado, o cancela;
 *  2. compró en TKL: ya retiró el pedido, o compró y menciona TKL o una sucursal;
 *  3. compró por su cuenta y no dice dónde.
 * Las tres se muestran por separado y no se suman como pérdida.
 *
 * Reclamos: una conversación puede tener varios motivos, en tres grupos (Call Center,
 * envíos y tienda online).
 *
 * classifySale, claimsOf y buildDetectedReport son PUROS. loadDetectedRows es de solo
 * lectura: los textos se evalúan dentro de la consulta y solo salen marcas (sí/no), la
 * fecha y el estado.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { arDayISO, arDayStartUTC, utcTimestampParam } from "./business-time";
import { periodCacheMs } from "./period";
import {
  CLAIM_GROUP_OF, CLAIM_MOTIVES, CLAIM_PATTERNS, CUSTOMER_HOME_DELIVERY_OPTION, NOTHING_ARRIVED, SALE_BOUGHT, SALE_ELSEWHERE, SALE_PICKED_UP,
  branchNamesRegex, saleBoughtAtTkl, type ClaimGroup, type ClaimMotive, type MessagePattern,
} from "./detected-patterns";
import type { DetectedCase, DetectedPayload, DetectedSection, SaleKind } from "./detected-types";
import { SALE_KINDS } from "./detected-types";
import { getDerivations } from "./derivation";

export const DETECTED_MAX_ROWS = 200;
const MS_DAY = 86_400_000;

/** Una conversación del período con sus marcas. Sin teléfono, nombre ni texto. */
export interface DetectedRow {
  conversationId: string;
  createdAt: Date;
  open: boolean;
  elsewhere: boolean;
  pickedUp: boolean;
  boughtAtTkl: boolean;
  bought: boolean;
  claims: Record<ClaimMotive, boolean>;
}

/** PURO. */
export function classifySale(r: Pick<DetectedRow, "elsewhere" | "pickedUp" | "boughtAtTkl" | "bought">): SaleKind | null {
  if (r.elsewhere) return "ELSEWHERE";
  if (r.pickedUp || r.boughtAtTkl) return "AT_TKL";
  return r.bought ? "UNKNOWN_PLACE" : null;
}

/** Motivos de reclamo de una conversación, en el orden del catálogo. PURO. */
export function claimsOf(r: Pick<DetectedRow, "claims">): ClaimMotive[] {
  return CLAIM_MOTIVES.filter((m) => r.claims[m]);
}

/** Lo mínimo de una conversación para listarla como caso. */
export type CaseRow = Pick<DetectedRow, "conversationId" | "createdAt" | "open">;

function section<M extends string>(motives: readonly M[], entries: Array<{ row: CaseRow; motive: M }>, maxRows: number): DetectedSection<M> {
  const cases: DetectedCase<M>[] = entries
    .map(({ row, motive }) => ({ conversationId: row.conversationId, createdAt: row.createdAt.toISOString(), motive, open: row.open }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return {
    conversations: new Set(entries.map((e) => e.row.conversationId)).size,
    byMotive: motives.map((motive) => ({ motive, count: entries.filter((e) => e.motive === motive).length })),
    cases: cases.slice(0, maxRows),
    casesTotal: cases.length,
  };
}

/** Informe del período. PURO. */
export function buildDetectedReport(
  rows: readonly DetectedRow[],
  opts: { now: Date; from: string; to: string; conversations: number; maxRows?: number; derivedInHours?: readonly CaseRow[] },
): DetectedPayload {
  const maxRows = opts.maxRows ?? DETECTED_MAX_ROWS;
  const sales: Array<{ row: CaseRow; motive: SaleKind }> = [];
  // Derivados a compra presencial dentro del horario de pedidos de la sucursal, sin evidencia de venta.
  for (const row of opts.derivedInHours ?? []) sales.push({ row, motive: "DERIVED_IN_HOURS" });
  const claims: Record<ClaimGroup, Array<{ row: DetectedRow; motive: ClaimMotive }>> = { CALL_CENTER: [], ENVIOS: [], TIENDA_ONLINE: [] };
  for (const row of rows) {
    const sale = classifySale(row);
    if (sale) sales.push({ row, motive: sale });
    for (const motive of claimsOf(row)) claims[CLAIM_GROUP_OF[motive]].push({ row, motive });
  }
  const motivesOf = (g: ClaimGroup) => CLAIM_MOTIVES.filter((m) => CLAIM_GROUP_OF[m] === g);
  return {
    generatedAt: opts.now.toISOString(),
    from: opts.from,
    to: opts.to,
    conversations: opts.conversations,
    sales: section(SALE_KINDS, sales, maxRows),
    claims: {
      CALL_CENTER: section(motivesOf("CALL_CENTER"), claims.CALL_CENTER, maxRows),
      ENVIOS: section(motivesOf("ENVIOS"), claims.ENVIOS, maxRows),
      TIENDA_ONLINE: section(motivesOf("TIENDA_ONLINE"), claims.TIENDA_ONLINE, maxRows),
    },
  };
}

/** ¿El mensaje `m` cumple alguno de los patrones? Fragmento SQL sobre el alias `m`, sin agregar. */
export function messageMatches(patterns: readonly MessagePattern[]): Prisma.Sql {
  const alternatives = patterns.map((p) => {
    const parts = [
      ...p.all.map((rx) => Prisma.sql`m.body ~* ${rx}`),
      ...(p.none ?? []).map((rx) => Prisma.sql`m.body !~* ${rx}`),
    ];
    return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
  });
  return Prisma.sql`(${Prisma.join(alternatives, " OR ")})`;
}

/** ¿Algún mensaje cumple alguno de los patrones? Fragmento SQL sobre el alias `m`. */
function anyMessage(patterns: readonly MessagePattern[]): Prisma.Sql {
  return Prisma.sql`coalesce(bool_or(${messageMatches(patterns)}), false)`;
}

type RawRow = {
  conversationId: string; createdAt: Date; open: boolean; elsewhere: boolean; pickedUp: boolean; boughtAtTkl: boolean; bought: boolean;
  nothingArrived: boolean; homeDelivery: boolean;
} & Record<string, unknown>;

/**
 * Motivos de una fila. "No me llegó nada" pasa a envío que no llegó solo si el cliente eligió
 * envío a domicilio y no hay un reclamo de confirmación de la tienda online. PURO.
 */
export function claimFlags(raw: Record<ClaimMotive, boolean>, extra: { nothingArrived: boolean; homeDelivery: boolean }): Record<ClaimMotive, boolean> {
  return { ...raw, ENVIO_NO_LLEGO: raw.ENVIO_NO_LLEGO || (extra.nothingArrived && extra.homeDelivery && !raw.WEB_SIN_CONFIRMACION) };
}

/**
 * Conversaciones creadas entre dos días de Buenos Aires, inclusive, con al menos una marca.
 * Devuelve también cuántas conversaciones se revisaron. Solo lectura.
 */
export async function loadDetectedRows(fromDay: string, toDayInclusive: string): Promise<{ rows: DetectedRow[]; conversations: number }> {
  const from = arDayStartUTC(fromDay);
  const to = new Date(arDayStartUTC(toDayInclusive).getTime() + MS_DAY);
  const branches = await prisma.branch.findMany({ select: { name: true } });
  const tkl = saleBoughtAtTkl(branchNamesRegex(branches.map((b) => b.name)));

  const claimColumns = CLAIM_MOTIVES.map((motive) => Prisma.sql`${anyMessage(CLAIM_PATTERNS[motive])} AS ${Prisma.raw(`"claim_${motive}"`)}`);

  const [rows, total] = await Promise.all([
    prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT c.id AS "conversationId", c."createdAt" AS "createdAt", (c.status <> 'RESUELTA') AS "open",
        ${anyMessage(SALE_ELSEWHERE)} AS "elsewhere",
        ${anyMessage(SALE_PICKED_UP)} AS "pickedUp",
        ${anyMessage(tkl)} AS "boughtAtTkl",
        ${anyMessage(SALE_BOUGHT)} AS "bought",
        ${anyMessage(NOTHING_ARRIVED)} AS "nothingArrived",
        coalesce(bool_or(m.body = ${CUSTOMER_HOME_DELIVERY_OPTION}), false) AS "homeDelivery",
        ${Prisma.join(claimColumns, ", ")}
      FROM "Conversation" c
      JOIN "ConversationMessage" m ON m."conversationId" = c.id AND m.author = 'CUSTOMER' AND m.body IS NOT NULL
      WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
      GROUP BY c.id, c."createdAt", c.status
    `),
    prisma.conversation.count({ where: { createdAt: { gte: from, lt: to } } }),
  ]);

  const mapped: DetectedRow[] = rows.map((r) => ({
    conversationId: r.conversationId,
    createdAt: r.createdAt,
    open: r.open,
    elsewhere: r.elsewhere,
    pickedUp: r.pickedUp,
    boughtAtTkl: r.boughtAtTkl,
    bought: r.bought,
    claims: claimFlags(Object.fromEntries(CLAIM_MOTIVES.map((m) => [m, r[`claim_${m}`] === true])) as Record<ClaimMotive, boolean>, r),
  }));
  // Solo las que tienen alguna marca: el resto no aporta y no hace falta moverlo.
  return { rows: mapped.filter((r) => classifySale(r) !== null || claimsOf(r).length > 0), conversations: total };
}

/**
 * Motivos de reclamo detectados en un conjunto dado de conversaciones (las pendientes de
 * "Ahora"), con las mismas reglas que el informe. Solo lectura; las que no tienen ninguno no
 * aparecen. Mira solo esas conversaciones, no el período entero.
 */
export async function loadClaimMotives(conversationIds: readonly string[]): Promise<Map<string, ClaimMotive[]>> {
  const out = new Map<string, ClaimMotive[]>();
  if (conversationIds.length === 0) return out;
  const claimColumns = CLAIM_MOTIVES.map((motive) => Prisma.sql`${anyMessage(CLAIM_PATTERNS[motive])} AS ${Prisma.raw(`"claim_${motive}"`)}`);
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; nothingArrived: boolean; homeDelivery: boolean } & Record<string, unknown>>>(Prisma.sql`
    SELECT m."conversationId" AS "conversationId",
      ${anyMessage(NOTHING_ARRIVED)} AS "nothingArrived",
      coalesce(bool_or(m.body = ${CUSTOMER_HOME_DELIVERY_OPTION}), false) AS "homeDelivery",
      ${Prisma.join(claimColumns, ", ")}
    FROM "ConversationMessage" m
    WHERE m."conversationId" IN (${Prisma.join(conversationIds)}) AND m.author = 'CUSTOMER' AND m.body IS NOT NULL
    GROUP BY 1
  `);
  for (const r of rows) {
    const claims = claimFlags(Object.fromEntries(CLAIM_MOTIVES.map((mo) => [mo, r[`claim_${mo}`] === true])) as Record<ClaimMotive, boolean>, r);
    const motives = claimsOf({ claims });
    if (motives.length > 0) out.set(r.conversationId, motives);
  }
  return out;
}

const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; ttl: number; payload: DetectedPayload }>();

/** Informe del período, con caché por período: un minuto si llega a hoy, cinco si terminó antes. */
export async function getDetectedPayload(from: string, to: string, now: Date = new Date()): Promise<DetectedPayload> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < hit.ttl) return hit.payload;

  const [{ rows, conversations }, derivations] = await Promise.all([loadDetectedRows(from, to), getDerivations(from, to)]);
  const derivedInHours = derivations.filter((d) => d.timing === "EN_HORARIO" && !d.sold);
  const payload = buildDetectedReport(rows, { now, from, to, conversations, derivedInHours });

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= v.ttl) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), ttl: periodCacheMs(to, arDayISO(now)), payload });
  return payload;
}
