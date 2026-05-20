// =============================================================================
// Feriados nacionales fijos de Argentina 2026.
//
// Solo incluye feriados cuya fecha es FIJA por ley (no trasladable).
//
// TODO: No incluye los siguientes — agregar cuando se requieran:
//   - Trasladables (Ley 27.399): 17/Jun San Martín, 17/Ago Güemes,
//     12/Oct Diversidad Cultural, 20/Nov Soberanía Nacional. Estos pueden
//     mudarse al lunes adyacente según el calendario que publica el ejecutivo.
//   - Movibles por calendario lunar/litúrgico: Carnaval (lun+mar antes de
//     miércoles de ceniza), Viernes Santo.
//   - Puentes turísticos: los fija el ejecutivo anualmente por decreto.
//
// Cuando el dataset crezca o se requieran fechas dinámicas, migrar a:
//   - Tabla DB `Holiday(date, name, year, type)`, o
//   - API externa (ej. nolaborables.com.ar) con cache local.
// =============================================================================

export interface Holiday {
  /** YYYY-MM-DD en zona local (sin TZ). */
  date: string;
  name: string;
}

export const AR_HOLIDAYS_2026: readonly Holiday[] = [
  { date: "2026-01-01", name: "Año Nuevo" },
  { date: "2026-03-24", name: "Día Nacional de la Memoria por la Verdad y la Justicia" },
  { date: "2026-04-02", name: "Día del Veterano y de los Caídos en la Guerra de Malvinas" },
  { date: "2026-05-01", name: "Día del Trabajador" },
  { date: "2026-05-25", name: "Día de la Revolución de Mayo" },
  { date: "2026-06-20", name: "Paso a la Inmortalidad del Gral. Manuel Belgrano" },
  { date: "2026-07-09", name: "Día de la Independencia" },
  { date: "2026-12-08", name: "Día de la Inmaculada Concepción de María" },
  { date: "2026-12-25", name: "Navidad" },
];
