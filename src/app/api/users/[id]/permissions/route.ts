/**
 * GET  /api/users/[id]/permissions  — lista de permisos por-usuario del target.
 * POST /api/users/[id]/permissions  — grant/upsert (body: { permissionKey, scope }).
 *
 * Handlers FINOS (Fase 2C-B): auth() → cargar actor desde DB → parse → delegar al
 * servicio user-permissions-admin (2C-A). NO duplican la lógica de permisos: toda
 * la autorización fina, la Regla 1 (OWN_BRANCH exige branchId) y el AuditLog en
 * $transaction viven en el servicio.
 *
 * Árbol NEUTRAL /api/users/* (no owner/ ni admin/), porque el middleware gatea
 * /api/owner a OWNER-only y /api/admin a ADMIN-only; este árbol sirve a ambos y la
 * distinción OWNER-vs-ADMIN-vs-target la hacen los helpers del servicio.
 * Defensa-en-profundidad: ROUTE_PERMISSIONS["/api/users"] = ["OWNER","ADMIN"].
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  listUserPermissionsForTarget,
  grantUserPermissionToTarget,
  type UserPermissionAdminClient,
} from "@/lib/permissions/user-permissions-admin";
import type { MinimalUser } from "@/lib/permissions/user-permissions";
import { z } from "zod";

// El PrismaClient real cumple la interfaz mínima del servicio en runtime, pero su
// tipado genérico no es estructuralmente asignable: se acota en el borde del handler.
const adminClient = prisma as unknown as UserPermissionAdminClient;

const postSchema = z.object({
  permissionKey: z.string().min(1, "permissionKey obligatorio"),
  scope: z.enum(["OWN_BRANCH", "ALL_BRANCHES"]),
});

/** Carga el actor desde DB (no confiar solo en el JWT para `active`). */
async function loadActor(): Promise<MinimalUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, active: true },
  });
}

function clientMeta(req: NextRequest): { ip: string | null; userAgent: string | null } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  return { ip, userAgent };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await loadActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const result = await listUserPermissionsForTarget({
    actor,
    targetUserId: params.id,
    client: adminClient,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await loadActor();
  if (!actor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const { ip, userAgent } = clientMeta(req);
  const result = await grantUserPermissionToTarget({
    actor,
    targetUserId: params.id,
    permissionKey: parsed.data.permissionKey,
    scope: parsed.data.scope,
    client: adminClient,
    ip,
    userAgent,
  });
  return NextResponse.json(result.body, { status: result.status });
}
