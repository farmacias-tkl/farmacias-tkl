/**
 * Motor de DEFAULTS por rol (refactor permisos-por-usuario, Fase 2F-C1-D).
 *
 * Aplica los defaults de `getDefaultPermissionsForRole(role)` a un usuario, otorgando
 * cada uno vía `grantUserPermissionToTarget` (única vía de escritura: NO usa Prisma
 * directo, respeta todas las reglas de negocio del servicio, incluidas las de 2C-C y la
 * validación DEFAULT_BACKFILL⇒batchId).
 *
 * Fuente ÚNICA de la matriz de defaults: role-defaults.ts. El motor NO hardcodea permisos
 * ni lógica especial por rol; solo itera lo que ese módulo devuelve.
 *
 * Usos previstos (fases posteriores, NO en C1-D):
 *  - Backfill de usuarios existentes → source = "DEFAULT_BACKFILL" + batchId (corrida).
 *  - Defaults a usuarios nuevos       → source = "DEFAULT_NEW_USER"  (batchId opcional).
 *
 * El motor aplica DEFAULTS, no grants manuales: `source` = "MANUAL" es inválido acá
 * (guard en runtime, no solo tipo TS). Los grants manuales siguen por el endpoint/servicio.
 */
import type { UserPermissionSource, UserRole } from "@prisma/client";
import { getDefaultPermissionsForRole } from "./role-defaults";
import {
  grantUserPermissionToTarget,
  type GrantArgs,
} from "./user-permissions-admin";

/** Sólo estos dos orígenes valen para el motor de defaults. MANUAL queda excluido. */
export type DefaultPermissionSource = Extract<
  UserPermissionSource,
  "DEFAULT_BACKFILL" | "DEFAULT_NEW_USER"
>;

export interface ApplyDefaultPermissionsForUserArgs {
  actor: GrantArgs["actor"];
  targetUserId: string;
  role: UserRole;
  client: GrantArgs["client"];
  source: DefaultPermissionSource;
  batchId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Inyección para tests / control (por defecto el servicio real). */
  grantFn?: typeof grantUserPermissionToTarget;
}

export interface AppliedDefaultPermissionResult {
  permissionKey: string;
  scope: string;
  status: number;
  change?: string;
  error?: string;
}

export interface ApplyDefaultPermissionsForUserResult {
  ok: boolean;
  targetUserId: string;
  role: UserRole;
  source: DefaultPermissionSource;
  batchId: string | null;
  totalDefaults: number;
  attempted: number;
  granted: number;
  noop: number;
  scopeChanged: number;
  failed: number;
  results: AppliedDefaultPermissionResult[];
  error?: string;
}

const VALID_ENGINE_SOURCES = ["DEFAULT_BACKFILL", "DEFAULT_NEW_USER"] as const;
function isEngineSource(s: string): s is DefaultPermissionSource {
  return (VALID_ENGINE_SOURCES as readonly string[]).includes(s);
}

export async function applyDefaultPermissionsForUser(
  args: ApplyDefaultPermissionsForUserArgs,
): Promise<ApplyDefaultPermissionsForUserResult> {
  const { actor, targetUserId, role, client, source, ip, userAgent } = args;
  const grantFn = args.grantFn ?? grantUserPermissionToTarget;
  const batchId = args.batchId?.trim() ? args.batchId.trim() : null;

  const base: Omit<ApplyDefaultPermissionsForUserResult, "ok" | "error"> = {
    targetUserId,
    role,
    source: source as DefaultPermissionSource,
    batchId,
    totalDefaults: 0,
    attempted: 0,
    granted: 0,
    noop: 0,
    scopeChanged: 0,
    failed: 0,
    results: [],
  };

  // Guard RUNTIME: el motor aplica defaults; MANUAL u otro source no válido no debe usarse
  // aunque llegue por cast/any/JS. No se llama al servicio (attempted queda en 0).
  if (!isEngineSource(source)) {
    return { ...base, ok: false, error: `source invalido para defaults: ${String(source)}` };
  }

  // DEFAULT_BACKFILL exige batchId (corrida). Error de validación del motor → attempted 0.
  if (source === "DEFAULT_BACKFILL" && !batchId) {
    return { ...base, ok: false, error: "batchId requerido para DEFAULT_BACKFILL" };
  }

  const defaults = getDefaultPermissionsForRole(role);
  base.totalDefaults = defaults.length;

  // Rol sin defaults → ok, nada que aplicar.
  if (defaults.length === 0) {
    return { ...base, ok: true };
  }

  for (const def of defaults) {
    // Un fallo individual NO aborta: se sigue para producir reporte completo.
    const res = await grantFn({
      actor,
      targetUserId,
      permissionKey: def.key,
      scope: def.scope,
      client,
      source,
      batchId,
      ip,
      userAgent,
    });
    base.attempted += 1;

    const body = res.body as { change?: string; error?: string } | undefined;
    if (res.status === 200) {
      const change = body?.change;
      if (change === "GRANTED") base.granted += 1;
      else if (change === "NOOP") base.noop += 1;
      else if (change === "SCOPE_CHANGED") base.scopeChanged += 1;
      base.results.push({ permissionKey: def.key, scope: def.scope, status: res.status, change });
    } else {
      base.failed += 1;
      base.results.push({ permissionKey: def.key, scope: def.scope, status: res.status, error: body?.error });
    }
  }

  return { ...base, ok: base.failed === 0 };
}
