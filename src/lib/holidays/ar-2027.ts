// =============================================================================
// Feriados nacionales de Argentina 2027 (consultado el 2026-11-06).
//
// `date` es la fecha efectiva: la de un trasladable ya movido (con la original
// en `originalDate`). Fuentes:
//   Ley 27.399 art. 1°: lista de inamovibles y trasladables.
//   Ley 27.399 art. 6°: martes/miércoles → lunes anterior; jueves/viernes →
//     lunes siguiente. Las fechas efectivas salen de aplicar esta regla.
//   Decreto 614/2025 art. 1°: sábado/domingo → viernes anterior o lunes
//     siguiente, según lo determine la Jefatura de Gabinete.
//
// `unconfirmed`: falta el acto oficial que fija la fecha. Hoy solo el 20/11.
//
// NO incluye:
//   - Puentes turísticos (Ley 27.399 art. 7°): todavía no hay norma publicada
//     para 2027. Agregarlos cuando salga.
//   - Jueves Santo (25/03): por ley es día no laborable, no feriado.
// =============================================================================

import type { Holiday } from "./ar-2026";

const INAMOVIBLE = "Ley 27.399 art. 1° (inamovible)";
const MOVIBLE_PASCUA = "Ley 27.399 art. 1° (inamovible); fecha según Pascua 2027 (28/03)";
const TRASLADABLE = "Ley 27.399 arts. 1° y 6° (trasladable)";

export const AR_HOLIDAYS_2027: readonly Holiday[] = [
  { date: "2027-01-01", name: "Año Nuevo", source: INAMOVIBLE },
  { date: "2027-02-08", name: "Carnaval", source: MOVIBLE_PASCUA },
  { date: "2027-02-09", name: "Carnaval", source: MOVIBLE_PASCUA },
  { date: "2027-03-24", name: "Día Nacional de la Memoria por la Verdad y la Justicia", source: INAMOVIBLE },
  { date: "2027-03-26", name: "Viernes Santo", source: MOVIBLE_PASCUA },
  { date: "2027-04-02", name: "Día del Veterano y de los Caídos en la Guerra de Malvinas", source: INAMOVIBLE },
  { date: "2027-05-01", name: "Día del Trabajador", source: INAMOVIBLE },
  { date: "2027-05-25", name: "Día de la Revolución de Mayo", source: INAMOVIBLE },
  { date: "2027-06-20", name: "Paso a la Inmortalidad del Gral. Manuel Belgrano", source: INAMOVIBLE },
  { date: "2027-06-21", originalDate: "2027-06-17", name: "Paso a la Inmortalidad del Gral. Martín Miguel de Güemes", source: TRASLADABLE },
  { date: "2027-07-09", name: "Día de la Independencia", source: INAMOVIBLE },
  { date: "2027-08-16", originalDate: "2027-08-17", name: "Paso a la Inmortalidad del Gral. José de San Martín", source: TRASLADABLE },
  { date: "2027-10-11", originalDate: "2027-10-12", name: "Día del Respeto a la Diversidad Cultural", source: TRASLADABLE },
  // Cae sábado: la fecha efectiva (viernes 19 o lunes 22) la fija la Jefatura de
  // Gabinete. Queda la fecha de ley hasta que salga; cuando salga, corregirla.
  { date: "2027-11-20", name: "Día de la Soberanía Nacional", source: "Ley 27.399 art. 1° y Decreto 614/2025 art. 1° (trasladable, sin fecha efectiva fijada)", unconfirmed: true },
  { date: "2027-12-08", name: "Día de la Inmaculada Concepción de María", source: INAMOVIBLE },
  { date: "2027-12-25", name: "Navidad", source: INAMOVIBLE },
];
