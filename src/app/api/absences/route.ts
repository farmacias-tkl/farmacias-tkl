/**
 * GET  /api/absences  — filtros backend por rol
 * POST /api/absences
 *
 * BRANCH_MANAGER: branchId forzado en backend, no puede ver otras sucursales.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";

const ABSENCE_TYPES = ["SICKNESS","PERSONAL_REASON","NO_SHOW","LATE_NOTICE",
  "LATE_ARRIVAL","MEDICAL_LEAVE","SPECIAL_LEAVE","SUSPENSION","OTHER"] as const;

const createSchema = z.object({
  employeeId:                   z.string().min(1),
  branchId:                     z.string().min(1),
  startDate:                    z.string().transform(d => new Date(d)),
  endDate:                      z.string().transform(d => new Date(d)),
  absenceType:                  z.enum(ABSENCE_TYPES),
  reasonDetail:                 z.string().optional().nullable(),
  notes:                        z.string().optional().nullable(),
  hasCertificate:               z.boolean().default(false),
  certificateUntil:             z.string().optional().nullable().transform(d => d ? new Date(d) : null),
  notifiedAt:                   z.string().optional().nullable().transform(d => d ? new Date(d) : null),
  branchDetectedFromAssignment: z.boolean().default(false),
  // Solo aplican cuando absenceType === LATE_ARRIVAL
  expectedArrivalTime:          z.string().optional().nullable().transform(d => d ? new Date(d) : null),
  actualArrivalTime:            z.string().optional().nullable().transform(d => d ? new Date(d) : null),
  lateMinutes:                  z.number().int().optional().nullable(),
});

function enrichAbsence(a: any) {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(a.startDate); start.setHours(0,0,0,0);
  const end   = new Date(a.endDate);   end.setHours(0,0,0,0);
  return {
    ...a,
    totalDays:     Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    isActiveToday: start <= today && today <= end,
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp         = req.nextUrl.searchParams;
  const branchId   = sp.get("branchId");
  const employeeId = sp.get("employeeId");
  const status     = sp.get("status");
  const activeOnly = sp.get("activeOnly") === "true";
  const isRotating = sp.get("isRotating");
  const page       = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit      = Math.min(100, parseInt(sp.get("limit") ?? "50"));

  const where: any = {};

  // BRANCH_MANAGER: forzar su sucursal en backend
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
  if (isRotating === "true") {
    where.employee = { isRotating: true };
  }

  if (activeOnly) {
    const today = new Date(); today.setHours(0,0,0,0);
    const end   = new Date(today); end.setHours(23,59,59,999);
    where.startDate = { lte: end };
    where.endDate   = { gte: today };
  }

  const [absences, total] = await Promise.all([
    prisma.absenceRecord.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true,
            isRotating: true, zone: true,
            position: { select: { id: true, name: true, requiresCoverage: true } },
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { startDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.absenceRecord.count({ where }),
  ]);

  return NextResponse.json({
    data: absences.map(enrichAbsence),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.createAbsence, session);
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

  if (data.endDate < data.startDate) {
    return NextResponse.json(
      { error: "La fecha fin no puede ser anterior al inicio" },
      { status: 400 }
    );
  }

  // Validación específica para LATE_ARRIVAL
  if (data.absenceType === "LATE_ARRIVAL") {
    if (!data.expectedArrivalTime || !data.actualArrivalTime) {
      return NextResponse.json(
        { error: "Llegó tarde requiere hora esperada y hora real de llegada" },
        { status: 400 }
      );
    }
    if (data.actualArrivalTime <= data.expectedArrivalTime) {
      return NextResponse.json(
        { error: "La hora real debe ser posterior a la hora esperada" },
        { status: 400 }
      );
    }
    // Calcular lateMinutes si no vino explícito
    if (data.lateMinutes == null) {
      data.lateMinutes = Math.round(
        (data.actualArrivalTime.getTime() - data.expectedArrivalTime.getTime()) / 60000
      );
    }
  }

  // BRANCH_MANAGER solo puede registrar en su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    data.branchId !== session!.user.branchId
  ) {
    return NextResponse.json(
      { error: "Solo podes registrar ausencias en tu sucursal" },
      { status: 403 }
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    include: { position: { select: { name: true, requiresCoverage: true } } },
  });
  if (!employee) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  const absence = await prisma.absenceRecord.create({
    data: { ...data, reportedByUserId: session!.user.id, status: "REPORTED" },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, isRotating: true,
          position: { select: { name: true, requiresCoverage: true } },
        },
      },
      branch: { select: { id: true, name: true } },
    },
  });

  let alert: string | null = null;
  if (employee.position.requiresCoverage) {
    alert = `${employee.position.name} en ${absence.branch.name} requiere cobertura.`;
  }
  if (data.absenceType === "SUSPENSION") {
    alert = `Suspension registrada para ${employee.firstName} ${employee.lastName}.`;
  }

  await prisma.auditLog.create({
    data: {
      userId:   session!.user.id,
      action:   "CREATE",
      entity:   "AbsenceRecord",
      entityId: absence.id,
      detail: {
        employee:   `${employee.firstName} ${employee.lastName}`,
        type:       data.absenceType,
        branch:     absence.branch.name,
        isRotating: employee.isRotating,
      },
    },
  }).catch(() => {});

  return NextResponse.json({ data: enrichAbsence(absence), alert }, { status: 201 });
}
