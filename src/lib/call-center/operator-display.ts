/**
 * El operador en la bandeja y en la vista de conversación. PURO.
 *
 * "Operador" es la cuenta de Emozion: la asignada (externalAssigneeId, dato medido) y, cuando
 * falta o difiere, la del último mensaje público de un operador (dato detectado). Los nombres
 * salen solo de la configuración de métricas vigente (alias, o "Cuenta N"). El asignado llega
 * acá como clave de cuenta (assigneeAccount): un bot asignado cuenta como "Sin tomar".
 */
import {
  accountDisplay, accountRef, ownerDisplay, OWNER_KEY_NONE, OWNER_KEY_SYSTEM, OWNER_TEXT, type LabelAccount,
} from "./metrics/account-label";
import { CLOSURE_OUTCOME_TEXT, type ClosureMap } from "./metrics/closure-outcome";
import { formatMinutes } from "./metrics/format";
import { isSyncNote } from "./sync-note";

/** Filtro por operador de la bandeja: una cuenta, "Sin tomar" o "Sin dato de asignado". */
export type OperatorFilter = { kind: "ACCOUNT"; account: string } | { kind: "SYSTEM" } | { kind: "NONE" };

/** ?operator= → filtro válido; cualquier valor raro → sin filtro. */
export function parseOperatorFilter(value: string | undefined): OperatorFilter | null {
  if (!value) return null;
  if (value === OWNER_KEY_SYSTEM) return { kind: "SYSTEM" };
  if (value === OWNER_KEY_NONE) return { kind: "NONE" };
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? { kind: "ACCOUNT", account: value } : null;
}

/** Valor del filtro para el enlace y el selector. */
export function operatorFilterValue(f: OperatorFilter | null): string | null {
  return !f ? null : f.kind === "SYSTEM" ? OWNER_KEY_SYSTEM : f.kind === "NONE" ? OWNER_KEY_NONE : f.account;
}

/** Condición de la bandeja sobre el asignado (forma de un `where` de Prisma). */
export type OperatorWhere =
  | Record<string, never>
  | { externalAssigneeId: null }
  | { OR: [{ externalAssigneeId: { in: string[] } }, { externalAssigneeType: "AGENT_BOT" }] }
  | { externalAssigneeId: string; OR: [{ externalAssigneeType: null }, { externalAssigneeType: { not: "AGENT_BOT" } }] };

/**
 * Condición sobre el asignado. "Sin tomar" son las cuentas de sistema de la configuración y
 * cualquier asignado que sea un bot. Una cuenta es ese id cuando NO es un bot: un bot y una
 * persona pueden tener el mismo número.
 */
export function operatorWhere(f: OperatorFilter | null, accounts: readonly LabelAccount[]): OperatorWhere {
  if (!f) return {};
  if (f.kind === "NONE") return { externalAssigneeId: null };
  if (f.kind === "SYSTEM") {
    const system = accounts.filter((a) => accountRef(a.externalId, accounts).role === "SISTEMA").map((a) => a.externalId);
    return { OR: [{ externalAssigneeId: { in: system } }, { externalAssigneeType: "AGENT_BOT" }] };
  }
  // `not` solo no alcanza: en SQL deja afuera las filas sin tipo, que son las anteriores a este dato.
  return { externalAssigneeId: f.account, OR: [{ externalAssigneeType: null }, { externalAssigneeType: { not: "AGENT_BOT" } }] };
}

/** Opciones del selector: las cuentas configuradas que no son de sistema, por número, y las dos filas especiales. */
export function operatorOptions(accounts: readonly LabelAccount[], selected: OperatorFilter | null): Array<{ value: string; label: string }> {
  const refs = accounts.map((a) => accountRef(a.externalId, accounts)).filter((r) => r.role !== "SISTEMA");
  // Una cuenta filtrada que no está en la configuración igual tiene que poder verse elegida.
  if (selected?.kind === "ACCOUNT" && !accounts.some((a) => a.externalId === selected.account)) refs.push(accountRef(selected.account, accounts));
  refs.sort((a, b) => a.account.localeCompare(b.account, "es", { numeric: true }));
  return [
    ...refs.map((r) => ({ value: r.account, label: accountDisplay(r) })),
    { value: OWNER_KEY_SYSTEM, label: OWNER_TEXT.system },
    { value: OWNER_KEY_NONE, label: OWNER_TEXT.none },
  ];
}

