/**
 * Detalle de casos de "Operadores": las conversaciones que hay detrás de cuatro números.
 *
 *  - slow_followups: las respuestas posteriores que más tardaron;
 *  - unanswered_blocks: bloques del cliente que quedaron sin respuesta. Requieren revisión:
 *    no todos piden contestación, y NO se atribuyen al último operador que escribió;
 *  - several_accounts: conversaciones atendidas por más de una cuenta en el período;
 *  - first_response_later_day: primeras respuestas a conversaciones que habían entrado un día
 *    anterior.
 *
 * Se arma con las mismas filas que el informe (accounts.ts). Cada caso lleva el id interno
 * (para el enlace), horas y nombres de cuenta; nunca teléfono, nombre ni texto del cliente.
 *
 * selectOperatorCases es PURO.
 */
import { loadFollowupBlocks, loadOperatorMessages, type FollowupBlockRow, type OperatorMessageRow } from "./accounts";
import { accountRef, type LabelAccount } from "./account-label";
import { loadEntryRows, toEntryFact, type EntryFact } from "./attention";
import { arDayISO } from "./business-time";
import { configForDay, loadConfigVersions } from "./config";
import { isSupervisionAccount, isSystemAccount } from "./config-schema";
import { publicHours } from "./schedule";
import type { OperatorCase, OperatorCaseKind, OperatorCasesPayload } from "./accounts-types";

export const OPERATOR_CASES_MAX_ROWS = 100;
const MS_MIN = 60_000;

export const OPERATOR_CASE_KINDS: readonly OperatorCaseKind[] = ["slow_followups", "unanswered_blocks", "several_accounts", "first_response_later_day"];

export function isOperatorCaseKind(v: unknown): v is OperatorCaseKind {
  return typeof v === "string" && (OPERATOR_CASE_KINDS as readonly string[]).includes(v);
}

export interface OperatorCasesInput {
  messages: readonly OperatorMessageRow[];
  followups: readonly FollowupBlockRow[];
  facts: readonly EntryFact[];
}

/**
 * Los casos de un indicador, ya ordenados, sin tope. PURO. `account` limita a una cuenta; sin
 * ella valen las cuentas del equipo (`outsideTeam` saca las de sistema y supervisión).
 */
export function selectOperatorCases(
  input: OperatorCasesInput, kind: OperatorCaseKind, account: string | null,
  opts: { now: Date; accounts: readonly LabelAccount[]; outsideTeam: (account: string | null) => boolean },
): OperatorCase[] {
  const label = (a: string | null) => (a === null ? "Sin cuenta registrada" : accountRef(a, opts.accounts).label);
  const mine = (a: string | null) => (account !== null ? a === account : !opts.outsideTeam(a));

  if (kind === "slow_followups") {
    return input.followups
      .filter((b) => b.respondedAt && mine(b.account))
      .map((b) => ({
        conversationId: b.conversationId, at: b.startedAt.toISOString(),
        waitMinutes: Math.max(0, Math.round((b.respondedAt!.getTime() - b.startedAt.getTime()) / MS_MIN)),
        accounts: [label(b.account)], order: false,
      }))
      .sort((a, b) => b.waitMinutes! - a.waitMinutes!);
  }
  if (kind === "unanswered_blocks") {
    // Sin atribución: quién escribió último no dice quién tenía que contestar.
    return input.followups
      .filter((b) => !b.respondedAt)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((b) => ({
        conversationId: b.conversationId, at: b.startedAt.toISOString(),
        waitMinutes: Math.max(0, Math.round((opts.now.getTime() - b.startedAt.getTime()) / MS_MIN)),
        accounts: [], order: false,
      }));
  }
  if (kind === "several_accounts") {
    const byConversation = new Map<string, { first: Date; accounts: Set<string | null> }>();
    for (const m of input.messages) {
      if (m.isPrivate || opts.outsideTeam(m.account)) continue;
      const c = byConversation.get(m.conversationId) ?? { first: m.sentAt, accounts: new Set<string | null>() };
      if (m.sentAt < c.first) c.first = m.sentAt;
      c.accounts.add(m.account);
      byConversation.set(m.conversationId, c);
    }
    return [...byConversation.entries()]
      .filter(([, c]) => c.accounts.size > 1 && (account === null || c.accounts.has(account)))
      .sort((a, b) => b[1].accounts.size - a[1].accounts.size || a[1].first.getTime() - b[1].first.getTime())
      .map(([conversationId, c]) => ({
        conversationId, at: c.first.toISOString(), waitMinutes: null,
        accounts: [...c.accounts].map(label).sort((x, y) => x.localeCompare(y, "es", { numeric: true })), order: false,
      }));
  }
  return input.facts
    .filter((f) => f.firstHumanAt && !f.answeredSameDay && mine(f.firstHumanAccount))
    .sort((a, b) => b.clockMinutes! - a.clockMinutes!)
    .map((f) => ({
      conversationId: f.conversationId, at: f.clockStart.toISOString(), waitMinutes: Math.round(f.clockMinutes!),
      accounts: [label(f.firstHumanAccount)], order: f.botOrderCompleteAt !== null,
    }));
}

/** Lista de casos de un indicador para un período. Sin caché: se pide a demanda. Solo lectura. */
export async function getOperatorCases(from: string, to: string, kind: OperatorCaseKind, account: string | null, now: Date = new Date()): Promise<OperatorCasesPayload> {
  const needFacts = kind === "first_response_later_day";
  const needMessages = kind === "several_accounts";
  const [{ versions }, rows, messages, followups] = await Promise.all([
    loadConfigVersions(),
    needFacts ? loadEntryRows(from, to) : Promise.resolve([]),
    needMessages ? loadOperatorMessages(from, to) : Promise.resolve([]),
    !needFacts && !needMessages ? loadFollowupBlocks(from, to) : Promise.resolve([]),
  ]);
  const pub = publicHours(versions);
  const accounts = configForDay(versions, arDayISO(now))?.data.accounts ?? [];
  const configured = new Map(accounts.map((c) => [c.externalId, c]));
  const outsideTeam = (a: string | null) => {
    const cfg = a ? configured.get(a) : undefined;
    return !!cfg && (isSystemAccount(cfg) || isSupervisionAccount(cfg));
  };
  const cases = selectOperatorCases(
    { messages, followups, facts: rows.map((r) => toEntryFact(r, now, versions, pub)) },
    kind, account, { now, accounts, outsideTeam },
  );
  return { kind, from, to, account, generatedAt: now.toISOString(), total: cases.length, cases: cases.slice(0, OPERATOR_CASES_MAX_ROWS) };
}
