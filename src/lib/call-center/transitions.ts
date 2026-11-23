import { ConversationStatus } from "@prisma/client";

/**
 * Call Center — máquina de estados conversacional (Sprint 1).
 *
 * FUENTE ÚNICA de las transiciones válidas. Toda mutación de `status` (Sprint 2)
 * debe validar contra esto; la vista read-only del Sprint 1 no muta, solo lee.
 *
 * Notas de diseño:
 *  - RESUELTA NO es terminal: reabre a PENDIENTE/SIN_ASIGNAR. No copiar el guard
 *    de COMPLETED de otros dominios.
 *  - ASIGNADA→ASIGNADA = reasignación (cambia el dueño, mismo status).
 *  - NO existe ASIGNADA→SIN_ASIGNAR: se confirma en Sprint 2, no se crea acción
 *    muerta ahora.
 *  - Prohibidas explícitamente: PENDIENTE→ASIGNADA, SIN_ASIGNAR→RESUELTA.
 */

/** Estados válidos en la fila de nacimiento (fromStatus = null). */
export const INITIAL_STATUSES: readonly ConversationStatus[] = [
  ConversationStatus.PENDIENTE,
  ConversationStatus.SIN_ASIGNAR,
] as const;

/**
 * Transiciones permitidas, indexadas por estado de origen.
 *  (nacimiento) → PENDIENTE | SIN_ASIGNAR
 *  PENDIENTE   → SIN_ASIGNAR        (auto, timeout 10' — sin actor humano)
 *  SIN_ASIGNAR → ASIGNADA
 *  ASIGNADA    → ASIGNADA           (reasignación: cambia dueño, mismo status)
 *  ASIGNADA    → RESUELTA
 *  RESUELTA    → PENDIENTE
 *  RESUELTA    → SIN_ASIGNAR
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ConversationStatus, readonly ConversationStatus[]>
> = {
  [ConversationStatus.PENDIENTE]: [ConversationStatus.SIN_ASIGNAR],
  [ConversationStatus.SIN_ASIGNAR]: [ConversationStatus.ASIGNADA],
  [ConversationStatus.ASIGNADA]: [
    ConversationStatus.ASIGNADA,
    ConversationStatus.RESUELTA,
  ],
  [ConversationStatus.RESUELTA]: [
    ConversationStatus.PENDIENTE,
    ConversationStatus.SIN_ASIGNAR,
  ],
};

/** ¿Puede una conversación nacer en este estado? */
export function isValidInitialStatus(status: ConversationStatus): boolean {
  return INITIAL_STATUSES.includes(status);
}

/** ¿Es válida la transición from → to según la whitelist? */
export function canTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Transiciones que la INGESTA de Emozion trae de forma habitual y que la lista de acciones
 * de operador no permite. No son un error: son la forma en que Emozion mueve una
 * conversación. La ingesta registra siempre lo que llega; esta lista solo decide si deja un
 * aviso. No habilita nada para las acciones de operador (canTransition no la mira).
 *
 *  PENDIENTE   → ASIGNADA   sale del bot ya con un asignado
 *  SIN_ASIGNAR → RESUELTA   se resuelve sin haber tenido asignado
 *  RESUELTA    → ASIGNADA   se reabre directamente con un asignado
 */
export const EXPECTED_INGESTED_TRANSITIONS: Readonly<
  Partial<Record<ConversationStatus, readonly ConversationStatus[]>>
> = {
  [ConversationStatus.PENDIENTE]: [ConversationStatus.ASIGNADA],
  [ConversationStatus.SIN_ASIGNAR]: [ConversationStatus.RESUELTA],
  [ConversationStatus.RESUELTA]: [ConversationStatus.ASIGNADA],
};

/**
 * ¿Es una transición que la ingesta espera? Las de la lista de acciones de operador más las
 * habituales de Emozion. Las demás se registran igual, con un aviso.
 */
export function isExpectedIngestedTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): boolean {
  return canTransition(from, to) || (EXPECTED_INGESTED_TRANSITIONS[from]?.includes(to) ?? false);
}

/**
 * CICLO DE VIDA de Conversation.assignedToUserId (regla de diseño del dominio).
 * No todo se implementa en Sprint 2 — esto documenta el contrato para el futuro.
 *
 *  - Tomar      (SIN_ASIGNAR→ASIGNADA): assignedToUserId = operador que toma. [Sprint 2]
 *  - Reasignar  (ASIGNADA→ASIGNADA):    assignedToUserId = nuevo operador.    [Sprint 2]
 *  - Cerrar     (ASIGNADA→RESUELTA):    assignedToUserId SE CONSERVA (último
 *      responsable, necesario para métricas "resueltas por operador") + closedAt = now.
 *      NO se nullea al cerrar.                                                  [Sprint 2]
 *  - Reapertura por mensaje entrante (RESUELTA→PENDIENTE | RESUELTA→SIN_ASIGNAR):
 *      ahí SÍ se limpia assignedToUserId = null Y closedAt = null, porque la
 *      conversación vuelve al bot (Emozion) hasta que un operador la tome/se asigne.
 *      [NO Sprint 2 — sin endpoint/botón/handler de reapertura; regla para el conector
 *       Emozion/WhatsApp, Sprint 4.]
 */
