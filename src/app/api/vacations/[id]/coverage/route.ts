/**
 * GET  /api/vacations/[id]/coverage
 *   Rotativos que pueden cubrir (adenda D.1): primero los libres todo el
 *   período, después los libres algunos días (con el detalle). Solo aplica a
 *   sucursales de zona CABA y se proponen solo rotativos de zona CABA
 *   (applies=false en PROVINCIA). Incluye la cobertura activa vinculada, si hay.
 *
 *   ?positionId= elige qué puesto de la persona se cubre (el de la solicitud
 *   o su secundario); la respuesta trae coverPositions con las opciones.
 *
 * POST /api/vacations/[id]/coverage  { rotativeEmployeeId: string | null, coverPositionId?: string }
 *   Cambiar o quitar la cobertura de una solicitud aprobada (adenda D.4).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireAuth, requireCan } from "@/lib/permissions";
import { z } from "zod";
import { coveredByRotatives, positionKeyOf } from "@/lib/personal/catalog";
import { loadCoverPositions, loadRotativeOptions, pickCoverPosition } from "@/lib/vacations/coverage-data";
import { changeCoverage } from "@/lib/vacations/actions";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });

  const v = await prisma.vacationRequest.findUnique({
    where: { id: params.id },
    include: { position: { select: { name: true } }, branch: { select: { zone: true } } },
  });
  if (!v) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (session!.user.role === "BRANCH_MANAGER" && v.branchId !== session!.user.branchId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const current = await prisma.employeeBranchAssignment.findFirst({
    where: { vacationRequestId: v.id, status: "ACTIVE" },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Qué puesto se cubre: el pedido; si no, el de la cobertura actual; si no, el de la solicitud.
  const coverPositions = await loadCoverPositions(prisma, v);
  const asked = req.nextUrl.searchParams.get("positionId");
  const cover = pickCoverPosition(coverPositions, asked)
    ?? pickCoverPosition(coverPositions, current?.positionId)
    ?? pickCoverPosition(coverPositions);
  // Sin rotativo, la solicitud queda "sin cobertura" solo si su propio puesto lleva rotativos.
  const flagsWithoutCoverage = coveredByRotatives(positionKeyOf(v.position.name), v.branch.zone);
  if (!cover) {
    return NextResponse.json({ data: { applies: false, current, availability: [], requestZone: null, coverPositions: [], coverPositionId: null, flagsWithoutCoverage } });
  }
  const options = await loadRotativeOptions(prisma, {
    employeeId: v.employeeId,
    positionKey: cover.key,
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
      coverPositions: options.applies ? coverPositions : [],
      coverPositionId: cover.id,
      flagsWithoutCoverage,
    },
  });
}

const postSchema = z.object({
  rotativeEmployeeId: z.string().min(1).nullable(),
  coverPositionId:    z.string().min(1).nullable().optional(),
});

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
    coverPositionId: parsed.data.coverPositionId ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data });
}
