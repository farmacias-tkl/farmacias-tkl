/**
 * Derivaciones a compra presencial: el operador avisa que la sucursal no tiene personal de
 * pedidos o que no hace envíos ni retiros, y manda al cliente a comprar al local.
 *
 * Fuera del horario de pedidos de la sucursal eso es correcto. Dentro del horario es una
 * posible venta perdida: "Derivado dentro del horario". El horario de pedidos (retiro y
 * envíos, por separado) sale de la configuración, día por día, y no rige en los feriados.
 *
 * Qué sucursal es, en este orden:
 *  1. la que nombra el aviso del operador;
 *  2. la que el cliente escribió al contestar "¿Qué sucursal es más cercana?";
 *  3. la que informó el bot ("Tu sucursal más cerca es: …").
 * Si no hay ninguna queda "sucursal no identificada" y no se marca dentro ni fuera de horario.
 *
 * No es una derivación el aviso de que no se hacen envíos "a esa dirección" o "a esa zona"
 * cuando en el mismo mensaje se ofrece el retiro: es una zona sin cobertura, no una sucursal
 * que no toma pedidos.
 *
 * derivationTiming y resolveBranchId son PUROS. loadDerivationRows es de solo lectura: del
 * texto solo sale el nombre de sucursal encontrado, nunca el mensaje.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { arDayISO, arDayStartUTC, isWithinHours, utcTimestampParam } from "./business-time";
import { configForDay, loadConfigVersions, type ConfigVersion } from "./config";
import { branchOrderHours } from "./schedule";
import { branchNamesRegex } from "./detected-patterns";
import {
  OPERATOR_DERIVED, OPERATOR_DERIVED_DELIVERY, OPERATOR_NO_COVERAGE, OPERATOR_OFFERS_PICKUP,
  ORDER_CLOSING_OPERATOR, ORDER_CONFIRMED_OPERATOR, PAYMENT_CUSTOMER,
} from "./kinds-patterns";

const MS_DAY = 86_400_000;

/**
 *  - EN_HORARIO: el aviso se mandó dentro del horario de pedidos de la sucursal;
 *  - FUERA_HORARIO: fuera de ese horario (o en un feriado): la derivación es correcta;
 *  - SIN_SUCURSAL: no se pudo identificar la sucursal;
 *  - SIN_HORARIO: la sucursal no tiene horario de pedidos cargado para ese día.
 */
export type DerivationTiming = "EN_HORARIO" | "FUERA_HORARIO" | "SIN_SUCURSAL" | "SIN_HORARIO";

export interface BranchRef {
  id: string;
  name: string;
}

/** Un aviso de derivación: el primero de la conversación. Sin teléfono, nombre ni texto. */
export interface DerivationRow {
  conversationId: string;
  createdAt: Date;
  open: boolean;
  /** Cuándo se mandó el aviso. */
  at: Date;
  /** El aviso habla de envíos (se compara con el horario de envíos); si no, con el de retiro. */
  delivery: boolean;
  /** Nombre de sucursal encontrado en el aviso, en la respuesta del cliente y en el mensaje del bot. */
  noticeBranch: string | null;
  customerBranch: string | null;
  botBranch: string | null;
  /** La conversación tiene evidencia de venta: la derivación no terminó en pérdida. */
  sold: boolean;
}

/** Nombre sin acentos, en minúsculas y con espacios simples, para comparar. */
export function normalizeBranchName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Sucursal de la derivación: aviso, respuesta del cliente o mensaje del bot, en ese orden. PURO. */
export function resolveBranchId(r: Pick<DerivationRow, "noticeBranch" | "customerBranch" | "botBranch">, branches: readonly BranchRef[]): string | null {
  const byName = new Map(branches.map((b) => [normalizeBranchName(b.name), b.id]));
  for (const text of [r.noticeBranch, r.customerBranch, r.botBranch]) {
    const id = text ? byName.get(normalizeBranchName(text)) : undefined;
    if (id) return id;
  }
  return null;
}

/** ¿El aviso cayó dentro del horario de pedidos de la sucursal? PURO. */
export function derivationTiming(
  r: Pick<DerivationRow, "at" | "delivery" | "noticeBranch" | "customerBranch" | "botBranch">,
  branches: readonly BranchRef[],
  versions: readonly ConfigVersion[],
): DerivationTiming {
  const branchId = resolveBranchId(r, branches);
  if (!branchId) return "SIN_SUCURSAL";
  const version = configForDay(versions, arDayISO(r.at));
  if (!version?.data.branchOrderHours?.some((b) => b.branchId === branchId)) return "SIN_HORARIO";
  return isWithinHours(r.at, branchOrderHours(versions, branchId, r.delivery ? "delivery" : "pickup")) ? "EN_HORARIO" : "FUERA_HORARIO";
}

