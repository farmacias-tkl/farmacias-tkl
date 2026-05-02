/**
 * One-shot: marca executiveAccess=true para usuarios con role OWNER.
 *
 * En el nuevo sistema:
 *  - OWNER tiene acceso ejecutivo siempre (hardcoded en canViewExecutive),
 *    pero igual se setea el flag = true por consistencia con el resto de
 *    la lógica que lee este campo.
 *  - ADMIN y SUPERVISOR NO tienen acceso ejecutivo por defecto. Si OWNER
 *    quiere que lo tengan, debe otorgárselos explícitamente desde el panel
 *    /owner/accesos.
 *
 * Correr una sola vez después de `prisma db push`:
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/backfill-executive-access.ts
 *
 * Idempotente: si ya está aplicado, devuelve updated=0.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)/)?.[1] ?? "(host desconocido)";
  console.log(`[neon] host=${host}`);

  const before = await prisma.user.count({ where: { executiveAccess: true } });
  const total  = await prisma.user.count();

  const result = await prisma.user.updateMany({
    where: {
      role: { in: ["OWNER"] },
      executiveAccess: false,
    },
    data: { executiveAccess: true },
  });

  const after = await prisma.user.count({ where: { executiveAccess: true } });

  console.log(`[backfill] total_users=${total}`);
  console.log(`[backfill] before(executiveAccess=true)=${before}`);
  console.log(`[backfill] updated=${result.count}  (solo OWNER)`);
  console.log(`[backfill] after(executiveAccess=true)=${after}`);
  console.log("[done] OK");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
