/**
 * GET  /api/employees
 *
 * Agrega parámetro plantilla=true que devuelve el plantel real del día
 * (fijos + rotativos asignados) para una sucursal y fecha dadas.
 * Usado por el selector de ausencias.
 *
 * Con plantilla=true:
 *   - branchId obligatorio
 *   - date opcional (default hoy)
 *   - respuesta: { fijos: [], rotativos: [], all: [] }
 *
 * Sin plantilla=true: comportamiento original.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { getPlantillaReal } from "@/lib/plantilla";
import { z } from "zod";

const createSchema = z.object({
  firstName:                z.string().min(1),
  lastName:                 z.string().min(1),
  positionId:               z.string().min(1),
  currentBranchId:          z.string().optional().nullable(),
  hireDate:                 z.string().optional().nullable().transform(d => d ? new Date(d) : null),
  workScheduleNotes:        z.string().optional().nullable(),
  notes:                    z.string().optional().nullable(),
  isRotating:               z.boolean().default(false),
  zone:                     z.string().optional().nullable(),
  maxConcurrentAssignments: z.number().int().min(1).default(1),
  assignmentStartDate:      z.string().optional().transform(d => d ? new Date(d) : new Date()),
  assignmentType:           z.enum(["PERMANENT","TEMPORARY_COVERAGE","ROTATION"]).default("PERMANENT"),
  assignmentReason:         z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const sp         = req.nextUrl.searchParams;
  const usePlantilla = sp.get("plantilla") === "true";

  // ── Modo plantilla: plantel real del día ───────────────────────────────────
  if (usePlantilla) {
    const branchId  = sp.get("branchId");
    const dateParam = sp.get("date");

    if (!branchId) {
      return NextResponse.json(
        { error: "branchId es obligatorio cuando plantilla=true" },
        { status: 400 }
      );
    }

    // BRANCH_MANAGER solo puede consultar su sucursal
    if (
      session!.user.role === "BRANCH_MANAGER" &&
      session!.user.branchId !== branchId
    ) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const date = dateParam ? new Date(dateParam) : new Date();
    const plantilla = await getPlantillaReal(branchId, date);

    return NextResponse.json({
      fijos:     plantilla.fijos,
      rotativos: plantilla.rotativos,
      all:       plantilla.all,
      summary:   plantilla.summary,
    });
  }

  // ── Modo normal: lista con filtros ────────────────────────────────────────
  const branchId   = sp.get("branchId");
  const posId      = sp.get("positionId");
  const activeP    = sp.get("active");
  const rotating   = sp.get("isRotating");
  const search     = sp.get("search");
  const withStatus = sp.get("withStatus") === "true";
  const page       = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit      = Math.min(100, parseInt(sp.get("limit") ?? "50"));

  const forcedBranch = session!.user.role === "BRANCH_MANAGER"
    ? session!.user.branchId : null;

  const where: any = {};
  if (activeP === "false") where.active = false;
  else if (activeP !== "any") where.active = true;
  if (forcedBranch)  where.currentBranchId = forcedBranch;
  else if (branchId) where.currentBranchId = branchId;
  if (posId)             where.positionId  = posId;
  if (rotating === "true") where.isRotating = true;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName:  { contains: search, mode: "insensitive" } },
    ];
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: {
        position:      { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
        currentBranch: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.employee.count({ where }),
  ]);

  let data: any[] = employees;

  if (withStatus && employees.length > 0) {
    const today    = new Date(); today.setHours(0,0,0,0);
    const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);
    const ids      = employees.map(e => e.id);

    const absences = await prisma.absenceRecord.findMany({
      where: { employeeId: { in: ids }, startDate: { lte: todayEnd }, endDate: { gte: today } },
      select: { employeeId: true, absenceType: true },
    });

    const absMap = new Map(absences.map(a => [a.employeeId, a.absenceType]));
    data = employees.map(emp => {
      const aType    = absMap.get(emp.id);
      const statusHoy = !aType ? "ACTIVE"
        : ["MEDICAL_LEAVE","SPECIAL_LEAVE"].includes(aType) ? "ON_LEAVE"
        : "ABSENT";
      return { ...emp, statusHoy };
    });
  }

  return NextResponse.json({
    data,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.manageEmployees, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { assignmentStartDate, assignmentType, assignmentReason, ...empData } = parsed.data;

  if (
    session!.user.role === "BRANCH_MANAGER" &&
    empData.currentBranchId !== session!.user.branchId
  ) {
    return NextResponse.json({ error: "Solo podes crear empleados en tu sucursal" }, { status: 403 });
  }

  const position = await prisma.position.findUnique({ where: { id: empData.positionId } });
  if (!position) return NextResponse.json({ error: "Puesto no encontrado" }, { status: 404 });

  let scopeWarning: string | null = null;
  if (position.scope === "SPECIFIC" && empData.currentBranchId) {
    const inScope = await prisma.positionBranchScope.findFirst({
      where: { positionId: empData.positionId, branchId: empData.currentBranchId },
    });
    if (!inScope) scopeWarning = `El puesto "${position.name}" no es habitual en esta sucursal.`;
  }

  const employee = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.create({
      data: { ...empData, active: true },
      include: {
        position:      { select: { id: true, name: true } },
        currentBranch: { select: { id: true, name: true } },
      },
    });
    if (empData.currentBranchId) {
      await tx.employeeBranchAssignment.create({
        data: {
          employeeId: emp.id, branchId: empData.currentBranchId,
          startDate: assignmentStartDate, endDate: null,
          type: assignmentType, reason: assignmentReason ?? "Alta inicial",
          assignedByUserId: session!.user.id,
        },
      });
    }
    return emp;
  });

  await prisma.auditLog.create({
    data: {
      userId: session!.user.id, action: "CREATE",
      entity: "Employee", entityId: employee.id,
      detail: { name: `${employee.firstName} ${employee.lastName}` },
    },
  }).catch(() => {});

  return NextResponse.json({ data: employee, warning: scopeWarning }, { status: 201 });
}