type RawDerivationRow = Omit<DerivationRow, "delivery" | "sold"> & { delivery: boolean | null; sold: boolean | null };

/**
 * Primer aviso de derivación de cada conversación creada entre dos días de Buenos Aires,
 * inclusive. Solo lectura. `branches` son las sucursales de la tabla: de ahí salen los
 * nombres que se buscan en el texto.
 */
export async function loadDerivationRows(fromDay: string, toDayInclusive: string, branches: readonly BranchRef[]): Promise<DerivationRow[]> {
  const from = arDayStartUTC(fromDay);
  const to = new Date(arDayStartUTC(toDayInclusive).getTime() + MS_DAY);
  const names = branchNamesRegex(branches.map((b) => b.name));
  // Sin sucursales cargadas no hay nombre que buscar: un patrón que no coincide con nada.
  const inText = names ? `(?i)\\m(${names})\\M` : "(?!)";
  const alone = names ? `(?i)^[^[:alnum:]]*(${names})[^[:alnum:]]*$` : "(?!)";
  const afterBot = names ? `(?i)sucursal m[aá]s cerca es:?[^[:alnum:]]*(${names})` : "(?!)";
  const op = Prisma.sql`m.author = 'OPERATOR' AND NOT m."isPrivate"`;

  const rows = await prisma.$queryRaw<RawDerivationRow[]>(Prisma.sql`
    WITH scope AS (
      SELECT c.id, c."createdAt", c.status
      FROM "Conversation" c
      WHERE c."createdAt" >= ${utcTimestampParam(from)}::timestamp AND c."createdAt" < ${utcTimestampParam(to)}::timestamp
    ), d AS (
      SELECT DISTINCT ON (m."conversationId") m."conversationId" AS cid, m."sentAt" AS at, m.body
      FROM "ConversationMessage" m
      JOIN scope s ON s.id = m."conversationId"
      WHERE ${op} AND m.body ~* ${OPERATOR_DERIVED}
        AND NOT (m.body ~* ${OPERATOR_NO_COVERAGE} AND m.body ~* ${OPERATOR_OFFERS_PICKUP})
      ORDER BY m."conversationId", m."sentAt", m.id
    )
    SELECT s.id AS "conversationId", s."createdAt" AS "createdAt", (s.status <> 'RESUELTA') AS "open",
      d.at AS "at",
      (d.body ~* ${OPERATOR_DERIVED_DELIVERY}) AS "delivery",
      lower(substring(d.body from ${inText})) AS "noticeBranch",
      (SELECT lower(substring(m.body from ${alone})) FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND m.author = 'CUSTOMER' AND m.body ~ ${alone}
        ORDER BY m."sentAt" DESC, m.id DESC LIMIT 1) AS "customerBranch",
      (SELECT lower(substring(m.body from ${afterBot})) FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND m.author = 'BOT' AND m.body ~ ${afterBot}
        ORDER BY m."sentAt" DESC, m.id DESC LIMIT 1) AS "botBranch",
      EXISTS (SELECT 1 FROM "ConversationMessage" m
        WHERE m."conversationId" = s.id AND ((${op} AND (m.body ~* ${ORDER_CONFIRMED_OPERATOR} OR m.body ~* ${ORDER_CLOSING_OPERATOR}))
          OR (m.author = 'CUSTOMER' AND m.body ~* ${PAYMENT_CUSTOMER}))) AS "sold"
    FROM d
    JOIN scope s ON s.id = d.cid
  `);
  return rows.map((r) => ({ ...r, delivery: r.delivery === true, sold: r.sold === true }));
}

export interface Derivation extends DerivationRow {
  timing: DerivationTiming;
}

/** Derivaciones del período, cada una con su horario resuelto. */
export async function getDerivations(fromDay: string, toDayInclusive: string): Promise<Derivation[]> {
  const [branches, { versions }] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true } }),
    loadConfigVersions(),
  ]);
  const rows = await loadDerivationRows(fromDay, toDayInclusive, branches);
  return rows.map((r) => ({ ...r, timing: derivationTiming(r, branches, versions) }));
}
