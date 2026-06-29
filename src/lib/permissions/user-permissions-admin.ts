/**
 * Servicio ADMINISTRATIVO de UserPermission (refactor permisos-por-usuario, Fase 2C-A).
 *
 * Lógica testeable de list/grant/revoke de permisos por usuario, SIN NextRequest/
 * NextResponse, SIN auth() y SIN DB real: recibe el `actor` ya cargado y un `client`
 * prisma-like inyectado, y devuelve { status, body }. Los Route Handlers (2C-B) son
 * finos: auth() → parse → cargar actor → llamar a este servicio → mapear a NextResponse.
 *
 * Decisiones cerradas (2C-prep):
 *  - Auditoría con AuditLog (no SecurityEvent). Writes + AuditLog dentro de $transaction.
 *  - Helpers finos de 1B para autorización (canManage/canGrant/canRevoke + isCritical).
 *  - Regla 1: un grant OWN_BRANCH exige target.branchId poblado, o 400 sin escribir.
 *  - No se usa PositionPermission.
 */
import type { UserRole, PermissionScope } from "@prisma/client";
import {
  canManageUserPermissions,
  canGrantUserPermission,
  canRevokeUserPermission,
  type MinimalUser,
} from "./user-permissions";

// 2C-C — política sobre usuarios INACTIVOS (target inactivo):
//  - list   : permitido si el actor tiene AUTORIDAD (canManageUserPermissions).
//  - revoke : permitido si el actor tiene autoridad, incluso permisos críticos
//             (de-escalada). NO exige target activo.
//  - grant / scope-change : SIEMPRE bloqueado sobre target inactivo (400), pero la
//             AUTORIDAD se evalúa ANTES: actor sin autoridad → 403 antes que el 400.
//  - actor sin autoridad : 403 antes de cualquier 400 por inactividad.
//  - actor inactivo : bloqueado siempre (checkActor → 403).
// Por eso grant separa canManageUserPermissions (autoridad pura → 403) del gate de
// actividad (target.active === false → 400) y de canGrantUserPermission (críticos → 403).

// ============================================================================
// Resultado uniforme (sin NextResponse).
// ============================================================================
export type UserPermissionAdminResult =
  | { status: 200; body: unknown }
  | { status: 400; body: { error: string } }
  | { status: 401; body: { error: string } }
  | { status: 403; body: { error: string } }
  | { status: 404; body: { error: string } };

// ============================================================================
// Cliente prisma-like mínimo. Lecturas a nivel top; ESCRITURAS solo dentro de
// $transaction (por diseño: el write del permiso y su AuditLog son atómicos).
// ============================================================================
interface TargetUserRow {
  id: string;
  role: UserRole;
  active: boolean;
  branchId: string | null;
}
interface PermissionRow {
  id: string;
  key: string;
  module: string;
  description: string;
  active: boolean;
}
interface UserPermissionListRow {
  permissionId: string;
  scope: PermissionScope;
  grantedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  permission: { key: string; module: string; description: string; active: boolean };
}

export interface UserPermissionAdminTxClient {
  userPermission: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id: string }>;
    delete(args: unknown): Promise<unknown>;
  };
  auditLog: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface UserPermissionAdminClient {
  user: {
    findUnique(args: unknown): Promise<TargetUserRow | null>;
  };
  permission: {
    findUnique(args: unknown): Promise<PermissionRow | null>;
  };
  userPermission: {
    findMany(args: unknown): Promise<UserPermissionListRow[]>;
    findUnique(args: unknown): Promise<{ id: string; scope: PermissionScope; permission: { key: string } } | null>;
  };
  $transaction<T>(fn: (tx: UserPermissionAdminTxClient) => Promise<T>): Promise<T>;
}

// ============================================================================
// Args
// ============================================================================
interface BaseArgs {
  actor: MinimalUser | null | undefined;
  targetUserId: string;
  client: UserPermissionAdminClient;
  ip?: string | null;
  userAgent?: string | null;
}
export interface ListArgs {
  actor: MinimalUser | null | undefined;
  targetUserId: string;
  client: UserPermissionAdminClient;
}
export interface GrantArgs extends BaseArgs {
  permissionKey: string;
  scope: string; // se valida a PermissionScope
}
export interface RevokeArgs extends BaseArgs {
  permissionId: string;
}

const VALID_SCOPES = ["OWN_BRANCH", "ALL_BRANCHES"] as const;
function isValidScope(s: string): s is PermissionScope {
  return (VALID_SCOPES as readonly string[]).includes(s);
}

