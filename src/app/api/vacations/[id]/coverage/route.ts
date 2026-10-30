/**
 * GET  /api/vacations/[id]/coverage
 *   Rotativos que pueden cubrir (adenda D.1): primero los libres todo el
 *   período, después los libres algunos días (con el detalle). Solo aplica a
 *   sucursales de zona CABA y se proponen solo rotativos de zona CABA
 *   (applies=false en PROVINCIA). Incluye la cobertura activa vinculada, si hay.
 *
 * POST /api/vacations/[id]/coverage  { rotativeEmployeeId: string | null }
 *   Cambiar o quitar la cobertura de una solicitud aprobada (adenda D.4).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { positionKeyOf, usesRotativeCoverage } from "@/lib/personal/catalog";
import { loadRotativeOptions } from "@/lib/vacations/coverage-data";
import { changeCoverage } from "@/lib/vacations/actions";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const v = await prisma.vacationRequest.findUnique({
    where: { id: params.id },
    include: { position: { select: { name: true } } },
  });
  if (!v) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (session!.user.role === "BRANCH_MANAGER" && v.branchId !== session!.user.branchId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const current = await prisma.employeeBranchAssignment.findFirst({
    where: { vacationRequestId: v.id, status: "ACTIVE" },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });

  const key = positionKeyOf(v.position.name);
  if (!usesRotativeCoverage(key)) {
    return NextResponse.json({ data: { applies: false, current, availability: [], requestZone: null } });
  }
  const options = await loadRotativeOptions(prisma, {
    employeeId: v.employeeId,
    positionKey: key!,
    branchId: v.branchId,
    startDate: v.startDate,
    endDate: v.endDate,
    excludeRequestId: v.id,
  });
  return NextResponse.json({
    data: {
      applies: options.applies,
      current,
      requestZone: options.requestZone,
      neededSlots: options.needed.length,
      availability: options.availability,
    },
  });
}

const postSchema = z.object({ rotativeEmployeeId: z.string().min(1).nullable() });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const permErr = requireCan(can.changeVacationCoverage, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await changeCoverage(prisma, {
    id: params.id,
    userId: session!.user.id,
    rotativeEmployeeId: parsed.data.rotativeEmployeeId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
