/**
 * Tests PUROS del saldo de vacaciones (balance.ts). Datos sintéticos, sin DB.
 *
 *   npx tsx src/lib/personal/balance.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { applyAllocations, planConsumption, planRefund, previewBalance } from "./balance";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SALDO = [
  { year: 2025, days: 14 },
  { year: 2023, days: 5 },
  { year: 2024, days: 10 },
  { year: 2026, days: 21 },
];

console.log("\nConsumo: año más viejo primero");
{
  const p = planConsumption(SALDO, 3, 2026);
  assert("3 días salen todos de 2023", eq(p.allocations, [{ year: 2023, days: 3 }]) && p.shortfall === 0);
}
{
  const p = planConsumption(SALDO, 21, 2026);
  assert("21 días: 2023 (5) + 2024 (10) + 2025 (6), varios años", eq(p.allocations, [
    { year: 2023, days: 5 }, { year: 2024, days: 10 }, { year: 2025, days: 6 },
  ]));
  const after = applyAllocations(SALDO, p.allocations, -1);
  assert("después: 2023=0, 2024=0, 2025=8, 2026=21", eq(after, [
    { year: 2023, days: 0 }, { year: 2024, days: 0 }, { year: 2025, days: 8 }, { year: 2026, days: 21 },
  ]));
}
{
  const p = planConsumption([{ year: 2023, days: 0 }, { year: 2024, days: 7 }], 7, 2026);
  assert("un año en 0 se saltea", eq(p.allocations, [{ year: 2024, days: 7 }]));
}

console.log("\nSolicitud que supera el saldo");
{
  const p = planConsumption([{ year: 2024, days: 4 }, { year: 2025, days: 3 }], 14, 2026);
  assert("faltan 7 días", p.shortfall === 7);
  assert("el excedente queda en el año más nuevo con saldo (2025)", eq(p.allocations, [
    { year: 2024, days: 4 }, { year: 2025, days: 10 },
  ]));
  const prev = previewBalance([{ year: 2024, days: 4 }, { year: 2025, days: 3 }], 14, 2026);
  assert("preview: insuficiente, total 7 → -7", prev.insufficient && prev.total === 7 && prev.totalAfter === -7);
}

console.log("\nPersona sin saldo");
{
  const p = planConsumption([], 7, 2026);
  assert("sin años: todo al año de inicio de la solicitud, negativo", eq(p.allocations, [{ year: 2026, days: 7 }]) && p.shortfall === 7);
  const prev = previewBalance([], 7, 2026);
  assert("preview sin saldo: total 0, insuficiente, no rompe", prev.total === 0 && prev.insufficient && prev.byYear.length === 0);
  const zero = previewBalance([], 0, 2026);
  assert("sin saldo y 0 días: no es insuficiente", !zero.insufficient);
}

console.log("\nDevolución a los mismos años");
{
  const consumed = planConsumption(SALDO, 21, 2026).allocations.map((a) => ({ year: a.year, days: -a.days }));
  const refund = planRefund(consumed);
  assert("devuelve 5/10/6 a 2023/2024/2025", eq(refund, [
    { year: 2023, days: 5 }, { year: 2024, days: 10 }, { year: 2025, days: 6 },
  ]));
  const back = applyAllocations(applyAllocations(SALDO, planConsumption(SALDO, 21, 2026).allocations, -1), refund, 1);
  assert("consumir y devolver deja el saldo como estaba", eq(back, [...SALDO].sort((a, b) => a.year - b.year)));
  assert("una segunda devolución no devuelve nada (neto 0)", planRefund([...consumed, ...refund]).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
