/**
 * Guardar una versión de la configuración de las métricas y leer las opciones que ofrece
 * el formulario. La autorización (callCenterMetricsConfigAccess) la aplica quien llama: la ruta de la API
 * y la página. Acá no se lee la sesión.
 *
 * Guardar NUNCA edita ni borra: crea una fila nueva, vigente desde `validFrom`. Queda en
 * AuditLog quién la creó, desde cuándo rige y cuántas cuentas y vendedores tiene; los
 * valores de la configuración no se copian al registro de auditoría.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { parseConfigData, type CallCenterMetricsConfigData } from "./config-schema";
import { isValidDayISO } from "./config-form";

export const CONFIG_AUDIT_ACTION = "CALL_CENTER_METRICS_CONFIG_SAVED";
export const CONFIG_AUDIT_ENTITY = "CallCenterMetricsConfig";

export type SaveConfigResult =
  | { ok: true; id: string; validFrom: string }
  | { ok: false; status: 400; errors: string[] };

/**
 * Valida y guarda una versión nueva. Todo o nada: la fila y su registro de auditoría van
 * en la misma transacción. Comprueba que las sucursales de los vendedores existan.
 */
export async function saveConfigVersion(
  prisma: PrismaClient,
  input: { actorUserId: string; validFrom: unknown; data: unknown },
): Promise<SaveConfigResult> {
  const errors: string[] = [];
  if (!isValidDayISO(input.validFrom)) errors.push("validFrom: fecha inválida (AAAA-MM-DD)");
  const parsed = parseConfigData(input.data);
  if (!parsed.ok) errors.push(...parsed.errors);
  if (errors.length > 0 || !parsed.ok || !isValidDayISO(input.validFrom)) return { ok: false, status: 400, errors };

  const data: CallCenterMetricsConfigData = parsed.data;
  const validFrom = input.validFrom;

  const branchIds = [...new Set(data.callCenterVendors.map((v) => v.branchId))];
  if (branchIds.length > 0) {
    const found = await prisma.branch.count({ where: { id: { in: branchIds } } });
    if (found !== branchIds.length) return { ok: false, status: 400, errors: ["callCenterVendors: hay una sucursal que no existe"] };
  }

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.callCenterMetricsConfig.create({
      data: {
        validFrom: new Date(`${validFrom}T00:00:00.000Z`),
        data: data as unknown as Prisma.InputJsonValue,
        createdByUserId: input.actorUserId,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: CONFIG_AUDIT_ACTION,
        entity: CONFIG_AUDIT_ENTITY,
        entityId: row.id,
        detail: {
          validFrom,
          firstResponseGoalMinutes: data.firstResponseGoalMinutes,
          accounts: data.accounts.length,
          callCenterVendors: data.callCenterVendors.length,
        },
      },
    });
    return row.id;
  });

  return { ok: true, id, validFrom };
}

/**
 * Una cuenta de Emozion vista en los datos, para ofrecerla en el formulario: porque escribió
 * mensajes como operador, porque figura como asignada de una conversación, o las dos cosas.
 */
export interface KnownAccount {
  externalId: string;
  /** null si la cuenta nunca escribió un mensaje. */
  firstMessageDay: string | null;
  lastMessageDay: string | null;
  messagesLast30Days: number;
  /** Último día en que figuró como asignada (conversación o cambio de estado); null si nunca. */
  lastAssignedDay: string | null;
  /** Vista solo como asignada: nunca escribió. Suele ser una cuenta de sistema. */
  onlySeenAsAssignee: boolean;
}

interface MessageAccountRow { externalId: string; firstMessageDay: string; lastMessageDay: string; messagesLast30Days: number }
interface AssigneeAccountRow { externalId: string; lastAssignedDay: string }

