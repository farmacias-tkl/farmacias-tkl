/**
 * GET  /api/owner/users  — lista de usuarios con filtros (sin restriccion de rol).
 * POST /api/owner/users  — crear usuario de cualquier rol (incluido OWNER y ADMIN).
 *
 * Solo OWNER. Cuando se crea un OWNER, se loguea SecurityEvent con
 * detail.isOwner: true para distinguirlo en queries.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { generatePassword } from "@/lib/passwords";
import { z } from "zod";
import bcrypt from "bcryptjs";

const createSchema = z.object({
  name:       z.string().min(2, "Nombre obligatorio"),
  email:      z.string().email("Email invalido"),
  role:       z.enum(["OWNER","ADMIN","SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"]),
  branchId:   z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
  // Si role === OWNER, executiveAccess se setea true automaticamente (canViewExecutive lo cubre).
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessOwnerPanel(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const sp       = req.nextUrl.searchParams;
  const role     = sp.get("role");
  const branchId = sp.get("branchId");
  const active   = sp.get("active");
  const search   = sp.get("search");
  const page     = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit    = Math.min(100, parseInt(sp.get("limit") ?? "30"));

  const where: any = {};
  if (role)     where.role     = role;
  if (branchId) where.branchId = branchId;
  if (active === "true")  where.active = true;
  if (active === "false") where.active = false;
  if (search) {
    where.OR = [
      { name:  { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, active: true,
        mustChangePassword: true, executiveAccess: true, createdAt: true,
        branchId: true,
        branch:     { select: { id: true, name: true } },
        employeeId: true,
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({
    data: users,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessOwnerPanel(session.user)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.role === "BRANCH_MANAGER" && !data.branchId) {
    return NextResponse.json({ error: "El rol Encargada requiere una sucursal asignada" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
  }

  const plainPassword = generatePassword();
  const passwordHash  = await bcrypt.hash(plainPassword, 12);

  const branchId   = data.branchId   && data.branchId   !== "" ? data.branchId   : null;
  const employeeId = data.employeeId && data.employeeId !== "" ? data.employeeId : null;
  const isOwner    = data.role === "OWNER";

  const user = await prisma.user.create({
    data: {
      name:               data.name,
      email:              data.email,
      role:               data.role,
      passwordHash,
      branchId,
      employeeId,
      active:             true,
      mustChangePassword: true,
      // OWNER tiene acceso ejecutivo siempre (canViewExecutive); set explicito para
      // consistencia con el resto del sistema que lee este flag.
      executiveAccess:    isOwner,
    },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true, executiveAccess: true,
      branch: { select: { id: true, name: true } },
    },
  });

  // AuditLog (operativo)
  await prisma.auditLog.create({
    data: {
      userId:   session.user.id,
      action:   "CREATE",
      entity:   "User",
      entityId: user.id,
      detail:   { name: data.name, email: data.email, role: data.role, isOwner },
    },
  }).catch(() => {});

  // SecurityEvent (sensible, panel OWNER)
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  await prisma.securityEvent.create({
    data: {
      userId:    user.id,
      actorId:   session.user.id,
      type:      "USER_CREATED",
      detail:    { email: user.email, role: user.role, isOwner },
      ip:        ip ?? null,
      userAgent: ua ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ data: user, initialPassword: plainPassword }, { status: 201 });
}
