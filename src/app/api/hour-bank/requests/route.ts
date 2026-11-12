/**
 * GET  /api/hour-bank/requests — pedidos de día o franja por banco de horas.
 *        Filtros: branchId, employeeId, status, active=true (pedidos y
 *        autorizados), from/to (los que tocan ese rango), date (los que
 *        incluyen ese día). Encargado/a: solo su sucursal, pida lo que pida.
 * POST /api/hour-bank/requests — pedir. Encargado/a (su sucursal) y supervisión.
 *        Queda pendiente: no descuenta hasta que supervisión lo autoriza.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, requireCan } from "@/lib/permissions";
import { listBranchScope } from "@/lib/branch-scope";
import { parseISODate } from "@/lib/personal/dates";
import { createRequest } from "@/lib/hour-bank/actions";

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

const isoDate = z.string().refine((s) => parseISODate(s) !== null, "Fecha inválida (YYYY-MM-DD)");

const createSchema = z.object({
  employeeId: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  startMinute: z.number().int().min(0).max(1440).nullable().optional(),
  endMinute: z.number().int().min(0).max(1440).nullable().optional(),
  hours: z.number().positive().max(2000).nullable().optional(),
  coveredByEmployeeId: z.string().min(1).nullable().optional(),
  coverageNote: z.string().max(300).nullable().optional(),
  requesterNote: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.viewHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1") || 1);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "50") || 50));
  const empty = NextResponse.json({ data: [], meta: { total: 0, page, limit, pages: 0 } });

  const scope = listBranchScope(session!.user, sp.get("branchId"));
  if (scope === null) return empty;

  const where: any = {};
  if (scope) where.branchId = scope;
  if (sp.get("employeeId")) where.employeeId = sp.get("employeeId");
  const status = sp.get("status");
  if (status) {
    if (!(STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    where.status = status;
  } else if (sp.get("active") === "true") {
    where.status = { in: ["PENDING", "APPROVED"] };
  }
  const date = sp.get("date");
  const from = date ?? sp.get("from");
  const to = date ?? sp.get("to");
  if (from || to) {
    const f = from ? parseISODate(from) : null;
    const t = to ? parseISODate(to) : null;
    if ((from && !f) || (to && !t)) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    if (t) where.startDate = { lte: t };
    if (f) where.endDate = { gte: f };
  }

  const [rows, total] = await Promise.all([
    prisma.hourBankRequest.findMany({
      where,
      include: {
        coveredBy: { select: { id: true, firstName: true, lastName: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.hourBankRequest.count({ where }),
  ]);
  return NextResponse.json({ data: rows, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const permErr = requireCan(can.requestHourBank, session);
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const result = await createRequest(prisma, session!.user, {
    ...d,
    startDate: parseISODate(d.startDate)!,
    endDate: parseISODate(d.endDate)!,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.data }, { status: 201 });
}
