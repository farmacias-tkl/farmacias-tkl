// =============================================================================
// Helpers de calendario sin dependencias externas.
//
// Convención: semana arranca lunes (cultura argentina).
// Todas las fechas se manejan en zona local del servidor/cliente.
// =============================================================================

/** Devuelve un Date al inicio del día (00:00:00) en zona local. */
export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Suma n meses (n puede ser negativo). Preserva el día cuando es posible. */
export function addMonths(d: Date, n: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
}

/** Suma n días (puede ser negativo). */
export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Primer día del mes (00:00:00). */
export function startOfMonth(d: Date): Date {
  const c = new Date(d);
  c.setDate(1);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Último día del mes (23:59:59.999). */
export function endOfMonth(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return c;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate()  === b.getDate();
}

/** Día de la semana con lunes = 0 ... domingo = 6. */
export function mondayBasedDay(d: Date): number {
  const w = d.getDay(); // 0 = dom, 1 = lun ... 6 = sab
  return (w + 6) % 7;
}

/**
 * Devuelve la grilla 7×N para un mes dado (típicamente 5 o 6 semanas).
 * Incluye días del mes anterior y siguiente para llenar la primera y
 * última semana. Semana arranca lunes.
 */
export function getMonthGrid(year: number, month0: number): Date[][] {
  const first = new Date(year, month0, 1);
  const last  = new Date(year, month0 + 1, 0);
  const gridStart = addDays(first, -mondayBasedDay(first));
  // Cantidad de filas necesarias: cubrir desde gridStart hasta el último día.
  const daysSpan = Math.ceil((last.getTime() - gridStart.getTime()) / 86_400_000) + 1;
  const weeks = Math.ceil(daysSpan / 7);
  const grid: Date[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: Date[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(addDays(gridStart, w * 7 + i));
    }
    grid.push(row);
  }
  return grid;
}

const MONTH_LONG = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function formatMonthLong(d: Date): string {
  return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export const WEEKDAY_LABELS_SHORT = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

/** YYYY-MM-DD a partir de componentes locales (no UTC). */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ¿Esta fecha cae dentro del rango [start, end] inclusive? */
export function dateInRange(d: Date, start: Date, end: Date): boolean {
  const t = startOfDay(d).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}
