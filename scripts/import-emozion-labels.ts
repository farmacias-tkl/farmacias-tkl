/**
 * import-emozion-labels.ts — Carga de un histórico de etiquetas de Emozion traído por API.
 *
 * PROPUESTA: este script todavía no se corrió contra ninguna base.
 *
 * Qué hace: para cada conversación del archivo que ya existe en la base, reemplaza
 * Conversation.externalLabels por las etiquetas del archivo. En las conversaciones RESUELTAS
 * que todavía no tienen resultado de cierre, guarda la etiqueta de cierre (según el mapa de
 * la configuración de métricas vigente) en la conversación y en su última fila RESUELTA del
 * historial. No crea conversaciones, no cambia estados, no toca mensajes y nunca pisa un
 * resultado de cierre que ya exista.
 *
 * Formato del archivo (JSON Lines, una conversación por línea, SOLO estas dos claves):
 *
 *   {"id":"12345","labels":["etiqueta_uno","etiqueta_dos"]}
 *
 * Una línea con cualquier otra clave se rechaza: el archivo no debe traer teléfono, nombre,
 * mensajes ni ningún otro dato (ver src/lib/call-center/labels-import.ts).
 *
 * Por defecto es DRY-RUN: no escribe nada. Muestra cuántas líneas leyó, cuántas rechazó y
 * por qué, cuántas conversaciones no están en la base, cuántas cambiarían de etiquetas y
 * cuántas recibirían un resultado de cierre, por etiqueta.
 *
 * Uso:
 *   # Solo el archivo, sin base (control de formato):
 *   npx tsx scripts/import-emozion-labels.ts --file <archivo.jsonl> --sin-db
 *
 *   # Dry-run contra la base (solo lecturas):
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/import-emozion-labels.ts --file <archivo.jsonl>
 *
 *   # Escribir (requiere confirmar el host de DATABASE_URL):
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/import-emozion-labels.ts --file <archivo.jsonl> --apply --host <host>
 *
 * Código de salida: 0 ok · 1 hubo líneas rechazadas (no se escribió nada) · 2 uso incorrecto.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLabelsFile, planLabelsImport, type LabelsChange } from "../src/lib/call-center/labels-import";

interface Args { file: string; apply: boolean; host?: string; sinDb: boolean }

function usage(msg: string): never {
  console.error(`ERROR: ${msg}`);
  console.error("Uso: npx tsx scripts/import-emozion-labels.ts --file <archivo.jsonl> [--sin-db] [--apply --host <host>]");
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: "", apply: false, sinDb: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i] ?? "";
    else if (a === "--apply") args.apply = true;
    else if (a === "--sin-db") args.sinDb = true;
    else if (a === "--host") args.host = argv[++i];
    else usage(`argumento desconocido: ${a}`);
  }
  if (!args.file) usage("falta --file");
  if (args.apply && args.sinDb) usage("--apply y --sin-db no van juntos");
  if (args.apply && !args.host) usage("--apply requiere --host <host> para confirmar la base");
  return args;
}

const CHUNK = 500;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseLabelsFile(readFileSync(resolve(args.file), "utf8"));

  console.log(`Archivo: ${parsed.rows.length} conversaciones · ${parsed.rejected.length} líneas rechazadas · ${parsed.duplicatedIds} ids repetidos (vale la última línea)`);
  const reasons = new Map<string, number>();
  for (const r of parsed.rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  for (const [reason, n] of reasons) console.log(`  rechazadas · ${reason}: ${n} (primera en la línea ${parsed.rejected.find((r) => r.reason === reason)!.line})`);

  if (args.sinDb) process.exit(parsed.rejected.length > 0 ? 1 : 0);

  const url = process.env.DATABASE_URL;
  if (!url) usage("falta DATABASE_URL");
  const host = new URL(url).hostname;
  console.log(`Base: ${host}`);
  if (args.apply && args.host !== host) usage(`--host ${args.host} no coincide con el host de DATABASE_URL (${host})`);

  const { prisma } = await import("../src/lib/prisma");
  const { loadClosureLabels } = await import("../src/lib/call-center/closure-labels");
  try {
    const closureLabels = await loadClosureLabels();
    console.log(`Etiquetas de cierre en la configuración vigente: ${closureLabels.size}`);

    const existing = [];
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      const ids = parsed.rows.slice(i, i + CHUNK).map((r) => r.externalConversationId);
      const found = await prisma.conversation.findMany({
        where: { externalConversationId: { in: ids } },
        select: { externalConversationId: true, status: true, externalLabels: true, closureTypeName: true },
      });
      for (const c of found) {
        existing.push({ externalConversationId: c.externalConversationId!, resolved: c.status === "RESUELTA", externalLabels: c.externalLabels, closureTypeName: c.closureTypeName });
      }
    }

    const plan = planLabelsImport(parsed.rows, existing, closureLabels);
    const withLabels = plan.changes.filter((c) => c.labels !== null).length;
    const withClosure = plan.changes.filter((c) => c.closureLabel !== null);
    console.log(`No están en la base: ${plan.notFound} · sin cambios: ${plan.unchanged}`);
    console.log(`Cambiarían de etiquetas: ${withLabels} · recibirían resultado de cierre: ${withClosure.length}`);
    const byLabel = new Map<string, number>();
    for (const c of withClosure) byLabel.set(c.closureLabel!, (byLabel.get(c.closureLabel!) ?? 0) + 1);
    for (const [label, n] of [...byLabel].sort((a, b) => b[1] - a[1])) console.log(`  ${label}: ${n}`);

    if (!args.apply) { console.log("DRY-RUN: no se escribió nada."); process.exit(parsed.rejected.length > 0 ? 1 : 0); }
    if (parsed.rejected.length > 0) { console.error("Hay líneas rechazadas: no se escribe nada. Corregí el archivo y volvé a correr."); process.exit(1); }

    let written = 0;
    for (const change of plan.changes) { await applyChange(prisma, change); written++; }
    console.log(`Escritas: ${written} conversaciones.`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Una conversación por transacción: etiquetas y, si corresponde, resultado de cierre en la conversación y en su última fila RESUELTA. */
async function applyChange(prisma: typeof import("../src/lib/prisma").prisma, change: LabelsChange): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.findUnique({
      where: { externalConversationId: change.externalConversationId },
      select: { id: true, status: true, closureTypeName: true },
    });
    if (!conv) return;
    // Se vuelve a mirar dentro de la transacción: si entre el plan y la escritura llegó un evento, manda el evento.
    const closure = change.closureLabel !== null && conv.status === "RESUELTA" && conv.closureTypeName === null ? change.closureLabel : null;
    await tx.conversation.update({
      where: { id: conv.id },
      data: { ...(change.labels !== null ? { externalLabels: change.labels } : {}), ...(closure !== null ? { closureTypeName: closure } : {}) },
    });
    if (closure !== null) {
      const last = await tx.conversationStateHistory.findFirst({
        where: { conversationId: conv.id, toStatus: "RESUELTA" },
        orderBy: [{ changedAt: "desc" }, { id: "desc" }],
        select: { id: true, closureTypeName: true },
      });
      if (last && last.closureTypeName === null) {
        await tx.conversationStateHistory.update({ where: { id: last.id }, data: { closureTypeName: closure } });
      }
    }
  });
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.name : "error"); process.exit(1); });
