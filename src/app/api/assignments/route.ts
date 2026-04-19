/**
 * GET  /api/assignments  — lista de asignaciones con filtros
 * POST /api/assignments  — crear nueva asignación de rotativa
 *
 * Solo maneja ROTATION y TEMPORARY_COVERAGE.
 * Las asignaciones PERMANENT se crean desde /api/employees (alta de empleado).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  employeeId:  z.string().min(1, "Rotativa obligatoria"),
  branchId:    z.string().min(1, "Sucursal obligatoria"),
  positionId:  z.string().optional().nullable(),  // puesto cubierto
  type:        z.enum(["ROTATION", "TEMPORARY_COVERAGE"]),
  startDate:   z.string().transform(d => { const dt = new Date(d); dt.setHours(0,0,0,0); return dt; }),
  endDate:     z.string().transform(d => { const dt = new Date(d); dt.setHours(23,59,59,999); return dt; }),
  reason:      z.string().optional().nullable(),
  notes:       z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp          = req.nextUrl.searchParams;
  const branchId    = sp.get("branchId");
  const employeeId  = sp.get("employeeId");
  const status      = sp.get("status") ?? "ACTIVE";
  const view        = sp.get("view"); // "today" | "upcoming" | "all"
  const page        = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit       = Math.min(100, parseInt(sp.get("limit") ?? "30"));

  const forcedBranch = session!.user.role === "BRANCH_MANAGER"
    ? session!.user.branchId : null;

  const where: any = {
    type: { in: ["ROTATION", "TEMPORARY_COVERAGE"] },
  };

  if (forcedBranch)   where.branchId = forcedBranch;
  else if (branchId)  where.branchId = branchId;
  if (employeeId)     where.employeeId = employeeId;
  if (status !== "all") where.status = status;

  const today = new Date(); today.setHours(0,0,0,0);
  const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);

  if (view === "today") {
    where.startDate = { lte: todayEnd };
    where.OR = [{ endDate: null }, { endDate: { gte: today } }];
  } else if (view === "upcoming") {
    const in7Days = new Date(today); in7Days.setDate(in7Days.getDate() + 7);
    where.startDate = { gt: today, lte: in7Days };
  }

  const [assignments, total] = await Promise.all([
    prisma.employeeBranchAssignment.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, zone: true,
            position: { select: { id: true, name: true } },
          },
        },
        branch:   { select: { id: true, name: true } },
        position: { select: { id: true, name: true, requiresCoverage: true } },
      },
      orderBy: { startDate: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.employeeBranchAssignment.count({ where }),
  ]);

  // Enriquecer con estado operativo hoy
  const empIds = assignments.map(a => a.employeeId);
  const ausenciasHoy = empIds.length > 0
    ? await prisma.absenceRecord.findMany({
        where: {
          employeeId: { in: empIds },
          startDate: { lte: todayEnd },
          endDate:   { gte: today },
        },
        select: { employeeId: true, absenceType: true },
      })
    : [];
  const absMap = new Map(ausenciasHoy.map(a => [a.employeeId, a.absenceType]));

  const enriched = assignments.map(a => ({
    ...a,
    isActiveToday: a.startDate <= todayEnd && (a.endDate == null || a.endDate >= today),
    employeeAbsentToday: absMap.has(a.employeeId),
    employeeAbsenceType: absMap.get(a.employeeId) ?? null,
  }));

  return NextResponse.json({
    data: enriched,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  // Solo supervisores y RRHH pueden crear asignaciones de rotativos
  if (!can.reassignEmployee(session!.user.role)) {
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

  if (data.endDate < data.startDate) {
    return NextResponse.json(
      { error: "La fecha fin no puede ser anterior al inicio" },
      { status: 400 }
    );
  }

  // Verificar que el empleado es rotativo
  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    select: { id: true, firstName: true, lastName: true, isRotating: true, maxConcurrentAssignments: true },
  });
  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (!employee.isRotating) {
    return NextResponse.json(
      { error: "Solo se pueden crear asignaciones de tipo ROTATION o TEMPORARY_COVERAGE para empleados rotativos" },
      { status: 400 }
    );
  }

  // Verificar conflictos: si el rotativo ya tiene asignación ACTIVE en el mismo período en la misma sucursal
  const conflicto = await prisma.employeeBranchAssignment.findFirst({
    where: {
      employeeId: data.employeeId,
      branchId:   data.branchId,
      status:     "ACTIVE",
      type:       { in: ["ROTATION","TEMPORARY_COVERAGE"] },
      startDate:  { lte: data.endDate },
      OR: [{ endDate: null }, { endDate: { gte: data.startDate } }],
    },
    include: { branch: { select: { name: true } } },
  });
  if (conflicto) {
    return NextResponse.json(
      { error: `${employee.firstName} ${employee.lastName} ya tiene una asignacion activa en ${conflicto.branch.name} en ese período.` },
      { status: 409 }
    );
  }

  // Verificar maxConcurrentAssignments
  const concurrentes = await prisma.employeeBranchAssignment.count({
    where: {
      employeeId: data.employeeId,
      status:     "ACTIVE",
      type:       { in: ["ROTATION","TEMPORARY_COVERAGE"] },
      startDate:  { lte: data.endDate },
      OR: [{ endDate: null }, { endDate: { gte: data.startDate } }],
    },
  });
  if (concurrentes >= employee.maxConcurrentAssignments) {
    return NextResponse.json(
      { error: `${employee.firstName} ${employee.lastName} ya tiene ${concurrentes} asignacion/es activas en ese período (máximo: ${employee.maxConcurrentAssignments}).` },
      { status: 409 }
    );
  }

  const assignment = await prisma.employeeBranchAssignment.create({
    data: {
      employeeId:      data.employeeId,
      branchId:        data.branchId,
      positionId:      data.positionId ?? null,
      type:            data.type,
      status:          "ACTIVE",
      startDate:       data.startDate,
      endDate:         data.endDate,
      reason:          data.reason ?? null,
      notes:           data.notes ?? null,
      assignedByUserId: session!.user.id,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, zone: true } },
      branch:   { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "EmployeeBranchAssignment",
      entityId: assignment.id,
      detail:   {
        employee: `${employee.firstName} ${employee.lastName}`,
        branch:   assignment.branch.name,
        type:     data.type,
        period:   `${data.startDate.toISOString().split("T")[0]} → ${data.endDate.toISOString().split("T")[0]}`,
      },
    },
  }).catch(() => {});

  return NextResponse.json({ data: assignment }, { status: 201 });
}
