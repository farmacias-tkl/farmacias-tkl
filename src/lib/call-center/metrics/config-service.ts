/**
 * Guardar una versión de la configuración de las métricas y leer las opciones que ofrece
 * el formulario. La autorización (solo Dirección) la aplica quien llama: la ruta de la API
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

/** Una cuenta de Emozion que escribió mensajes: para ofrecerla en el formulario. */
export interface KnownAccount {
  externalId: string;
  firstMessageDay: string;
  lastMessageDay: string;
  messagesLast30Days: number;
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
 * Opciones del formulario: las cuentas de Emozion que alguna vez escribieron y los
 * vendedores con ventas en los últimos VENDOR_LOOKBACK_DAYS días, por sucursal. Solo lectura.
 */
export async function loadConfigOptions(prisma: PrismaClient): Promise<{ accounts: KnownAccount[]; vendors: KnownVendor[] }> {
  const accounts = await prisma.$queryRaw<KnownAccount[]>(Prisma.sql`
    SELECT m."externalSenderId" AS "externalId",
      to_char(min(m."sentAt") - interval '3 hours', 'YYYY-MM-DD') AS "firstMessageDay",
      to_char(max(m."sentAt") - interval '3 hours', 'YYYY-MM-DD') AS "lastMessageDay",
      (count(*) FILTER (WHERE m."sentAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'))::int AS "messagesLast30Days"
    FROM "ConversationMessage" m
    WHERE m.author = 'OPERATOR' AND m."externalSenderId" IS NOT NULL
    GROUP BY 1
    ORDER BY max(m."sentAt") DESC
  `);

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
