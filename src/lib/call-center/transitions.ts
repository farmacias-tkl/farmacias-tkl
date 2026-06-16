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
