/**
 * GET   /api/admin/users/[id]
 * PATCH /api/admin/users/[id]  — editar nombre, email, rol, sucursal, employeeId, active
 *
 * Solo ADMIN. No se permite borrar usuarios.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCan, can } from "@/lib/permissions";
import { z } from "zod";

// ADMIN solo puede editar usuarios con roles operativos.
// La edicion de OWNER y otros ADMIN esta reservada al panel /owner (solo OWNER).
const patchSchema = z.object({
  name:       z.string().min(2).optional(),
  email:      z.string().email().optional(),
  role:       z.enum(["SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"]).optional(),
  branchId:   z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
  active:     z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const permErr = requireCan(can.manageUsers, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true, createdAt: true, updatedAt: true,
      branchId: true,
      branch:    { select: { id: true, name: true } },
      employeeId: true,
      // Incluir datos básicos del empleado vinculado si existe
    },
  });

  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // Si tiene employeeId, traer datos del empleado
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  const permErr = requireCan(can.manageUsers, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // Guard: ADMIN no puede tocar usuarios OWNER ni otros ADMIN.
  // La gestion de esos usuarios esta reservada al panel /owner (solo OWNER).
  if (user.role === "OWNER" || user.role === "ADMIN") {
    return NextResponse.json(
      { error: "Solo el OWNER puede gestionar usuarios con rol Direccion o Administrador." },
      { status: 403 }
    );
  }

  // No permitir que el ADMIN se desactive a sí mismo
  if (params.id === session!.user.id && req.body) {
    const body = await req.json();
    if (body.active === false) {
      return NextResponse.json(
        { error: "No podes desactivar tu propio usuario" },
        { status: 400 }
      );
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
    }
    return await applyPatch(params.id, parsed.data, session!.user.id);
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  // BRANCH_MANAGER requiere sucursal
  const newRole = parsed.data.role ?? user.role;
  const newBranch = "branchId" in parsed.data ? parsed.data.branchId : user.branchId;
  if (newRole === "BRANCH_MANAGER" && !newBranch) {
    return NextResponse.json(
      { error: "El rol Encargada requiere una sucursal asignada" },
      { status: 400 }
    );
  }

  // Email único si cambia
  if (parsed.data.email && parsed.data.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }
  }

  return await applyPatch(params.id, parsed.data, session!.user.id);
}

async function applyPatch(userId: string, data: any, actorId: string) {
  const updates: any = {};
  if (data.name       !== undefined) updates.name       = data.name;
  if (data.email      !== undefined) updates.email      = data.email;
  if (data.role       !== undefined) updates.role       = data.role;
  // Normalizar strings vacíos a null para FK
  if (data.branchId   !== undefined) updates.branchId   = data.branchId   && data.branchId   !== "" ? data.branchId   : null;
  if (data.employeeId !== undefined) updates.employeeId = data.employeeId && data.employeeId !== "" ? data.employeeId : null;
  if (data.active     !== undefined) updates.active     = data.active;

  const updated = await prisma.user.update({
    where: { id: userId },
    data:  updates,
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true,
      branch: { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   actorId,
      action:   "UPDATE",
      entity:   "User",
      entityId: userId,
      detail:   { changes: updates },
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}