const r400 = (error: string): UserPermissionAdminResult => ({ status: 400, body: { error } });
const r401 = (error: string): UserPermissionAdminResult => ({ status: 401, body: { error } });
const r403 = (error: string): UserPermissionAdminResult => ({ status: 403, body: { error } });
const r404 = (error: string): UserPermissionAdminResult => ({ status: 404, body: { error } });

// Actor: null → 401; inactivo → 403 (consistente con requireUserPermission, que trata
// "autenticado pero inactivo" como 403, no 401).
function checkActor(actor: MinimalUser | null | undefined): UserPermissionAdminResult | null {
  if (!actor) return r401("No autenticado");
  if (actor.active === false) return r403("Sin permisos para esta accion");
  return null;
}

async function loadTarget(
  client: UserPermissionAdminClient,
  targetUserId: string,
): Promise<TargetUserRow | null> {
  return client.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, active: true, branchId: true },
  });
}

// ============================================================================
// LIST
// ============================================================================
export async function listUserPermissionsForTarget(args: ListArgs): Promise<UserPermissionAdminResult> {
  const { actor, targetUserId, client } = args;
  const actorErr = checkActor(actor);
  if (actorErr) return actorErr;

  const target = await loadTarget(client, targetUserId);
  if (!target) return r404("Usuario no encontrado");

  if (!canManageUserPermissions(actor as MinimalUser, target)) {
    return r403("Sin permisos para esta accion");
  }

  const rows = await client.userPermission.findMany({
    where: { userId: targetUserId },
    include: { permission: { select: { key: true, module: true, description: true, active: true } } },
    orderBy: [{ permission: { module: "asc" } }, { permission: { key: "asc" } }],
  });

  return {
    status: 200,
    body: {
      data: rows.map((r) => ({
        permissionId: r.permissionId,
        key: r.permission.key,
        module: r.permission.module,
        description: r.permission.description,
        permissionActive: r.permission.active, // NO se filtra; se reporta
        scope: r.scope,
        grantedByUserId: r.grantedByUserId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    },
  };
}

// ============================================================================
// GRANT
// ============================================================================
export async function grantUserPermissionToTarget(args: GrantArgs): Promise<UserPermissionAdminResult> {
  const { actor, targetUserId, permissionKey, scope, client, ip, userAgent } = args;

  const actorErr = checkActor(actor);
  if (actorErr) return actorErr;

  const target = await loadTarget(client, targetUserId);
  if (!target) return r404("Usuario no encontrado");

  // 2C-C — AUTORIDAD PURA primero: actor sin autoridad → 403 ANTES de cualquier 400
  // por inactividad. canManageUserPermissions NO mira target.active, así que el 403
  // significa exclusivamente "sin autoridad de gobierno", no "target inactivo".
  if (!canManageUserPermissions(actor as MinimalUser, target)) {
    return r403("Sin permisos para esta accion");
  }
  // 2C-C — GATE DE ACTIVIDAD: grant/scope-change SIEMPRE bloqueado sobre inactivo (400),
  // pero solo se llega acá si el actor TENÍA autoridad.
  if (target.active === false) return r400("Usuario inactivo");

  const permission = await client.permission.findUnique({
    where: { key: permissionKey },
    select: { id: true, key: true, module: true, description: true, active: true },
  });
  if (!permission) return r404("Permiso no encontrado");
  if (!permission.active) return r400("Permiso inactivo");

  if (!isValidScope(scope)) return r400("Scope invalido");

  // REGLA 1 — backend, antes de canGrant: OWN_BRANCH exige target.branchId poblado.
  if (scope === "OWN_BRANCH" && target.branchId == null) {
    return r400("Un permiso OWN_BRANCH requiere que el usuario tenga sucursal asignada");
  }

  // 2C-C — RESTRICCIÓN FINA DE GRANT (críticos / ADMIN-self). La autoridad y la
  // actividad ya se resolvieron arriba; acá solo aplica la regla de críticos.
  if (!canGrantUserPermission(actor as MinimalUser, target, permission.key)) {
    return r403("Sin permisos para esta accion");
  }

  // find existing (read, fuera de transaction) → decide create / NOOP / scope-change.
  const existing = await client.userPermission.findUnique({
    where: { userId_permissionId: { userId: targetUserId, permissionId: permission.id } },
    select: { id: true, scope: true, permission: { select: { key: true } } },
  });

  // NOOP: mismo scope → sin transaction, sin write, sin AuditLog.
  if (existing && existing.scope === scope) {
    return {
      status: 200,
      body: {
        change: "NOOP",
        data: { id: existing.id, userId: targetUserId, permissionId: permission.id, key: permission.key, scope },
      },
    };
  }

  const auditMeta = buildAuditMeta(ip, userAgent);

  if (!existing) {
    // CREATE + AuditLog GRANTED, atómico.
    const created = await client.$transaction(async (tx) => {
      const up = await tx.userPermission.create({
        data: {
          userId: targetUserId,
          permissionId: permission.id,
          scope,
          grantedByUserId: (actor as MinimalUser).id,
        },
        select: { id: true },
      });
      // 2C usa AuditLog para mantener el refactor mock-first y sin cambios de schema.
      // SecurityEvent sería consistente con otros grants del repo, pero requiere ampliar
      // SecurityEventType; si se decide consolidar ese rastro, será una migración/fase futura.
      await tx.auditLog.create({
        data: {
          userId: (actor as MinimalUser).id,
          action: "USER_PERMISSION_GRANTED",
          entity: "UserPermission",
          entityId: up.id,
          detail: {
            targetUserId,
            permissionKey: permission.key,
            scope,
            actorRole: (actor as MinimalUser).role,
          },
          ...auditMeta,
        },
      });
      return up;
    });
    return {
      status: 200,
      body: {
        change: "GRANTED",
        data: { id: created.id, userId: targetUserId, permissionId: permission.id, key: permission.key, scope },
      },
    };
  }

  // existing con scope distinto → UPDATE + AuditLog SCOPE_CHANGED, atómico.
  const oldScope = existing.scope;
  const updated = await client.$transaction(async (tx) => {
    const up = await tx.userPermission.update({
      where: { userId_permissionId: { userId: targetUserId, permissionId: permission.id } },
      data: { scope, grantedByUserId: (actor as MinimalUser).id },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: (actor as MinimalUser).id,
        action: "USER_PERMISSION_SCOPE_CHANGED",
        entity: "UserPermission",
        entityId: up.id,
        detail: {
          targetUserId,
          permissionKey: permission.key,
          oldScope,
          newScope: scope,
          actorRole: (actor as MinimalUser).role,
        },
        ...auditMeta,
      },
    });
    return up;
  });
  return {
    status: 200,
    body: {
      change: "SCOPE_CHANGED",
      data: { id: updated.id, userId: targetUserId, permissionId: permission.id, key: permission.key, scope },
    },
  };
}

// ============================================================================
// REVOKE
// ============================================================================
export async function revokeUserPermissionFromTarget(args: RevokeArgs): Promise<UserPermissionAdminResult> {
  const { actor, targetUserId, permissionId, client, ip, userAgent } = args;

  const actorErr = checkActor(actor);
  if (actorErr) return actorErr;

  const target = await loadTarget(client, targetUserId);
  if (!target) return r404("Usuario no encontrado");

  // 2C-C — AUTORIDAD primero (403), ANTES de leer el grant, para no filtrar existencia.
  // canRevokeUserPermission IGNORA el permissionKey (delega en canManageUserPermissions),
  // así que el argumento es irrelevante. Revoke = de-escalada: NO exige target activo
  // (limpieza sobre inactivos OK) y NO aplica críticos. Por eso NO hay un 400 "Usuario
  // inactivo" en revoke; un target inactivo con actor autorizado revoca normalmente.
  if (!canRevokeUserPermission(actor as MinimalUser, target, "")) {
    return r403("Sin permisos para esta accion");
  }

  const existing = await client.userPermission.findUnique({
    where: { userId_permissionId: { userId: targetUserId, permissionId } },
    select: { id: true, scope: true, permission: { select: { key: true } } },
  });
  if (!existing) return r404("Asignacion no encontrada");

  const permissionKey = existing.permission.key;

  const auditMeta = buildAuditMeta(ip, userAgent);

  await client.$transaction(async (tx) => {
    await tx.userPermission.delete({
      where: { userId_permissionId: { userId: targetUserId, permissionId } },
    });
    await tx.auditLog.create({
      data: {
        userId: (actor as MinimalUser).id,
        action: "USER_PERMISSION_REVOKED",
        entity: "UserPermission",
        entityId: existing.id,
        detail: {
          targetUserId,
          permissionKey,
          scope: existing.scope,
          actorRole: (actor as MinimalUser).role,
        },
        ...auditMeta,
      },
    });
  });

  return { status: 200, body: { ok: true } };
}

// ip/userAgent solo si vienen.
function buildAuditMeta(ip?: string | null, userAgent?: string | null): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (ip != null) meta.ip = ip;
  if (userAgent != null) meta.userAgent = userAgent;
  return meta;
}
