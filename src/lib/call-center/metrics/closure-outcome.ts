/**
 * Resultado de cierre de una conversación: lo que el operador eligió al resolver, que Emozion
 * deja como etiqueta. Es un dato CONFIRMADO por el operador, a diferencia de la clasificación
 * propia de "Tipos", que es DETECTADA por palabras. PURO, sin imports de servidor.
 *
 * Cuáles etiquetas son de cierre y a qué resultado corresponde cada una lo dice la
 * configuración (closureLabels). El resultado vale solo mientras la conversación está
 * resuelta: una reapertura lo deja sin efecto.
 */
import type { CallCenterMetricsConfigData, ClosureOutcome } from "./config-schema";

export type ClosureMap = ReadonlyMap<string, ClosureOutcome>;

/** Mapa etiqueta → resultado de una versión de la configuración. Vacío si no tiene el campo. */
export function closureMapOf(data: Pick<CallCenterMetricsConfigData, "closureLabels"> | null | undefined): ClosureMap {
  return new Map((data?.closureLabels ?? []).map((c) => [c.label, c.outcome]));
}

export interface ClosureSource {
  /** La conversación está resuelta. */
  resolved: boolean;
  /** Resultado que guardó la ingesta al resolver (la etiqueta de cierre); null si no guardó ninguno. */
  closureTypeName: string | null;
  /** Etiquetas actuales de la conversación. */
  labels: readonly string[];
}

/**
 * Etiqueta de cierre y resultado de una conversación; null si no está resuelta o no tiene
 * etiqueta de cierre. Usa primero el resultado que guardó la ingesta; si no hay (por ejemplo,
 * la etiqueta llegó antes de que la configuración la definiera como de cierre), la última
 * etiqueta de cierre entre las de la conversación.
 */
export function closureOutcomeOf(c: ClosureSource, map: ClosureMap): { label: string; outcome: ClosureOutcome } | null {
  if (!c.resolved || map.size === 0) return null;
  if (c.closureTypeName !== null) {
    const outcome = map.get(c.closureTypeName);
    if (outcome) return { label: c.closureTypeName, outcome };
  }
  for (let i = c.labels.length - 1; i >= 0; i--) {
    const outcome = map.get(c.labels[i]);
    if (outcome) return { label: c.labels[i], outcome };
  }
  return null;
}
