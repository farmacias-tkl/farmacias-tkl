// =============================================================================
// Feriados nacionales de Argentina 2026 (completado el 2026-11-06).
//
// `date` es la fecha efectiva: la de un trasladable ya movido (con la original
// en `originalDate`). Fuentes:
//   Ley 27.399 art. 1°: lista de inamovibles y trasladables.
//   Ley 27.399 art. 6°: martes/miércoles → lunes anterior; jueves/viernes →
//     lunes siguiente.
//   Resolución 164/2025 (Jefatura de Gabinete): días no laborables con fines
//     turísticos (puentes) de 2026.
//
// NO incluye Jueves Santo (día no laborable por ley, no feriado) ni los días no
// laborables solo para quienes profesan cada religión.
// =============================================================================

export interface Holiday {
  /** YYYY-MM-DD, fecha de calendario (sin TZ). */
  date: string;
  name: string;
  /** Trasladable: fecha original, cuando `date` es la fecha ya movida. */
  originalDate?: string;
  /** Norma de la que sale la fecha. */
  source?: string;
  /** Falta el acto oficial que fija la fecha. */
  unconfirmed?: boolean;
}

const INAMOVIBLE = "Ley 27.399 art. 1° (inamovible)";
const MOVIBLE_PASCUA = "Ley 27.399 art. 1° (inamovible); fecha según Pascua 2026 (05/04)";
const TRASLADABLE = "Ley 27.399 arts. 1° y 6° (trasladable)";
const PUENTE = "Resolución 164/2025 JGM (no laborable con fines turísticos)";

export const AR_HOLIDAYS_2026: readonly Holiday[] = [
  { date: "2026-01-01", name: "Año Nuevo", source: INAMOVIBLE },
  { date: "2026-02-16", name: "Carnaval", source: MOVIBLE_PASCUA },
  { date: "2026-02-17", name: "Carnaval", source: MOVIBLE_PASCUA },
  { date: "2026-03-23", name: "Día no laborable con fines turísticos", source: PUENTE },
  { date: "2026-03-24", name: "Día Nacional de la Memoria por la Verdad y la Justicia", source: INAMOVIBLE },
  { date: "2026-04-02", name: "Día del Veterano y de los Caídos en la Guerra de Malvinas", source: INAMOVIBLE },
  { date: "2026-04-03", name: "Viernes Santo", source: MOVIBLE_PASCUA },
  { date: "2026-05-01", name: "Día del Trabajador", source: INAMOVIBLE },
  { date: "2026-05-25", name: "Día de la Revolución de Mayo", source: INAMOVIBLE },
  { date: "2026-06-15", originalDate: "2026-06-17", name: "Paso a la Inmortalidad del Gral. Martín Miguel de Güemes", source: TRASLADABLE },
  { date: "2026-06-20", name: "Paso a la Inmortalidad del Gral. Manuel Belgrano", source: INAMOVIBLE },
  { date: "2026-07-09", name: "Día de la Independencia", source: INAMOVIBLE },
  { date: "2026-07-10", name: "Día no laborable con fines turísticos", source: PUENTE },
  { date: "2026-08-17", name: "Paso a la Inmortalidad del Gral. José de San Martín", source: TRASLADABLE },
  { date: "2026-10-12", name: "Día del Respeto a la Diversidad Cultural", source: TRASLADABLE },
  { date: "2026-11-23", originalDate: "2026-11-20", name: "Día de la Soberanía Nacional", source: TRASLADABLE },
  { date: "2026-12-07", name: "Día no laborable con fines turísticos", source: PUENTE },
  { date: "2026-12-08", name: "Día de la Inmaculada Concepción de María", source: INAMOVIBLE },
  { date: "2026-12-25", name: "Navidad", source: INAMOVIBLE },
];
