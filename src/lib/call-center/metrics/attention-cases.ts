/**
 * Detalle de casos de "Atención y demoras": la lista de conversaciones que hay detrás de
 * tres indicadores por entrada.
 *
 *  - pending: sin primera respuesta de una persona;
 *  - overdue: sin primera respuesta y con la meta ya vencida;
 *  - unanswered_same_day: no recibieron respuesta el mismo día en que entraron (incluye las
 *    que se respondieron otro día).
 *
 * Se arma con las mismas filas y la misma clasificación que el informe (attention.ts): un
 * caso está en la lista si y solo si cuenta en el número. Cada fila lleva el id interno (para
 * el enlace), horas y etiquetas; nunca teléfono, nombre ni texto.
 *
 * selectCases y toAttentionCases son PUROS.
 */
import { prisma } from "@/lib/prisma";
import { loadEntryRows, toEntryFact, type EntryFact } from "./attention";
import { arDayISO } from "./business-time";
import { configForDay, loadConfigVersions } from "./config";
import type { ConfigAccount } from "./config-schema";
import { ownerOf } from "./now";
import { publicHours } from "./schedule";
import type { AttentionCase, AttentionCaseKind, AttentionCasesPayload } from "./attention-types";

export const ATTENTION_CASES_MAX_ROWS = 200;
const MS_MIN = 60_000;

export const ATTENTION_CASE_KINDS: readonly AttentionCaseKind[] = ["pending", "overdue", "unanswered_same_day"];

export function isAttentionCaseKind(v: unknown): v is AttentionCaseKind {
  return typeof v === "string" && (ATTENTION_CASE_KINDS as readonly string[]).includes(v);
}

/** Las conversaciones que cuentan en cada indicador, con la regla del informe. PURO. */
export function selectCases(facts: readonly EntryFact[], kind: AttentionCaseKind): EntryFact[] {
  if (kind === "pending") return facts.filter((f) => !f.firstHumanAt);
  if (kind === "overdue") return facts.filter((f) => f.goal?.group === "PENDING_OVERDUE");
  return facts.filter((f) => !f.answeredSameDay);
}

/** Estado y cuenta asignada actuales de una conversación: solo para las etiquetas. */
export interface CaseState { status: string; externalAssigneeId: string | null }

/** Filas de la lista, de la espera más vieja a la más nueva. PURO. */
export function toAttentionCases(
  facts: readonly EntryFact[],
  now: Date,
  states: ReadonlyMap<string, CaseState>,
  accounts: readonly ConfigAccount[],
): AttentionCase[] {
  return [...facts]
    .sort((a, b) => a.clockStart.getTime() - b.clockStart.getTime())
    .map((f) => {
      const st = states.get(f.conversationId);
      const end = f.firstHumanAt ?? now;
      return {
        conversationId: f.conversationId,
        createdAt: f.createdAt.toISOString(),
        clockStart: f.clockStart.toISOString(),
        answeredAt: f.firstHumanAt ? f.firstHumanAt.toISOString() : null,
        waitMinutes: Math.max(0, Math.round((end.getTime() - f.clockStart.getTime()) / MS_MIN)),
        businessMinutes: f.goal ? Math.round(f.goal.businessMinutes) : null,
        overdue: f.goal ? f.goal.group === "PENDING_OVERDUE" || f.goal.group === "ANSWERED_LATE" : null,
        open: st ? st.status !== "RESUELTA" : null,
        owner: ownerOf(st?.externalAssigneeId ?? null, accounts),
        orderComplete: f.botOrderCompleteAt !== null,
        thanksCandidate: f.thanksCandidate,
      };
    });
}

/** Lista de casos de un indicador para un período. Sin caché: se pide a demanda. */
export async function getAttentionCases(from: string, to: string, kind: AttentionCaseKind, now: Date = new Date()): Promise<AttentionCasesPayload> {
  const [{ versions }, rows] = await Promise.all([loadConfigVersions(), loadEntryRows(from, to)]);
  const pub = publicHours(versions);
  const selected = selectCases(rows.map((r) => toEntryFact(r, now, versions, pub)), kind);
  const cases = toAttentionCases(selected, now, new Map(), configForDay(versions, arDayISO(now))?.data.accounts ?? []);
  const shown = cases.slice(0, ATTENTION_CASES_MAX_ROWS);

  // Estado y asignado actuales, solo de las filas que se muestran.
  const states = await prisma.conversation.findMany({
    where: { id: { in: shown.map((c) => c.conversationId) } },
    select: { id: true, status: true, externalAssigneeId: true },
  });
  const byId = new Map(states.map((s) => [s.id, { status: s.status as string, externalAssigneeId: s.externalAssigneeId }]));
  const accounts = configForDay(versions, arDayISO(now))?.data.accounts ?? [];
  const facts = new Map(selected.map((f) => [f.conversationId, f]));

  return {
    kind, from, to,
    generatedAt: now.toISOString(),
    total: cases.length,
    cases: toAttentionCases(shown.map((c) => facts.get(c.conversationId)!), now, byId, accounts),
  };
}
