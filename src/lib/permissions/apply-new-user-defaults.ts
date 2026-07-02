/**
 * Helper de DEFAULTS para usuarios NUEVOS (Fase 2F-DEFAULT_NEW_USER).
 *
 * Completa la simetría de permisos: los usuarios existentes recibieron sus defaults por
 * backfill (DEFAULT_BACKFILL); los usuarios nuevos los reciben al crearse, vía este helper,
 * con source = DEFAULT_NEW_USER.
 *
 * Diseño (2F-DEFAULT_NEW_USER-B): best-effort / híbrido.
 *  - Se llama DESPUÉS de user.create (paso aditivo), NUNCA rollbackea el usuario.
 *  - Helper TOTAL: JAMÁS lanza hacia el endpoint. Ante actor ausente/inactivo, throw en la
 *    carga del actor, throw del motor o cualquier fallo, devuelve un resultado estructurado
 *    con ok=false + warning. Un alta ya creada nunca se convierte en 500 por defaults.
 *  - Carga el actor desde DB { id, role, active } (no confía en el JWT para `active`).
 *  - Única vía de escritura = applyDefaultPermissionsForUser → grantUserPermissionToTarget.
 *    NO escribe UserPermission/AuditLog directo. NO duplica role-defaults.
 *  - source = DEFAULT_NEW_USER; batchId NO se envía (solo DEFAULT_BACKFILL lo requiere).
 */
import type { UserRole } from "@prisma/client";
import { applyDefaultPermissionsForUser } from "./apply-default-permissions";

/** Cliente mínimo que el helper necesita para cargar el actor. */
type PrismaClientLike = {
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; role: true; active: true };
    }) => Promise<{ id: string; role: UserRole; active: boolean } | null>;
  };
};

export interface ApplyNewUserDefaultsArgs {
  actorId: string;
  targetUser: {
    id: string;
    role: UserRole;
    branchId?: string | null;
  };
  client: PrismaClientLike;
  ip?: string | null;
  userAgent?: string | null;
  /** Inyección para tests; por defecto el motor real. */
  applyFn?: typeof applyDefaultPermissionsForUser;
}

export interface ApplyNewUserDefaultsResult {
  ok: boolean;
  source: "DEFAULT_NEW_USER";
  totalDefaults: number;
  attempted: number;
  granted: number;
  noop: number;
  scopeChanged: number;
  failed: number;
  warning?: { message: string; failed: number };
}

function base(): ApplyNewUserDefaultsResult {
  return {
    ok: false, source: "DEFAULT_NEW_USER",
    totalDefaults: 0, attempted: 0, granted: 0, noop: 0, scopeChanged: 0, failed: 0,
  };
}

export async function applyNewUserDefaults(
  args: ApplyNewUserDefaultsArgs,
): Promise<ApplyNewUserDefaultsResult> {
  const { actorId, targetUser, client, ip, userAgent } = args;
  const applyFn = args.applyFn ?? applyDefaultPermissionsForUser;

  try {
    // 1. Cargar actor desde DB (no confiar en JWT para active).
    const actor = await client.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, active: true },
    });
    if (!actor) {
      return { ...base(), ok: false, warning: { message: "Actor no encontrado; defaults no aplicados", failed: 0 } };
    }
    if (actor.active === false) {
      return { ...base(), ok: false, warning: { message: "Actor inactivo; defaults no aplicados", failed: 0 } };
    }

    // 2. Aplicar defaults vía el motor real (source DEFAULT_NEW_USER, sin batchId).
    const r = await applyFn({
      actor,
      targetUserId: targetUser.id,
      role: targetUser.role,
      client: client as never,
      source: "DEFAULT_NEW_USER",
      ip,
      userAgent,
    });

    const normalized: ApplyNewUserDefaultsResult = {
      ok: r.ok,
      source: "DEFAULT_NEW_USER",
      totalDefaults: r.totalDefaults,
      attempted: r.attempted,
      granted: r.granted,
      noop: r.noop,
      scopeChanged: r.scopeChanged,
      failed: r.failed,
    };
    if (!r.ok) {
      normalized.warning = { message: r.error ?? "Algunos defaults no se aplicaron", failed: r.failed };
    }
    return normalized;
  } catch (err) {
    // TOTAL: cualquier throw inesperado se normaliza; nunca se propaga al endpoint.
    const message = err instanceof Error ? err.message : String(err);
    return { ...base(), ok: false, warning: { message: `Error aplicando defaults: ${message}`, failed: 0 } };
  }
}
