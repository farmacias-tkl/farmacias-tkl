/**
 * Semáforo de espera de un caso de "Ahora". PURO.
 *
 * Se mide en minutos HÁBILES del horario público, con los umbrales de la configuración
 * vigente hoy: hasta la meta es "en plazo", hasta la demora crítica es "demorado" y más
 * allá es "crítico".
 *
 * Un caso es crítico, además, cuando su ventana de WhatsApp está cerrada: pasaron 24 horas o
 * más de reloj desde el último mensaje del cliente sin respuesta de un operador. Esa
 * condición vale aunque el reloj hábil esté pausado o sume pocos minutos (entró un sábado al
 * mediodía: 7 minutos hábiles y 36 horas reales). La aplica now.ts con whatsapp-window.ts.
 *
 * Fuera del horario público el reloj hábil está pausado, pero el caso conserva el color que
 * le corresponde por lo acumulado: la demora no se borra al cerrar. Que el reloj esté
 * pausado se informa al lado, como texto, no en lugar del color.
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
  /** Horas antes del cierre de la ventana de WhatsApp desde las que un caso está "por vencer". */
  windowWarningHours?: number;
  /** Minutos sin respuesta de un operador desde los que se muestra el aviso "para revisar". */
  lastResponseWarningMinutes?: number;
  /**
   * Primer día ("YYYY-MM-DD") con configuración de horarios. Antes de ese día no hay horario
   * cargado y el reloj hábil no corre: el tiempo hábil de una espera que empezó antes cuenta
   * solo desde acá.
   */
  coveredFrom?: string;
}

/** PURO. */
export function waitLevel(businessMinutes: number, ctx: Pick<WaitContext, "goalMinutes" | "criticalMinutes">): WaitLevel {
  if (businessMinutes > ctx.criticalMinutes) return "CRITICO";
  if (businessMinutes > ctx.goalMinutes) return "DEMORADO";
  return "EN_PLAZO";
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
  return { level: waitLevel(businessMinutes, ctx), businessMinutes: Math.round(businessMinutes) };
}

/** Estado del horario al momento `now`. PURO. */
export function scheduleState(now: Date, ctx: WaitContext): { inPublicHours: boolean; operatorShiftActive: boolean } {
  const inPublicHours = isWithinHours(now, ctx.pub);
  return { inPublicHours, operatorShiftActive: !inPublicHours && isWithinHours(now, ctx.ops) };
}