/** Une las cuentas que escribieron con las que figuran como asignadas. PURO. */
export function mergeKnownAccounts(messages: readonly MessageAccountRow[], assignees: readonly AssigneeAccountRow[]): KnownAccount[] {
  const assignedDay = new Map(assignees.map((a) => [a.externalId, a.lastAssignedDay]));
  const wrote = new Set(messages.map((m) => m.externalId));
  return [
    // Primero las que escribieron (ya vienen de la más reciente a la más antigua)…
    ...messages.map((m) => ({ ...m, lastAssignedDay: assignedDay.get(m.externalId) ?? null, onlySeenAsAssignee: false })),
    // …y después las vistas solo como asignadas, por número.
    ...assignees
      .filter((a) => !wrote.has(a.externalId))
      .sort((a, b) => a.externalId.localeCompare(b.externalId, "es", { numeric: true }))
      .map((a) => ({
        externalId: a.externalId, firstMessageDay: null, lastMessageDay: null, messagesLast30Days: 0,
        lastAssignedDay: a.lastAssignedDay, onlySeenAsAssignee: true,
      })),
  ];
}

/** Un vendedor de SIAF visto en las ventas recientes de una sucursal. */
export interface KnownVendor {
  branchId: string;
  branchName: string;
  code: string;
  /** Nombre que trae SIAF. Sale de la base y se muestra solo en la pantalla de configuración. */
  name: string;
  lastSaleDay: string;
}

/** Días hacia atrás de ventas que se miran para listar vendedores. */
export const VENDOR_LOOKBACK_DAYS = 90;

/**
 * Opciones del formulario: las cuentas de Emozion que alguna vez escribieron o figuraron
 * como asignadas, y los vendedores con ventas en los últimos VENDOR_LOOKBACK_DAYS días, por
 * sucursal. Solo lectura.
 */
export async function loadConfigOptions(prisma: PrismaClient): Promise<{ accounts: KnownAccount[]; vendors: KnownVendor[] }> {
  // Asignadas: el valor actual de cada conversación y el de cada cambio de estado.
  const assignees = await prisma.$queryRaw<AssigneeAccountRow[]>(Prisma.sql`
    SELECT x.id AS "externalId", to_char(max(x.t) - interval '3 hours', 'YYYY-MM-DD') AS "lastAssignedDay"
    FROM (
      SELECT c."externalAssigneeId" AS id, c."updatedAt" AS t FROM "Conversation" c WHERE c."externalAssigneeId" IS NOT NULL
      UNION ALL
      SELECT h."externalAssigneeId" AS id, h."changedAt" AS t FROM "ConversationStateHistory" h WHERE h."externalAssigneeId" IS NOT NULL
    ) x
    GROUP BY x.id
  `);

  const messageAccounts = await prisma.$queryRaw<MessageAccountRow[]>(Prisma.sql`
    SELECT m."externalSenderId" AS "externalId",
      to_char(min(m."sentAt") - interval '3 hours', 'YYYY-MM-DD') AS "firstMessageDay",
      to_char(max(m."sentAt") - interval '3 hours', 'YYYY-MM-DD') AS "lastMessageDay",
      (count(*) FILTER (WHERE m."sentAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'))::int AS "messagesLast30Days"
    FROM "ConversationMessage" m
    WHERE m.author = 'OPERATOR' AND m."externalSenderId" IS NOT NULL
    GROUP BY 1
    ORDER BY max(m."sentAt") DESC
  `);
  const accounts = mergeKnownAccounts(messageAccounts, assignees);

  const vendors = await prisma.$queryRaw<KnownVendor[]>(Prisma.sql`
    SELECT s."branchId" AS "branchId", b.name AS "branchName",
      v->>'codigo' AS "code",
      (array_agg(v->>'nombre' ORDER BY s."snapshotDate" DESC))[1] AS "name",
      to_char(max(s."snapshotDate"), 'YYYY-MM-DD') AS "lastSaleDay"
    FROM "SalesSnapshot" s
    JOIN "Branch" b ON b.id = s."branchId"
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s."rawData"::jsonb -> 'vendedores') = 'array' THEN s."rawData"::jsonb -> 'vendedores' ELSE '[]'::jsonb END
    ) v
    WHERE s."snapshotDate" >= (current_date - ${VENDOR_LOOKBACK_DAYS}::int)
      AND coalesce(v->>'codigo', '') <> ''
    GROUP BY s."branchId", b.name, v->>'codigo'
    ORDER BY b.name, (array_agg(v->>'nombre' ORDER BY s."snapshotDate" DESC))[1]
  `);

  return { accounts, vendors };
}
