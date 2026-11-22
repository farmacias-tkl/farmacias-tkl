/**
 * Horarios del Call Center listos para medir: el vigente cada día según la configuración,
 * sin franjas en los feriados nacionales (src/lib/holidays). PURO.
 *
 * Feriados: se usa la lista nacional que ya tiene la plataforma. Un año sin lista cargada
 * se trata como sin feriados (getHolidayByISO devuelve null). Las excepciones propias del
 * Call Center (cierres puntuales, horarios especiales) quedan para una versión posterior.
 */
import { getHolidayByISO } from "@/lib/holidays";
import { dayRangesFromConfig, type DayRanges } from "./business-time";
import type { ConfigVersion } from "./config";

const isNationalHoliday = (dayISO: string): boolean => getHolidayByISO(dayISO) !== null;

/** Horario público: el que se le informa al cliente. Sobre este corre la meta. */
export function publicHours(versions: readonly ConfigVersion[]): DayRanges {
  return dayRangesFromConfig(versions, (d) => d.publicHours, isNationalHoliday);
}

/** Horario de operadores: para medir la actividad fuera del horario público. */
export function operatorHours(versions: readonly ConfigVersion[]): DayRanges {
  return dayRangesFromConfig(versions, (d) => d.operatorHours, isNationalHoliday);
}
