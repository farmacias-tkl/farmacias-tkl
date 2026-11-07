/**
 * GET  /api/vacations — listado con filtros
 * POST /api/vacations — crear solicitud (valida reglas, rechaza si BLOCKING;
 *                        las advertencias no bloquean)
 *
 * GET filtros extra: withoutCoverage=true (aprobadas sin rotativo),
 *                    withWarnings=true (aprobadas con "Aprobar igual"),
 *                    kpi=solicitadas|aprobadas|rechazadas|hoy (los indicadores
 *                    de la pantalla; definición en src/lib/vacations/kpis.ts).
 *
 * BRANCH_MANAGER: forzado a su sucursal en backend.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { validateVacationRequest } from "@/lib/vacations/validation";
import { vacationCreatedAuditDetail, vacationRequestCreateData } from "@/lib/vacations/create";
import { vacationFilterWhere } from "@/lib/vacations/list-where";
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
  const month       = sp.get("month"); // YYYY-MM
  const from        = sp.get("from");  // YYYY-MM-DD (inclusive)
  const to          = sp.get("to");    // YYYY-MM-DD (inclusive)
  const page        = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit       = Math.min(200, parseInt(sp.get("limit") ?? "50"));

  const where = vacationFilterWhere(sp, session!.user);
  if (!where) return NextResponse.json({ data: [], meta: { total: 0, page, limit, pages: 0 } });

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

  // Filtro por rango arbitrario [from, to] — usado por la vista calendario
  // que muestra 6 semanas (puede cruzar mes anterior/siguiente).
  if (from || to) {
    const fromD = from ? new Date(from) : new Date("1970-01-01");
    const toD   = to   ? new Date(to)   : new Date("9999-12-31");
    // Si pasaste solo to, fromD es muy viejo; si solo from, toD es muy futuro.
    where.startDate = { ...(where.startDate as object ?? {}), lte: toD };
    where.endDate   = { ...(where.endDate as object ?? {}),   gte: fromD };
  }

  const [data, total] = await Promise.all([
    prisma.vacationRequest.findMany({
      where,
      // Lo que muestran la lista y el calendario. El resto va en /api/vacations/[id].
      select: {
        id: true, status: true, conflictLevel: true, withoutCoverage: true, approvedWithWarnings: true,
        employeeNameSnapshot: true, branchNameSnapshot: true, positionNameSnapshot: true,
        startDate: true, endDate: true, daysCount: true,
        createdAt: true, updatedAt: true, supervisorActionAt: true, rrhhActionAt: true,
        requestedBy:        { select: { name: true } },
        supervisorActionBy: { select: { name: true } },
        rrhhActionBy:       { select: { name: true } },
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

  const creatable = {
    ...employee,
    positionId: employee.positionId,
    position: employee.position!,
    currentBranchId: employee.currentBranchId!,
    currentBranch: employee.currentBranch!,
  };
  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.vacationRequest.create({
      data: vacationRequestCreateData({
        employee: creatable,
        startDate: data.startDate,
        endDate: data.endDate,
        requesterNote: data.requesterNote ?? null,
        validation,
        requestedByUserId: session!.user.id,
      }),
    });

    await tx.auditLog.create({
      data: {
        userId:   session!.user.id,
        action:   "VACATION_REQUEST_CREATED",
        entity:   "VacationRequest",
        entityId: request.id,
        detail:   vacationCreatedAuditDetail(creatable, data.startDate, data.endDate, validation),
      },
    });

    return request;
  });

  return NextResponse.json({ data: created, validation }, { status: 201 });
}
