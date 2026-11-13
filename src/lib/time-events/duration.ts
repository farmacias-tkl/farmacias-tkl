// =============================================================================
// Duraciones en horas y minutos. Lógica pura, usable en cliente y servidor.
//
// Asistencia guarda minutos (enteros) y el banco de horas guarda horas con dos
// decimales. En pantalla, las dos cosas se leen igual: "5 h 30 min", "45 min"
// si es menos de una hora, "2 h" si no hay minutos sueltos.
// =============================================================================

/** 330 → "5 h 30 min" · 45 → "45 min" · 120 → "2 h" · 0 → "0 min" · -90 → "-1 h 30 min". */
export function fmtMinutes(minutes: number | null | undefined): string {
  const total = Math.round(Number(minutes ?? 0));
  if (!Number.isFinite(total) || total === 0) return "0 min";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const body = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return total < 0 ? `-${body}` : body;
}

/** Horas con decimales (banco de horas) → mismo formato. 7.5 → "7 h 30 min". */
export function fmtHoursAsHM(hours: number | null | undefined): string {
  return fmtMinutes(Math.round(Number(hours ?? 0) * 60));
}

/** 330 → { hours: 5, minutes: 30 }. Para precargar un formulario. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.round(total));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

/**
 * Lo que se escribió en un formulario de horas y minutos → minutos totales.
 * Vacío cuenta como 0. null = no es un número entero válido (o es negativo).
 * Acepta más de 59 en minutos (90 min = 1 h 30 min): es lo que la persona quiso decir.
 */
export function joinHM(hours: string | number | null | undefined, minutes: string | number | null | undefined): number | null {
  const parse = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined) return 0;
    const s = String(v).trim();
    if (s === "") return 0;
    if (!/^\d+$/.test(s)) return null;
    return parseInt(s, 10);
  };
  const h = parse(hours);
  const m = parse(minutes);
  if (h === null || m === null) return null;
  return h * 60 + m;
}
