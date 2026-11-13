/**
 * GET /api/time-events/person?employeeId=
 *
 * Total de una persona, todas sus deudas (de la más vieja a la más nueva) y
 * las compensaciones cargadas. BRANCH_MANAGER: solo lo de su sucursal.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { loadPerson } from "@/lib/time-events/actions";

export async function GET(req: NextRequest) {
  const session = await auth();
  const authErr = requireAuth(session);
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status });
  const employeeId = req.nextUrl.searchParams.get("employeeId");
  if (!employeeId) return NextResponse.json({ error: "Falta employeeId" }, { status: 400 });
  const r = await loadPerson(prisma, session!.user, employeeId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ data: r.data });
}