/** "hace 12 min", "hace 3 h 5 min", "hace 2 d 4 h". */
export function agoLabel(at: Date, now: Date): string {
  return `hace ${formatMinutes((now.getTime() - at.getTime()) / 60000)}`;
}

export interface OperatorInfo {
  /** Quién la atiende según el asignado actual: alias, "Sin tomar" o "Sin dato de asignado". */
  attendedBy: string;
  /** El asignado es un dato medido; false si falta. */
  hasAssignee: boolean;
  /**
   * Último operador que respondió (dato detectado). Solo si falta el asignado o es otra
   * cuenta; null si coincide con el asignado o ningún operador respondió.
   */
  lastResponder: string | null;
}

/** Operador de una conversación. `lastOperatorAccount` es la cuenta del último mensaje público de un operador. */
export function operatorInfo(assignee: string | null, lastOperatorAccount: string | null, accounts: readonly LabelAccount[]): OperatorInfo {
  return {
    attendedBy: ownerDisplay(assignee, accounts),
    hasAssignee: assignee !== null,
    lastResponder: lastOperatorAccount && lastOperatorAccount !== assignee ? accountDisplay(accountRef(lastOperatorAccount, accounts)) : null,
  };
}

/** Fila del historial de estados, con lo que hace falta para el historial corto. */
export interface HistoryRow {
  changedAt: Date;
  fromStatus: string | null;
  toStatus: string;
  externalAssigneeId: string | null;
  closureTypeName: string | null;
  /** Nota de la fila. Solo se usa para reconocer una corrección de estado (isSyncNote). */
  note?: string | null;
}

export interface ShortHistoryEvent {
  at: Date;
  kind: "ASIGNACION" | "RESOLUCION" | "REAPERTURA";
  text: string;
}

/**
 * Historial corto: asignaciones, resoluciones (con su resultado de cierre, si la etiqueta está)
 * y reaperturas. `rows` de la más vieja a la más nueva. Una asignación se informa cuando la
 * fila trae una cuenta distinta de la última conocida. Las filas sin cuenta (las anteriores a
 * que la ingesta la guardara, o las acciones hechas en esta plataforma) no dicen quién.
 */
export function shortHistory(rows: readonly HistoryRow[], accounts: readonly LabelAccount[], closureMap: ClosureMap): ShortHistoryEvent[] {
  const out: ShortHistoryEvent[] = [];
  let lastAssignee: string | null = null;
  for (const r of rows) {
    const who = r.externalAssigneeId ? ownerDisplay(r.externalAssigneeId, accounts) : null;
    const isSystem = who === OWNER_TEXT.system;
    if (r.toStatus === "RESUELTA" && isSyncNote(r.note)) {
      // No es un cierre de un operador: se corrigió el estado al comparar con Emozion.
      out.push({ at: r.changedAt, kind: "RESOLUCION", text: "Figuraba abierta y en Emozion ya estaba resuelta: estado corregido (no es un cierre de un operador; la fecha es la del último mensaje)" });
    } else if (r.toStatus === "RESUELTA" && r.fromStatus !== "RESUELTA") {
      const outcome = r.closureTypeName ? closureMap.get(r.closureTypeName) : undefined;
      const closure = outcome ? CLOSURE_OUTCOME_TEXT[outcome] : r.closureTypeName;
      out.push({
        at: r.changedAt, kind: "RESOLUCION",
        text: `Resuelta${who ? (isSystem ? ` · ${OWNER_TEXT.system.toLowerCase()}` : ` · asignada a ${who}`) : ""}${closure ? ` · cierre: ${closure}` : ""}`,
      });
    } else if (r.fromStatus === "RESUELTA" && r.toStatus !== "RESUELTA") {
      out.push({ at: r.changedAt, kind: "REAPERTURA", text: `Reabierta${who ? (isSystem ? ` · ${OWNER_TEXT.system.toLowerCase()}` : ` · asignada a ${who}`) : ""}` });
    } else if (r.externalAssigneeId && r.externalAssigneeId !== lastAssignee) {
      out.push({ at: r.changedAt, kind: "ASIGNACION", text: isSystem ? `${OWNER_TEXT.system} (asignación automática)` : `Asignada a ${who}` });
    }
    if (r.externalAssigneeId) lastAssignee = r.externalAssigneeId;
  }
  return out;
}
