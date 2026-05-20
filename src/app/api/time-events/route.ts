/**
 * GET  /api/time-events — listado con filtros
 * POST /api/time-events — crear (LATE_ARRIVAL o EARLY_DEPARTURE)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import {
  calculateMinutesOwed, initialStatus, validateTimes,
} from "@/lib/time-events/validation";
import type { Prisma } from "@prisma/client";

const TIME_EVENT_TYPES = ["LATE_ARRIVAL", "EARLY_DEPARTURE"] as const;

const createSchema = z.object({
  employeeId:   z.string().min(1),
  type:         z.enum(TIME_EVENT_TYPES),
  date:         z.string().transform(d => new Date(d)),
  expectedTime: z.string().transform(d => new Date(d)),
  actualTime:   z.string().transform(d => new Date(d)),
  reason:       z.string().optional().nullable(),
  reporterNote: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp = req.nextUrl.searchParams;
  const branchId    = sp.get("branchId");
  const employeeId  = sp.get("employeeId");
  const status      = sp.get("status");
  const type        = sp.get("type");
  const from        = sp.get("from");
  const to          = sp.get("to");
  const pendingOnly = sp.get("pendingOnly") === "true";
  const page        = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit       = Math.min(200, parseInt(sp.get("limit") ?? "50"));

  const where: Prisma.TimeEventWhereInput = {};

  if (session!.user.role === "BRANCH_MANAGER") {
    if (!session!.user.branchId) {
      return NextResponse.json({ data: [], meta: { total: 0, page, limit, pages: 0 } });
    }
    where.branchId = session!.user.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (employeeId) where.employeeId = employeeId;
  if (status)     where.status     = status as Prisma.TimeEventWhereInput["status"];
  if (type)       where.type       = type as Prisma.TimeEventWhereInput["type"];

  if (pendingOnly) {
    where.status = {
      in: ["PENDING_AUTHORIZATION", "PENDING_REVIEW", "APPROVED_FOR_COMPENSATION", "PARTIALLY_COMPENSATED"],
    };
  }

  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  const [data, total] = await Promise.all([
    prisma.timeEvent.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        branch:   { select: { id: true, name: true } },
        reportedBy:   { select: { id: true, name: true } },
        authorizedBy: { select: { id: true, name: true } },
        resolvedBy:   { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.timeEvent.count({ where }),
  ]);

  return NextResponse.json({
    data,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.createTimeEvent, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Validar tiempos
  const timesOk = validateTimes(data.type, data.expectedTime, data.actualTime);
  if (!timesOk.valid) {
    return NextResponse.json({ error: timesOk.error }, { status: 400 });
  }

  // EARLY_DEPARTURE requiere motivo
  if (data.type === "EARLY_DEPARTURE" && !data.reason?.trim()) {
    return NextResponse.json({ error: "El motivo es obligatorio para retiro anticipado" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    include: { position: true, currentBranch: true },
  });
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (!employee.positionId || !employee.position) {
    return NextResponse.json({ error: "El empleado no tiene puesto configurado" }, { status: 400 });
  }
  if (!employee.currentBranchId || !employee.currentBranch) {
    return NextResponse.json({ error: "El empleado no tiene sucursal asignada" }, { status: 400 });
  }

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    employee.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json(
      { error: "Solo podés registrar eventos para empleados de tu sucursal" },
      { status: 403 },
    );
  }

  const minutesOwed = calculateMinutesOwed(data.type, data.expectedTime, data.actualTime);
  const status      = initialStatus(data.type);

  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.timeEvent.create({
      data: {
        employeeId: data.employeeId,
        branchId:   employee.currentBranchId!,
        employeeNameSnapshot: `${employee.firstName} ${employee.lastName}`,
        branchNameSnapshot:   employee.currentBranch!.name,
        positionNameSnapshot: employee.position!.name,
        date:        data.date,
        type:        data.type,
        status,
        expectedTime: data.expectedTime,
        actualTime:   data.actualTime,
        minutesOwed,
        minutesCompensated: 0,
        minutesRemaining:   minutesOwed,
        reason:       data.reason ?? null,
        reporterNote: data.reporterNote ?? null,
        reportedByUserId: session!.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "TIME_EVENT_CREATED",
        entity:   "TimeEvent",
        entityId: ev.id,
        detail: {
          employee:    `${employee.firstName} ${employee.lastName}`,
          branch:      employee.currentBranch!.name,
          type:        data.type,
          date:        data.date.toISOString().slice(0, 10),
          minutesOwed,
          status,
        },
      },
    });
    return ev;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
