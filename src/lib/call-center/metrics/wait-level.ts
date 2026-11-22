/**
 * Semáforo de espera de un caso de "Ahora". PURO.
 *
 * Se mide en minutos HÁBILES del horario público, con los umbrales de la configuración
 * vigente hoy: hasta la meta es "en plazo", hasta la demora crítica es "demorado" y más
 * allá es "crítico".
 *
 * Fuera del horario público el reloj está pausado. Un caso que todavía no pasó la meta NO
 * se muestra en plazo mientras el reloj no corre (tener cero minutos hábiles no es estar
 * bien): queda "fuera del horario público". Uno que ya venía demorado o crítico lo sigue
 * estando: la demora acumulada no se borra al cerrar.
 *
 * Desde cuándo corre el reloj:
 *  - sin primera respuesta: desde la salida del bot (la misma regla de la meta de primera
 *    respuesta); si no está registrada, desde el primer mensaje del cliente sin responder;
 *  - esperando una nueva respuesta: desde el primer mensaje del bloque sin responder.
 *
 * El semáforo no depende de quién tiene asignada la conversación.
 */
import { businessMinutesBetween, isWithinHours, type DayRanges } from "./business-time";
import type { WaitLevel } from "./now-types";

export interface WaitContext {
  /** Horario público y de operadores, con la versión que rige cada día. */
  pub: DayRanges;
  ops: DayRanges;
  /** Meta de primera respuesta, en minutos hábiles. */
  goalMinutes: number;
  /** Desde cuántos minutos hábiles un caso es crítico. */
  criticalMinutes: number;
}

/** PURO. */
export function waitLevel(businessMinutes: number, inPublicHours: boolean, ctx: Pick<WaitContext, "goalMinutes" | "criticalMinutes">): WaitLevel {
  if (businessMinutes > ctx.criticalMinutes) return "CRITICO";
  if (businessMinutes > ctx.goalMinutes) return "DEMORADO";
  return inPublicHours ? "EN_PLAZO" : "FUERA_HORARIO";
}

/** Inicio del reloj hábil de un caso en espera. PURO. */
export function waitClockStart(c: { hasHumanResponse: boolean; botExitAt: Date | null; waitStart: Date }): Date {
  return !c.hasHumanResponse && c.botExitAt ? c.botExitAt : c.waitStart;
}

/** Nivel y minutos hábiles de un caso al momento `now`. PURO. */
export function classifyWait(
  c: { hasHumanResponse: boolean; botExitAt: Date | null; waitStart: Date },
  now: Date,
  ctx: WaitContext,
): { level: WaitLevel; businessMinutes: number } {
  const businessMinutes = businessMinutesBetween(waitClockStart(c), now, ctx.pub);
  return { level: waitLevel(businessMinutes, isWithinHours(now, ctx.pub), ctx), businessMinutes: Math.round(businessMinutes) };
}

/** Estado del horario al momento `now`. PURO. */
export function scheduleState(now: Date, ctx: WaitContext): { inPublicHours: boolean; operatorShiftActive: boolean } {
  const inPublicHours = isWithinHours(now, ctx.pub);
  return { inPublicHours, operatorShiftActive: !inPublicHours && isWithinHours(now, ctx.ops) };
}
