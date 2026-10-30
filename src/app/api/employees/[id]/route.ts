/**
 * GET   /api/employees/[id]
 * PATCH /api/employees/[id]
 *
 * PATCH acepta también los campos de personal real (sucursal de contrato,
 * sucursal donde trabaja, puesto secundario, DT, rotativo, horas semanales,
 * tareas adicionales). Si cambia la sucursal donde trabaja se cierra la
 * asignación PERMANENT abierta y se abre otra desde hoy (como createAssignment).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { addDays, utcDay } from "@/lib/personal/dates";
import {
  DUPLICATE_PERSON_ERROR, checkPersonalRefs, isDuplicatePerson, nameKeyFor, personalFieldsSchema,
} from "@/lib/personal/employee-fields";

const patchSchema = z.object({
  firstName:         z.string().min(1).optional(),
  lastName:          z.string().min(1).optional(),
  positionId:        z.string().optional(),
  workScheduleNotes: z.string().optional().nullable(),
  notes:             z.string().optional().nullable(),
  active:            z.boolean().optional(),
  hireDate:          z.string().optional().nullable().transform(d => d ? new Date(d) : undefined),
  currentBranchId:   z.string().min(1).optional().nullable(),
  isRotating:        z.boolean().optional(),
  ...personalFieldsSchema,
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: {
      position:      { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
      currentBranch: { select: { id: true, name: true } },
      branchAssignments: {
        include: { branch: { select: { id: true, name: true } } },
        orderBy: { startDate: "desc" },
      },
    },
  });

  if (!employee) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  // Encargados solo ven su sucursal
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    employee.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json({ data: employee });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();

  // OWNER no puede editar
  const permErr = requireCan(can.manageEmployees, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const existing = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    existing.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (
    session!.user.role === "BRANCH_MANAGER" &&
    data.currentBranchId !== undefined &&
    data.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Solo podes asignar empleados a tu sucursal" }, { status: 403 });
  }

  const final = {
    firstName:           data.firstName ?? existing.firstName,
    lastName:            data.lastName ?? existing.lastName,
    positionId:          data.positionId ?? existing.positionId,
    secondaryPositionId: data.secondaryPositionId !== undefined ? data.secondaryPositionId : existing.secondaryPositionId,
    contractBranchId:    data.contractBranchId !== undefined ? data.contractBranchId : existing.contractBranchId,
    currentBranchId:     data.currentBranchId !== undefined ? data.currentBranchId : existing.currentBranchId,
  };
  const refErr = await checkPersonalRefs(prisma, final);
  if (refErr) return NextResponse.json({ error: refErr }, { status: 400 });
  const nameKey = nameKeyFor(final.lastName, final.firstName, final.contractBranchId);
  const branchChanged = data.currentBranchId !== undefined && data.currentBranchId !== existing.currentBranchId;

  const updated = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.update({
      where: { id: params.id },
      data:  { ...data, ...(nameKey !== undefined && nameKey !== existing.nameKey ? { nameKey } : {}) },
      include: {
        position:      { select: { id: true, name: true } },
        currentBranch: { select: { id: true, name: true } },
      },
    });
    if (branchChanged) {
      const today = utcDay(new Date());
      await tx.employeeBranchAssignment.updateMany({
        where: { employeeId: emp.id, type: "PERMANENT", endDate: null },
        data:  { endDate: addDays(today, -1) },
      });
      if (data.currentBranchId) {
        await tx.employeeBranchAssignment.create({
          data: {
            employeeId: emp.id, branchId: data.currentBranchId, type: "PERMANENT", status: "ACTIVE",
            startDate: today, endDate: null, reason: "Cambio de sucursal (edición manual)",
            assignedByUserId: session!.user.id,
          },
        });
      }
    }
    return emp;
  }).catch((e) => {
    if (isDuplicatePerson(e)) return null;
    throw e;
  });
  if (!updated) return NextResponse.json({ error: DUPLICATE_PERSON_ERROR }, { status: 409 });

  const changes = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: { from: (existing as any)[k], to: v } }), {});

  await prisma.auditLog.create({
    data: {
      userId: session!.user.id, action: "UPDATE",
      entity: "Employee", entityId: updated.id, detail: changes,
    },
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}
