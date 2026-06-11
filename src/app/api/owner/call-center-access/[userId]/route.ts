/**
 * PATCH /api/owner/call-center-access/[userId] — body: { callCenterAccess: boolean }
 * Solo OWNER. Otorga/revoca el ACCESO EXCEPCIONAL por flag al módulo Call Center.
 *
 * Modelo jerarquía + excepción: OWNER/ADMIN/SUPERVISOR acceden por ROL (no por flag),
 * así que este endpoint NO opera sobre ellos — su acceso no es un grant y
 * grantedAt/grantedBy quedan NULL por diseño.
 *
 * Atomicidad (NO heredamos el patrón DC-4 de audit fuera de transacción): el update
 * del flag + grantedAt/grantedBy + el SecurityEvent van en UN MISMO $transaction.
 *
 * Guards: solo OWNER; no a uno mismo; no a roles base (acceso por rol); no-op idempotente.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessOwnerPanel, CALL_CENTER_ROLE_ACCESS } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ callCenterAccess: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canAccessOwnerPanel(session.user)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  if (params.userId === session.user.id) {
    return NextResponse.json(
      { error: "No podés modificar tu propio acceso." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where:  { id: params.userId },
    select: { id: true, name: true, email: true, role: true, callCenterAccess: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Guard rol base: su acceso es por jerarquía; el flag no se toca desde la UI.
  if (CALL_CENTER_ROLE_ACCESS.includes(target.role)) {
    return NextResponse.json(
      { error: "OWNER, ADMIN y SUPERVISOR acceden a Call Center por su rol — no se otorga ni revoca por flag." },
      { status: 400 },
    );
  }

  // No-op idempotente (evita SecurityEvent vacío)
  if (target.callCenterAccess === parsed.data.callCenterAccess) {
    return NextResponse.json({ data: target, noop: true });
  }

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  const granting = parsed.data.callCenterAccess;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: params.userId },
      data: {
        callCenterAccess:          granting,
        callCenterAccessGrantedAt: granting ? new Date() : null,
        callCenterAccessGrantedBy: granting ? session.user.id : null,
      },
      select: { id: true, name: true, email: true, role: true, callCenterAccess: true },
    });

    await tx.securityEvent.create({
      data: {
        userId:    u.id,
        actorId:   session.user.id,
        type:      granting ? "CALL_CENTER_ACCESS_GRANTED" : "CALL_CENTER_ACCESS_REVOKED",
        detail:    { targetEmail: u.email, targetRole: u.role },
        ip:        ip ?? null,
        userAgent: ua ?? null,
      },
    });

    return u;
  });

  return NextResponse.json({ data: updated });
}
