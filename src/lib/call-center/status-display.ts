import { ConversationStatus } from "@prisma/client";

/**
 * Presentación de los estados conversacionales (solo lectura, Sprint 1).
 * Etiquetas en es-AR + colores para badges. Sin lógica de negocio: las
 * transiciones válidas viven en ./transitions.ts.
 */
export const STATUS_META: Record<
  ConversationStatus,
  { label: string; bg: string; fg: string }
> = {
  PENDIENTE: { label: "Pendiente", bg: "#FEF3C7", fg: "#92400E" },
  SIN_ASIGNAR: { label: "Sin asignar", bg: "#FEE2E2", fg: "#991B1B" },
  ASIGNADA: { label: "Asignada", bg: "#DBEAFE", fg: "#1E40AF" },
  RESUELTA: { label: "Resuelta", bg: "#D1FAE5", fg: "#065F46" },
};

/** Orden de presentación de los filtros/estados. */
export const STATUS_ORDER: ConversationStatus[] = [
  ConversationStatus.PENDIENTE,
  ConversationStatus.SIN_ASIGNAR,
  ConversationStatus.ASIGNADA,
  ConversationStatus.RESUELTA,
];

/** Narrow de un string arbitrario (?status=) a un ConversationStatus válido. */
export function parseStatus(value: string | undefined): ConversationStatus | null {
  if (!value) return null;
  return STATUS_ORDER.includes(value as ConversationStatus)
    ? (value as ConversationStatus)
    : null;
}
