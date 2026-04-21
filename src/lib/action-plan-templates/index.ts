import { MOSTRADOR_TEMPLATE, type TemplateSection } from "./mostrador";

export type { TemplateItem, TemplateSection } from "./mostrador";

export const TEMPLATES: Record<string, TemplateSection[]> = {
  MOSTRADOR: MOSTRADOR_TEMPLATE,
};

export function getTemplate(type: string): TemplateSection[] {
  return TEMPLATES[type] ?? MOSTRADOR_TEMPLATE;
}
