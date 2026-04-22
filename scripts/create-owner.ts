import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash("TKL2026-cambiar-en-entrega", 12);
  await prisma.user.upsert({
    where: { email: "direccion@farmaciastkl.com" },
    update: { passwordHash, active: true, role: "OWNER" },
    create: {
      email: "direccion@farmaciastkl.com",
      name: "Dirección",
      passwordHash,
      role: "OWNER",
      active: true,
    },
  });
  console.log("Usuario OWNER creado/actualizado");
  await prisma.$disconnect();
}

main();
