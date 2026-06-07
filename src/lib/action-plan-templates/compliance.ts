import type { ItemPolarity, TemplateSection } from "./mostrador";

export type Answer = "SI" | "NO";

export type GeneralScore = "NECESITA_MEJORAR" | "BUENO" | "EXCELENTE";

export interface EvaluatedItem {
  id: string;
  label: string;
  polarity: ItemPolarity;
  answer: Answer;
  favorable: boolean;
}

export interface ComplianceResult {
  items: EvaluatedItem[];
  favorableCount: number;
  totalItems: number;
  ratio: number;
  generalScore: GeneralScore;
}

function isFavorable(polarity: ItemPolarity, answer: Answer): boolean {
  return polarity === "POSITIVE" ? answer === "SI" : answer === "NO";
}

export function scoreFromRatio(ratio: number): GeneralScore {
  if (ratio >= 0.95) return "EXCELENTE";
  if (ratio >= 0.81) return "BUENO";
  return "NECESITA_MEJORAR";
}

/**
 * Pure. Assumes formData is COMPLETE: every template item must have a valid
 * "SI"/"NO" answer. If any item is missing or invalid, throws — we never compute
 * a ratio over incomplete data, because this number lands on a signed PDF.
 */
export function evaluateForm(
  formData: Record<string, unknown>,
  sections: TemplateSection[],
): ComplianceResult {
  const items: EvaluatedItem[] = [];

  for (const section of sections) {
    for (const item of section.items) {
      const answer = formData[item.id];
      if (answer !== "SI" && answer !== "NO") {
        throw new Error(
          `Respuesta inválida o faltante para el ítem "${item.id}": se esperaba "SI" o "NO", se recibió ${JSON.stringify(answer)}.`,
        );
      }
      items.push({
        id: item.id,
        label: item.label,
        polarity: item.polarity,
        answer,
        favorable: isFavorable(item.polarity, answer),
      });
    }
  }

  const totalItems = items.length;
  const favorableCount = items.filter(i => i.favorable).length;
  const ratio = totalItems === 0 ? 0 : favorableCount / totalItems;

  return {
    items,
    favorableCount,
    totalItems,
    ratio,
    generalScore: scoreFromRatio(ratio),
  };
}
