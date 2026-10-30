// =============================================================================
// Saldo de vacaciones (días corridos, por año). Lógica pura.
//
// Consumo: siempre del año más viejo primero (2023 → 2024 → …). Si la
// solicitud supera el saldo, se aprueba igual (es una advertencia) y el
// excedente queda en negativo en el año más nuevo con saldo cargado; si la
// persona no tiene ningún año, en el año de inicio de la solicitud.
//
// Devolución: sale de los movimientos de la solicitud (CONSUME + REFUND
// previos), así los días vuelven exactamente a los años de donde salieron.
// =============================================================================

export interface BalanceYear {
  year: number;
  days: number;
}

export interface Allocation {
  year: number;
  days: number; // días tomados de ese año (positivo)
}

export interface ConsumptionPlan {
  allocations: Allocation[];
  /** Días que no alcanzó a cubrir el saldo (0 si alcanzó). */
  shortfall: number;
}

export function totalDays(balances: BalanceYear[]): number {
  return balances.reduce((acc, b) => acc + b.days, 0);
}

export function planConsumption(balances: BalanceYear[], days: number, fallbackYear: number): ConsumptionPlan {
  const sorted = [...balances].sort((a, b) => a.year - b.year);
  const allocations: Allocation[] = [];
  let remaining = days;
  for (const b of sorted) {
    if (remaining <= 0) break;
    if (b.days <= 0) continue;
    const take = Math.min(b.days, remaining);
    allocations.push({ year: b.year, days: take });
    remaining -= take;
  }
  const shortfall = Math.max(0, remaining);
  if (shortfall > 0) {
    const year = sorted.length ? sorted[sorted.length - 1].year : fallbackYear;
    const existing = allocations.find((a) => a.year === year);
    if (existing) existing.days += shortfall;
    else allocations.push({ year, days: shortfall });
  }
  return { allocations, shortfall };
}

/** Movimientos (con signo) de una solicitud → días a devolver por año. */
export function planRefund(movements: Array<{ year: number; days: number }>): Allocation[] {
  const net = new Map<number, number>();
  for (const m of movements) net.set(m.year, (net.get(m.year) ?? 0) + m.days);
  return [...net.entries()]
    .filter(([, d]) => d < 0)
    .map(([year, d]) => ({ year, days: -d }))
    .sort((a, b) => a.year - b.year);
}

/** Saldos después de aplicar un consumo (sign=-1) o una devolución (sign=+1). */
export function applyAllocations(balances: BalanceYear[], allocations: Allocation[], sign: 1 | -1): BalanceYear[] {
  const map = new Map(balances.map((b) => [b.year, b.days]));
  for (const a of allocations) map.set(a.year, (map.get(a.year) ?? 0) + sign * a.days);
  return [...map.entries()].map(([year, days]) => ({ year, days })).sort((a, b) => a.year - b.year);
}

export interface BalancePreview {
  byYear: BalanceYear[];
  total: number;
  requested: number;
  allocations: Allocation[];
  after: BalanceYear[];
  totalAfter: number;
  insufficient: boolean;
}

/** Lo que se muestra al solicitar / validar / aprobar: saldo actual y cómo quedaría. */
export function previewBalance(balances: BalanceYear[], requested: number, fallbackYear: number): BalancePreview {
  const byYear = [...balances].sort((a, b) => a.year - b.year);
  const plan = planConsumption(byYear, requested, fallbackYear);
  const after = applyAllocations(byYear, plan.allocations, -1);
  return {
    byYear,
    total: totalDays(byYear),
    requested,
    allocations: plan.allocations,
    after,
    totalAfter: totalDays(after),
    insufficient: plan.shortfall > 0,
  };
}
