import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getTemplate } from "../src/lib/action-plan-templates";
import { evaluateForm } from "../src/lib/action-plan-templates/compliance";

const prisma = new PrismaClient();

async function main() {
  const forms = await prisma.actionPlanForm.findMany();
  console.log(`Forms encontrados: ${forms.length}\n`);

  let changedScores = 0;

  for (const f of forms) {
    const sections = getTemplate(f.templateType);
    const c = evaluateForm(f.formData as Record<string, unknown>, sections);

    const oldScore = f.generalScore;
    const oldRatio = f.complianceRatio;
    const oldRatioStr = oldRatio == null ? "NULL" : `${Math.round(oldRatio * 100)}%`;
    const newRatioStr = `${Math.round(c.ratio * 100)}%`;
    const scoreChanged = oldScore !== c.generalScore;
    if (scoreChanged) changedScores++;

    console.log(
      `${f.id}` +
      `  score: ${oldScore} -> ${c.generalScore}${scoreChanged ? "  <-- CAMBIO" : ""}` +
      `  ratio: ${oldRatioStr} -> ${newRatioStr}` +
      `  (${c.favorableCount}/${c.totalItems} = ${(c.ratio * 100).toFixed(1)}%)`,
    );

    await prisma.actionPlanForm.update({
      where: { id: f.id },
      data: { complianceRatio: c.ratio, generalScore: c.generalScore },
    });
  }

  console.log(
    `\nListo. ${forms.length} forms actualizados. ` +
    `Scores que cambiaron: ${changedScores}.`,
  );
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
