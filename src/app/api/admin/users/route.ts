/**
 * GET  /api/admin/users  — lista de usuarios con filtros
 * POST /api/admin/users  — crear usuario
 *
 * Solo ADMIN.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCan, can } from "@/lib/permissions";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Genera contraseña segura aleatoria
function generatePassword(): string {
  const upper  = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower  = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special= "!@#$";
  const all    = upper + lower + digits + special;

  // Garantizar al menos uno de cada tipo
  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    special[crypto.randomInt(special.length)],
  ];

  // Completar hasta 12 caracteres
  const rest = Array.from({ length: 8 }, () => all[crypto.randomInt(all.length)]);
  const chars = [...required, ...rest];

  // Mezclar
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const ROLES_WITH_BRANCH = ["BRANCH_MANAGER"];

const createSchema = z.object({
  name:       z.string().min(2, "Nombre obligatorio"),
  email:      z.string().email("Email invalido"),
  role:       z.enum(["ADMIN","OWNER","SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"]),
  branchId:   z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.manageUsers, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

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
        mustChangePassword: true, createdAt: true,
        branchId: true,
        branch:    { select: { id: true, name: true } },
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
  const permErr = requireCan(can.manageUsers, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // BRANCH_MANAGER requiere sucursal
  if (data.role === "BRANCH_MANAGER" && !data.branchId) {
    return NextResponse.json(
      { error: "El rol Encargada requiere una sucursal asignada" },
      { status: 400 }
    );
  }

  // Email único
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe un usuario con ese email" },
      { status: 409 }
    );
  }

  // Generar contraseña
  const plainPassword = generatePassword();
  const passwordHash  = await bcrypt.hash(plainPassword, 12);

  // Normalizar strings vacíos a null para FK
  const branchId   = data.branchId   && data.branchId   !== "" ? data.branchId   : null;
  const employeeId = data.employeeId && data.employeeId !== "" ? data.employeeId : null;

  const user = await prisma.user.create({
    data: {
      name:              data.name,
      email:             data.email,
      role:              data.role,
      passwordHash,
      branchId,
      employeeId,
      active:            true,
      mustChangePassword:true,
    },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      mustChangePassword: true,
      branch: { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "User",
      entityId: user.id,
      detail:   { name: data.name, email: data.email, role: data.role },
    },
  }).catch(() => {});

  // Devolver contraseña en claro UNA SOLA VEZ
  return NextResponse.json({
    data: user,
    initialPassword: plainPassword,
  }, { status: 201 });
}

