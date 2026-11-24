/**
 * Portada de "Ahora": estado general con su motivo y los cierres de hoy. PURO.
 *
 * El estado tiene tres niveles y siempre lleva el motivo escrito: el color solo no dice nada.
 * Los históricos por verificar no cambian el color.
 */
import type { ClosureOutcome } from "./config-schema";
import type { ClosureMap } from "./closure-outcome";

export type CoverLevel = "ATENCION" | "REVISAR" | "AL_DIA";

/** Los conteos de atención actual que deciden el estado. null = no se pudo calcular. */
export interface CoverInput {
  criticalCurrent: number | null;
  urgent: number;
  closing: number;
  completedOrders: number;
  insisting: number;
}

export interface CoverStatus {
  level: CoverLevel;
  /** Motivos, del más grave al menos. Vacío cuando está al día. */
  reasons: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Rojo: hay demoras críticas de atención actual o posibles urgencias. Naranja: ventanas por
 * vencer, pedidos completos sin primera respuesta o clientes insistiendo. Verde: nada de eso.
 * Si hay rojo, los motivos naranjas se listan después.
 */
export function coverStatus(c: CoverInput): CoverStatus {
  const red: string[] = [];
  const orange: string[] = [];
  if (c.criticalCurrent) red.push(plural(c.criticalCurrent, "caso en demora crítica", "casos en demora crítica"));
  if (c.urgent) red.push(plural(c.urgent, "posible urgencia", "posibles urgencias"));
  if (c.completedOrders) orange.push(plural(c.completedOrders, "pedido completo sin primera respuesta", "pedidos completos sin primera respuesta"));
  if (c.closing) orange.push(plural(c.closing, "ventana de WhatsApp por vencer", "ventanas de WhatsApp por vencer"));
  if (c.insisting) orange.push(plural(c.insisting, "cliente insistiendo", "clientes insistiendo"));
  if (red.length) return { level: "ATENCION", reasons: [...red, ...orange] };
  if (orange.length) return { level: "REVISAR", reasons: orange };
  return { level: "AL_DIA", reasons: [] };
}

/** Parte mínima de los cierres de hoy con tipo para leer el bloque "Hoy" sin aviso. */
export const TODAY_CLOSURES_MIN_COVERAGE = 0.5;

/** Cierres de hoy por resultado. Solo los que tienen tipo de cierre cuentan en los grupos. */
export interface TodayClosures {
  /** Conversaciones resueltas hoy (una por conversación, por su último cierre del día). */
  closed: number;
  /** De esas, las que tienen un tipo de cierre reconocido por la configuración. */
  typed: number;
  sales: number;
  queries: number;
  /** No concretadas: el cliente no siguió, y sin stock o no lo trabajamos. No se suman a "ventas perdidas". */
  notCompleted: { customerLeft: number; noStockOrNotCarried: number };
  /** Con tipo, pero de otro resultado (solo bot, otro). */
  other: number;
  /** typed / closed es menor que TODAY_CLOSURES_MIN_COVERAGE: dato parcial. false sin cierres. */
  lowCoverage: boolean;
}

/** Un cierre de hoy: el nombre del tipo de cierre que guardó la ingesta, o null si no tiene. */
export interface TodayClosureRow { closureTypeName: string | null }

export function buildTodayClosures(rows: readonly TodayClosureRow[], map: ClosureMap): TodayClosures {
  const by: Partial<Record<ClosureOutcome, number>> = {};
  let typed = 0;
  for (const r of rows) {
    const outcome = r.closureTypeName !== null ? map.get(r.closureTypeName) : undefined;
    if (!outcome) continue;
    typed++;
    by[outcome] = (by[outcome] ?? 0) + 1;
  }
  const n = (o: ClosureOutcome) => by[o] ?? 0;
  return {
    closed: rows.length,
    typed,
    sales: n("VENTA"),
    queries: n("CONSULTA"),
    notCompleted: { customerLeft: n("PEDIDO_NO_CONCRETADO"), noStockOrNotCarried: n("SIN_STOCK") + n("NO_LO_TRABAJAMOS") },
    other: n("SOLO_BOT") + n("OTRO"),
    lowCoverage: rows.length > 0 && typed / rows.length < TODAY_CLOSURES_MIN_COVERAGE,
  };
}
