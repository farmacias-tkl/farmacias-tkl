/**
 * Base Postgres LOCAL y EFÍMERA para las pruebas de las consultas de métricas. Nunca Neon:
 * aborta si el host de DATABASE_URL (.env) no es local. Crea la base, aplica el esquema con
 * `prisma db push` y la borra al terminar, también si la prueba falla.
 *
 * Todos los datos que cargan las pruebas son inventados.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

function abort(m: string): never { console.error("ABORT:", m); process.exit(1); }

export async function withEphemeralDb(
  dbName: string,
  run: (prisma: PrismaClient) => Promise<void>,
): Promise<void> {
  const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/m);
  if (!m) abort("No encontré DATABASE_URL en .env");
  const baseUrl = m[1].trim();
  const host = new URL(baseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) abort(`SAFETY ABORT: ${host} no es local. NUNCA Neon.`);
  const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
  const testUrl = new URL(baseUrl); testUrl.pathname = `/${dbName}`;

  const adminExec = async (sql: string) => {
    const a = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try { await a.$executeRawUnsafe(sql); } finally { await a.$disconnect(); }
  };
  const drop = async () => {
    try { await adminExec(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); }
    catch (e) { console.error(`TEARDOWN FAILED: borrar manualmente "${dbName}". ${e instanceof Error ? e.message : String(e)}`); }
  };

  await adminExec(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await adminExec(`CREATE DATABASE "${dbName}"`);
  try {
    execSync("npx prisma db push --skip-generate", { stdio: "pipe", env: { ...process.env, DATABASE_URL: testUrl.toString() } });
    // El singleton @/lib/prisma lee DATABASE_URL al importarse: se fija antes del import dinámico.
    process.env.DATABASE_URL = testUrl.toString();
    const { prisma } = await import("../../prisma");
    try { await run(prisma); } finally { await prisma.$disconnect().catch(() => {}); }
  } finally {
    await drop();
  }
}
