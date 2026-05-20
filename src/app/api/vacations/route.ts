/**
 * GET  /api/vacations — listado con filtros
 * POST /api/vacations — crear solicitud (valida reglas, rechaza si BLOCKING)
 *
 * BRANCH_MANAGER: forzado a su sucursal en backend.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { validateVacationRequest } from "@/lib/vacations/validation";
import { Prisma } from "@prisma/client";

const createSchema = z.object({
  employeeId:    z.string().min(1),
  startDate:     z.string().transform(d => new Date(d)),
  endDate:       z.string().transform(d => new Date(d)),
  requesterNote: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp = req.nextUrl.searchParams;
  const branchId    = sp.get("branchId");
  const employeeId  = sp.get("employeeId");
  const status      = sp.get("status");
  const month       = sp.get("month"); // YYYY-MM
  const pendingOnly = sp.get("pendingOnly") === "true";
  const page        = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit       = Math.min(100, parseInt(sp.get("limit") ?? "50"));

  const where: Prisma.VacationRequestWhereInput = {};

  // BRANCH_MANAGER no ve otras sucursales
  if (session!.user.role === "BRANCH_MANAGER") {
    if (!session!.user.branchId) {
      return NextResponse.json({ data: [], meta: { total: 0, page, limit, pages: 0 } });
    }
    where.branchId = session!.user.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (employeeId) where.employeeId = employeeId;
  if (status)     where.status     = status as Prisma.VacationRequestWhereInput["status"];

  if (pendingOnly) {
    where.status = { in: ["PENDING_SUPERVISOR", "PENDING_RRHH"] };
  }

  if (month) {
    const [y, m] = month.split("-").map(Number);
    if (y && m) {
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59));
      // Toca el mes si su rango intersecta con [monthStart, monthEnd]
      where.startDate = { lte: monthEnd };
      where.endDate   = { gte: monthStart };
    }
  }

  const [data, total] = await Promise.all([
    prisma.vacationRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, isRotating: true } },
        branch:   { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
        requestedBy:        { select: { id: true, name: true } },
        supervisorActionBy: { select: { id: true, name: true } },
        rrhhActionBy:       { select: { id: true, name: true } },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.vacationRequest.count({ where }),
  ]);

  return NextResponse.json({
    data,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.createVacation, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    include: { position: true, currentBranch: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }
  if (!employee.positionId || !employee.position) {
    return NextResponse.json({ error: "El empleado no tiene puesto configurado" }, { status: 400 });
  }
  if (!employee.currentBranchId || !employee.currentBranch) {
    return NextResponse.json({ error: "El empleado no tiene sucursal asignada" }, { status: 400 });
  }

  // BRANCH_MANAGER solo puede solicitar para empleados de su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    employee.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json(
      { error: "Solo podés solicitar vacaciones para empleados de tu sucursal" },
      { status: 403 },
    );
  }

  // Validar reglas
  const validation = await validateVacationRequest({
    employeeId: data.employeeId,
    startDate:  data.startDate,
    endDate:    data.endDate,
  });
  if (!validation.isValid) {
    return NextResponse.json(
      {
        error: "La solicitud tiene conflictos bloqueantes",
        validation,
      },
      { status: 409 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.vacationRequest.create({
      data: {
        employeeId: data.employeeId,
        branchId:   employee.currentBranchId!,
        positionId: employee.positionId,
        employeeNameSnapshot: `${employee.firstName} ${employee.lastName}`,
        branchNameSnapshot:   employee.currentBranch!.name,
        positionNameSnapshot: employee.position!.name,
        shiftLabel: null,
        startDate:  data.startDate,
        endDate:    data.endDate,
        daysCount:  validation.calculatedDays,
        status:     "PENDING_SUPERVISOR",
        requestedByUserId: session!.user.id,
        requesterNote: data.requesterNote ?? null,
        conflictLevel:   validation.conflictLevel,
        conflictReasons: (validation.warnings.length
          ? { warnings: validation.warnings, ruleResults: validation.ruleResults }
          : { ruleResults: validation.ruleResults }) as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "VACATION_REQUEST_CREATED",
        entity:   "VacationRequest",
        entityId: request.id,
        detail: {
          employee:   `${employee.firstName} ${employee.lastName}`,
          branch:     employee.currentBranch!.name,
          position:   employee.position!.name,
          startDate:  data.startDate.toISOString().slice(0, 10),
          endDate:    data.endDate.toISOString().slice(0, 10),
          days:       validation.calculatedDays,
          conflictLevel: validation.conflictLevel,
        },
      },
    });

    return request;
  });

  return NextResponse.json({ data: created, validation }, { status: 201 });
}
