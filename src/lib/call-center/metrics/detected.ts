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
import { arDayStartUTC, utcTimestampParam } from "./business-time";
import {
  CLAIM_GROUP_OF, CLAIM_MOTIVES, CLAIM_PATTERNS, SALE_BOUGHT, SALE_ELSEWHERE, SALE_PICKED_UP,
  branchNamesRegex, saleBoughtAtTkl, type ClaimGroup, type ClaimMotive, type MessagePattern,
} from "./detected-patterns";
import type { DetectedCase, DetectedPayload, DetectedSection, SaleKind } from "./detected-types";
import { SALE_KINDS } from "./detected-types";

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

function section<M extends string>(motives: readonly M[], entries: Array<{ row: DetectedRow; motive: M }>, maxRows: number): DetectedSection<M> {
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
  opts: { now: Date; from: string; to: string; conversations: number; maxRows?: number },
): DetectedPayload {
  const maxRows = opts.maxRows ?? DETECTED_MAX_ROWS;
  const sales: Array<{ row: DetectedRow; motive: SaleKind }> = [];
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

/** ¿Algún mensaje cumple alguno de los patrones? Fragmento SQL sobre el alias `m`. */
function anyMessage(patterns: readonly MessagePattern[]): Prisma.Sql {
  const alternatives = patterns.map((p) => {
    const parts = [
      ...p.all.map((rx) => Prisma.sql`m.body ~* ${rx}`),
      ...(p.none ?? []).map((rx) => Prisma.sql`m.body !~* ${rx}`),
    ];
    return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
  });
  return Prisma.sql`coalesce(bool_or(${Prisma.join(alternatives, " OR ")}), false)`;
}

type RawRow = { conversationId: string; createdAt: Date; open: boolean; elsewhere: boolean; pickedUp: boolean; boughtAtTkl: boolean; bought: boolean } & Record<string, unknown>;

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
    claims: Object.fromEntries(CLAIM_MOTIVES.map((m) => [m, r[`claim_${m}`] === true])) as Record<ClaimMotive, boolean>,
  }));
  // Solo las que tienen alguna marca: el resto no aporta y no hace falta moverlo.
  return { rows: mapped.filter((r) => classifySale(r) !== null || claimsOf(r).length > 0), conversations: total };
}

const CACHE_MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; payload: DetectedPayload }>();
const CACHE_MS = 60_000;

/** Informe del período, con caché de un minuto por período. */
export async function getDetectedPayload(from: string, to: string, now: Date = new Date()): Promise<DetectedPayload> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.payload;

  const { rows, conversations } = await loadDetectedRows(from, to);
  const payload = buildDetectedReport(rows, { now, from, to, conversations });

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (now.getTime() - v.at >= CACHE_MS) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now.getTime(), payload });
  return payload;
}
