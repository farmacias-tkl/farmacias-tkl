// =============================================================================
// Vencimiento de planes de acción. El plazo es una fecha de solo día y el día
// del plazo todavía no está vencido: vence al empezar el día siguiente en
// Argentina. Los estados terminales nunca figuran vencidos.
// =============================================================================

import type { Prisma } from "@prisma/client";
import { todayAR } from "@/lib/dates/today";
import { utcDay } from "@/lib/personal/dates";

const TERMINAL = ["COMPLETED", "CLOSED", "CANCELLED"] as const;

export function isActionPlanOverdue(
  plan: { deadline: Date | string; status: string },
  now: Date = new Date(),
): boolean {
  return utcDay(new Date(plan.deadline)) < todayAR(now) && !(TERMINAL as readonly string[]).includes(plan.status);
}

/** El mismo criterio como filtro de Prisma, para contar. */
export function actionPlanOverdueWhere(now: Date = new Date()): Prisma.ActionPlanWhereInput {
  return { deadline: { lt: todayAR(now) }, status: { notIn: [...TERMINAL] } };
}
