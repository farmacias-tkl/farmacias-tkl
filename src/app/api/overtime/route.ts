/**
 * GET  /api/overtime  — filtros por rol aplicados en backend
 * POST /api/overtime  — un registro por empleado por día
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  employeeId: z.string().min(1),
  branchId:   z.string().min(1),
  date:       z.string().transform(d => {
    const dt = new Date(d);
    dt.setHours(0,0,0,0);
    return dt;
  }),
  hours:  z.number().min(0.5).max(24),
  reason: z.enum(["ABSENCE_COVERAGE","VACATION_COVERAGE","UNDERSTAFFING","HIGH_DEMAND","OTHER"]),
  notes:  z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp         = req.nextUrl.searchParams;
  const branchId   = sp.get("branchId");
  const employeeId = sp.get("employeeId");
  const status     = sp.get("status");
  const from       = sp.get("from");
  const to         = sp.get("to");
  const page       = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit      = Math.min(100, parseInt(sp.get("limit") ?? "30"));

  const where: any = {};

  // BRANCH_MANAGER: forzar su sucursal en backend, ignorar cualquier branchId de la query
  if (session!.user.role === "BRANCH_MANAGER") {
    if (!session!.user.branchId) {
      return NextResponse.json({ data: [], meta: { total: 0, page, limit, pages: 0 } });
    }
    where.branchId = session!.user.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;
  if (from || to) {
    where.date = {
      ...(from && { gte: new Date(from) }),
      ...(to   && { lte: new Date(to)   }),
    };
  }

  const [records, total] = await Promise.all([
    prisma.overtimeRecord.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true,
          position: { select: { name: true } } } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.overtimeRecord.count({ where }),
  ]);

  return NextResponse.json({
    data: records,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  if (!can.createOvertime(session!.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // BRANCH_MANAGER solo puede cargar en su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    data.branchId !== session!.user.branchId
  ) {
    return NextResponse.json(
      { error: "Solo podes cargar horas extras en tu sucursal" },
      { status: 403 }
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    select: { id: true, firstName: true, lastName: true, currentBranchId: true },
  });
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  // Verificar que el empleado pertenece a la sucursal indicada
  if (employee.currentBranchId && employee.currentBranchId !== data.branchId) {
    return NextResponse.json(
      { error: "El empleado no pertenece a la sucursal indicada" },
      { status: 400 }
    );
  }

  // Verificar unicidad: un registro por empleado por día
  const existing = await prisma.overtimeRecord.findUnique({
    where: { employeeId_date: { employeeId: data.employeeId, date: data.date } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe un registro de horas extras para ${employee.firstName} ${employee.lastName} en esa fecha.` },
      { status: 409 }
    );
  }

  const record = await prisma.overtimeRecord.create({
    data: { ...data, reportedByUserId: session!.user.id, status: "REPORTED" },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
      branch:   { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "OvertimeRecord",
      entityId: record.id,
      detail:   { employee: `${employee.firstName} ${employee.lastName}`, hours: data.hours, date: data.date },
    },
  }).catch(() => {});

  return NextResponse.json({ data: record }, { status: 201 });
}
