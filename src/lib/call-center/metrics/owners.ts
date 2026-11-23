/**
 * "Quién tiene cada caso": las conversaciones abiertas, por cuenta de Emozion asignada.
 *
 * El asignado es el dato MEDIDO (externalAssigneeId del último evento recibido). Cuando falta,
 * se informa aparte y como dato DETECTADO la cuenta del último mensaje público de un operador:
 * nunca se mezcla con el asignado ni cambia en qué fila cae la conversación.
 *
 * buildOwners es PURO. Ninguna fila lleva teléfono, nombre ni texto: solo ids internos,
 * números de cuenta y horas.
 */
import { prisma } from "@/lib/prisma";
import { accountDisplay, accountRef, ownerKeyOf, OWNER_KEY_NONE, OWNER_KEY_SYSTEM, OWNER_TEXT, type LabelAccount } from "./account-label";
import type { NowOwnerRow, NowOwners } from "./now-types";
import type { WindowState } from "./whatsapp-window";

/** Una conversación abierta (estado distinto de RESUELTA). */
export interface OpenOwnerRow {
  conversationId: string;
  externalAssigneeId: string | null;
  /** Cuenta del último mensaje público de un operador; null si ninguno respondió o el mensaje no trae cuenta. */
  lastOperatorAccount: string | null;
}

/** Un caso de la lista "Casos" (abierta, esperando respuesta de un operador). */
export interface WaitingCase {
  conversationId: string;
  waitStart: string;
  window: WindowState;
}

const byAccountNumber = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

/** Etiqueta detectada del último operador que respondió; null si no hay. PURO. */
export function detectedOwnerLabel(row: OpenOwnerRow | undefined, accounts: readonly LabelAccount[]): string | null {
  if (!row || row.externalAssigneeId || !row.lastOperatorAccount) return null;
  return accountDisplay(accountRef(row.lastOperatorAccount, accounts));
}

/**
 * Una fila por cuenta con conversaciones abiertas. PURO.
 * Orden estable y sin ranking: operadores por número de cuenta, supervisión, "Sin tomar" y
 * "Sin dato de asignado".
 */
export function buildOwners(open: readonly OpenOwnerRow[], waiting: readonly WaitingCase[], accounts: readonly LabelAccount[]): NowOwners {
  const waitingById = new Map(waiting.map((w) => [w.conversationId, w]));
  const rows = new Map<string, NowOwnerRow & { sort: string }>();
  const detected = new Map<string, { label: string; open: number }>();
  let detectedNone = 0;

  for (const c of open) {
    const key = ownerKeyOf(c.externalAssigneeId, accounts);
    let row = rows.get(key);
    if (!row) {
      const ref = c.externalAssigneeId ? accountRef(c.externalAssigneeId, accounts) : null;
      row = {
        key,
        group: key === OWNER_KEY_NONE ? "SIN_DATO" : key === OWNER_KEY_SYSTEM ? "SIN_TOMAR" : ref!.role === "SUPERVISION" ? "SUPERVISION" : "OPERADOR",
        label: key === OWNER_KEY_NONE ? OWNER_TEXT.none : key === OWNER_KEY_SYSTEM ? OWNER_TEXT.system : ref!.label,
        open: 0, waiting: 0, oldestWaitStart: null, windowClosed: 0, detected: null,
        sort: c.externalAssigneeId ?? "",
      };
      rows.set(key, row);
    }
    row.open++;
    const w = waitingById.get(c.conversationId);
    if (w) {
      row.waiting++;
      if (row.oldestWaitStart === null || w.waitStart < row.oldestWaitStart) row.oldestWaitStart = w.waitStart;
      if (w.window === "CERRADA") row.windowClosed++;
    }
    if (key === OWNER_KEY_NONE) {
      if (!c.lastOperatorAccount) detectedNone++;
      else {
        const d = detected.get(c.lastOperatorAccount) ?? { label: accountDisplay(accountRef(c.lastOperatorAccount, accounts)), open: 0 };
        d.open++;
        detected.set(c.lastOperatorAccount, d);
      }
    }
  }

  const none = rows.get(OWNER_KEY_NONE);
  if (none) {
    none.detected = {
      byAccount: [...detected.entries()].sort(([a], [b]) => byAccountNumber(a, b)).map(([, d]) => d),
      none: detectedNone,
    };
  }

  const GROUP_ORDER = { OPERADOR: 0, SUPERVISION: 1, SIN_TOMAR: 2, SIN_DATO: 3 } as const;
  const ordered = [...rows.values()].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || byAccountNumber(a.sort, b.sort));
  return { open: open.length, rows: ordered.map(({ sort: _sort, ...r }) => r) };
}

/** Todas las conversaciones abiertas con su asignado y la cuenta del último operador que respondió. Solo lectura. */
export async function loadOpenOwnerRows(): Promise<OpenOwnerRow[]> {
  return prisma.$queryRaw<OpenOwnerRow[]>`
    SELECT c.id AS "conversationId", c."externalAssigneeId", lo."externalSenderId" AS "lastOperatorAccount"
    FROM "Conversation" c
    LEFT JOIN LATERAL (
      SELECT m."externalSenderId"
      FROM "ConversationMessage" m
      WHERE m."conversationId" = c.id AND m.author = 'OPERATOR' AND NOT m."isPrivate"
      ORDER BY m."sentAt" DESC
      LIMIT 1
    ) lo ON true
    WHERE c.status <> 'RESUELTA'
  `;
}
