/**
 * seed-branches-balances.ts — Alinea branches con el módulo de saldos bancarios.
 *
 *  1. Actualiza aliases de las 12 branches existentes (mapeo Excel ↔ DB)
 *  2. Crea 2 branches nuevas (Patricios, Condominio ET) que aparecen en el
 *     Excel de saldos pero no tenían representación en DB.
 *
 * Corre tanto contra local como contra Neon (se elige con DATABASE_URL del env).
 * Idempotente: upserts, no borra nada.
 *
 * Uso:
 *   Local:  npx tsx scripts/seed-branches-balances.ts
 *   Neon:   npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-branches-balances.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Aliases para branches YA existentes (solo se actualizan aliases, no code)
const BRANCH_ALIASES: Record<string, string[]> = {
  "Larcade":     ["LARCADE", "Larcade", "LA"],
  "Facultad":    ["AYACUCHO", "Facultad", "AY"],
  "La Perla":    ["MUNRO", "La Perla", "MU"],
  "America":     ["America", "AMERICA", "AM"],
  "Etcheverry":  ["Etcheverry", "ETCHEVERRY", "ET"],
  "Galesa":      ["Galesa", "GALESA", "GL"],
  "Naveira":     ["Naveira", "NAVEIRA", "NV"],
  "Quintana":    ["Quintana", "QUINTANA", "QN"],
  "San Agustin": ["San Agustin", "SAN AGUSTIN", "SA"],
  "San Miguel":  ["San Miguel", "SAN MIGUEL", "SM"],
  "Tekiel":      ["Tekiel", "TEKIEL", "TK"],
  "Call Center": ["Call Center", "CALL CENTER", "CCE"],
};

// Branches NUEVAS — sólo para el módulo de saldos (no están en SIAF)
const NEW_BRANCHES: Array<{ name: string; aliases: string[]; code: string }> = [
  { name: "Patricios",     aliases: ["Patricios", "PATRICIOS", "PAT"],         code: "PAT" },
  { name: "Condominio ET", aliases: ["Condominio ET", "CONDOMINIO ET", "CET"], code: "CET" },
];

// Overrides de visibilidad por módulo (solo branches con reglas especiales)
const VISIBILITY_OVERRIDES: Record<string, { showInExecutive?: boolean; showInOperative?: boolean }> = {
  "Call Center":   { showInExecutive: false },    // solo operativo (no aparece en ejecutivo)
  "Patricios":     { showInOperative: false },    // solo ejecutivo (no aparece en operativo)
  "Condominio ET": { showInOperative: false },    // solo ejecutivo (no aparece en operativo)
};

async function main() {
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log("🏦 Seed branches — módulo saldos bancarios");
  console.log(`   → Target DB host: ${host}\n`);

  // ─── Actualizar aliases de branches existentes ───────────
  console.log("📍 Actualizando aliases de branches existentes...");
  let updated = 0;
  let missing = 0;
  for (const [name, aliases] of Object.entries(BRANCH_ALIASES)) {
    const existing = await prisma.branch.findUnique({ where: { name } });
    if (!existing) {
      console.log(`   ⚠  ${name.padEnd(16)} NO EXISTE — skip`);
      missing++;
      continue;
    }
    const visibility = VISIBILITY_OVERRIDES[name] ?? {};
    await prisma.branch.update({
      where: { name },
      data:  { aliases, ...visibility },
    });
    const visTag = Object.keys(visibility).length > 0
      ? ` [${Object.entries(visibility).map(([k, v]) => `${k}=${v}`).join(", ")}]`
      : "";
    console.log(`   ✓ ${name.padEnd(16)} aliases: ${JSON.stringify(aliases)}${visTag}`);
    updated++;
  }

  console.log();

  // ─── Crear o actualizar branches nuevas ──────────────────
  console.log("📍 Creando branches nuevas para módulo de saldos...");
  let created = 0;
  let alreadyExisted = 0;
  for (const b of NEW_BRANCHES) {
    const visibility = VISIBILITY_OVERRIDES[b.name] ?? {};
    const existing = await prisma.branch.findUnique({ where: { name: b.name } });
    if (existing) {
      await prisma.branch.update({
        where: { name: b.name },
        data:  { aliases: b.aliases, code: b.code, ...visibility },
      });
      console.log(`   ℹ  ${b.name.padEnd(16)} ya existía — aliases/code/visibility actualizados`);
      alreadyExisted++;
    } else {
      await prisma.branch.create({
        data: {
          name:    b.name,
          aliases: b.aliases,
          code:    b.code,
          active:  true,
          ...visibility,
        },
      });
      const visTag = Object.keys(visibility).length > 0
        ? ` (${Object.entries(visibility).map(([k, v]) => `${k}=${v}`).join(", ")})`
        : "";
      console.log(`   ✓ ${b.name.padEnd(16)} CREADA (code=${b.code})${visTag}`);
      created++;
    }
  }

  console.log();
  console.log("═".repeat(60));
  console.log("Resumen:");
  console.log(`  Branches existentes con aliases actualizados: ${updated}`);
  if (missing > 0)        console.log(`  Branches esperadas NO encontradas:            ${missing}`);
  console.log(`  Branches nuevas creadas:                      ${created}`);
  if (alreadyExisted > 0) console.log(`  Branches nuevas que ya existían (updated):    ${alreadyExisted}`);
  console.log("═".repeat(60));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌", e);
  prisma.$disconnect();
  process.exit(1);
});
