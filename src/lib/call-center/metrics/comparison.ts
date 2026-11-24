/**
 * ¿Una comparación entre dos períodos se puede leer como "mejor" o "peor"? PURO.
 *
 * Regla general del dashboard: sin flecha ni color cuando la muestra es chica o cuando los
 * dos lados no son comparables. Una mediana sobre dos respuestas describe esas dos respuestas,
 * no cómo viene el día; y un día sin horario público no se compara con uno con atención
 * programada como si fueran lo mismo. En esos casos los números se muestran igual, sin
 * interpretarlos.
 */

/** Respondidas mínimas, de cada lado, para leer una mediana o un porcentaje como tendencia. */
export const COMPARISON_MIN_ANSWERED = 20;
/** Parte mínima de las entradas que tiene que estar respondida, de cada lado. */
export const COMPARISON_MIN_ANSWERED_SHARE = 0.5;

/** Un lado de la comparación: cuántas entraron y cuántas ya tienen respuesta. */
export interface ComparisonSide {
  entries: number;
  answered: number;
  /** ¿El día tiene horario público? null si no se sabe. */
  hasPublicHours?: boolean | null;
}

export type ComparisonVerdict =
  | { kind: "OK" }
  /** `side` dice qué lado tiene la muestra chica: el de hoy manda en el texto. */
  | { kind: "SMALL_SAMPLE"; side: "today" | "previous"; answered: number; entries: number }
  | { kind: "DIFFERENT_SCHEDULE" };

const small = (s: ComparisonSide) =>
  s.answered < COMPARISON_MIN_ANSWERED || s.entries <= 0 || s.answered / s.entries < COMPARISON_MIN_ANSWERED_SHARE;

/**
 * Veredicto de una comparación de tiempos o porcentajes calculados sobre las respondidas.
 * Primero la muestra (la de hoy antes que la anterior); después el horario.
 */
export function comparisonVerdict(today: ComparisonSide, previous: ComparisonSide): ComparisonVerdict {
  if (small(today)) return { kind: "SMALL_SAMPLE", side: "today", answered: today.answered, entries: today.entries };
  if (small(previous)) return { kind: "SMALL_SAMPLE", side: "previous", answered: previous.answered, entries: previous.entries };
  if (!sameSchedule(today, previous)) return { kind: "DIFFERENT_SCHEDULE" };
  return { kind: "OK" };
}

/** ¿Los dos días tienen la misma condición de horario público? Sin dato de alguno, se asume que sí. */
export function sameSchedule(today: ComparisonSide, previous: ComparisonSide): boolean {
  if (today.hasPublicHours == null || previous.hasPublicHours == null) return true;
  return today.hasPublicHours === previous.hasPublicHours;
}

/** Texto del aviso que reemplaza a la flecha. null cuando la comparación se puede interpretar. */
export function comparisonNote(v: ComparisonVerdict): string | null {
  if (v.kind === "OK") return null;
  if (v.kind === "DIFFERENT_SCHEDULE") return "Los dos días no son comparables: uno tiene horario público y el otro no. Se muestran los números sin interpretarlos.";
  const n = `${v.answered} ${v.answered === 1 ? "conversación respondida" : "conversaciones respondidas"} de ${v.entries}`;
  return v.side === "today"
    ? `Muestra pequeña: ${n}. No permite concluir una mejora general.`
    : `Muestra pequeña en el día de comparación: ${n}. No permite concluir una mejora general.`;
}
