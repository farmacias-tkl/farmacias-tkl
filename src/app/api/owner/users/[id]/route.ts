/**
 * GET   /api/owner/users/[id]  — detalle
 * PATCH /api/owner/users/[id]  — editar (incluye rol y active)
 *
 * Solo OWNER. Guards:
 *  - No podes modificar tu propio rol.
 *  - No podes desactivar tu propio usuario.
 *  - Debe quedar al menos 1 OWNER activo en el sistema.
 *
 * SecurityEvent emitido cuando cambia rol (USER_ROLE_CHANGED) o active
 * (USER_ACTIVATED / USER_DEACTIVATED).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { z } from "zod";

const patchSchema = z.object({
  name:       z.string().min(2).optional(),
  email:      z.string().email().optional(),
  role:       z.enum(["OWNER","ADMIN","SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"]).optional(),
  branchId:   z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
  active:     z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessOwnerPanel(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true, executiveAccess: true, createdAt: true, updatedAt: true,
      branchId: true,
      branch:     { select: { id: true, name: true } },
      employeeId: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  let employee = null;
  if (user.employeeId) {
    employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: {
        id: true, firstName: true, lastName: true,
        position: { select: { name: true } },
        currentBranch: { select: { name: true } },
      },
    });
  }

  return NextResponse.json({ data: { ...user, employee } });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessOwnerPanel(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const isSelf = params.id === session.user.id;

  // Guard self-modification (rol)
  if (isSelf && data.role !== undefined && data.role !== user.role) {
    return NextResponse.json(
      { error: "No podes modificar tu propio rol." },
      { status: 400 },
    );
  }
  // Guard self-modification (active)
  if (isSelf && data.active === false) {
    return NextResponse.json(
      { error: "No podes desactivar tu propio usuario." },
      { status: 400 },
    );
  }

  // Guard mantener al menos 1 OWNER activo
  const removingOwnerStatus = user.role === "OWNER" && (
    (data.role !== undefined && data.role !== "OWNER") ||
    (data.active === false)
  );
  if (removingOwnerStatus) {
    const remainingActiveOwners = await prisma.user.count({
      where: { role: "OWNER", active: true, id: { not: params.id } },
    });
    if (remainingActiveOwners === 0) {
      return NextResponse.json(
        { error: "Debe quedar al menos 1 usuario OWNER activo en el sistema." },
        { status: 400 },
      );
    }
  }

  // BRANCH_MANAGER requiere sucursal
  const newRole   = data.role ?? user.role;
  const newBranch = "branchId" in data ? data.branchId : user.branchId;
  if (newRole === "BRANCH_MANAGER" && !newBranch) {
    return NextResponse.json({ error: "El rol Encargada requiere una sucursal asignada" }, { status: 400 });
  }

  // Email unico si cambia
  if (data.email && data.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }
  }

  const updates: any = {};
  if (data.name       !== undefined) updates.name       = data.name;
  if (data.email      !== undefined) updates.email      = data.email;
  if (data.role       !== undefined) updates.role       = data.role;
  if (data.branchId   !== undefined) updates.branchId   = data.branchId   && data.branchId   !== "" ? data.branchId   : null;
  if (data.employeeId !== undefined) updates.employeeId = data.employeeId && data.employeeId !== "" ? data.employeeId : null;
  if (data.active     !== undefined) updates.active     = data.active;

  // Si pasa a OWNER, asegurar executiveAccess=true por consistencia.
  if (data.role === "OWNER" && user.role !== "OWNER") {
    updates.executiveAccess = true;
  }

  const updated = await prisma.user.update({
    where: { id: params.id },
    data:  updates,
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true, executiveAccess: true,
      branch: { select: { id: true, name: true } },
    },
  });

  // AuditLog (siempre)
  await prisma.auditLog.create({
    data: {
      userId:   session.user.id,
      action:   "UPDATE",
      entity:   "User",
      entityId: params.id,
      detail:   { changes: updates },
    },
  }).catch(() => {});

  // SecurityEvent (solo cambios sensibles: rol o active)
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  if (data.role !== undefined && data.role !== user.role) {
    await prisma.securityEvent.create({
      data: {
        userId:    updated.id,
        actorId:   session.user.id,
        type:      "USER_ROLE_CHANGED",
        detail:    { email: updated.email, oldRole: user.role, newRole: updated.role, isOwner: updated.role === "OWNER" },
        ip:        ip ?? null,
        userAgent: ua ?? null,
      },
    }).catch(() => {});
  }
  if (data.active !== undefined && data.active !== user.active) {
    await prisma.securityEvent.create({
      data: {
        userId:    updated.id,
        actorId:   session.user.id,
        type:      data.active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        detail:    { email: updated.email, role: updated.role, isOwner: updated.role === "OWNER" },
        ip:        ip ?? null,
        userAgent: ua ?? null,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ data: updated });
}
