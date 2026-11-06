// =============================================================================
// Email de usuario: siempre sin espacios y en minúsculas, en el login y al
// crear o editar usuarios. Una cuenta vieja guardada con mayúsculas se sigue
// encontrando porque las búsquedas no distinguen mayúsculas (emailEquals).
// =============================================================================

import { z } from "zod";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Campo de email para formularios y APIs: normaliza y valida. */
export function emailField(message?: string) {
  return z.string().trim().toLowerCase().email(message);
}

/** Filtro Prisma: mismo email, sin distinguir mayúsculas. */
export function emailEquals(email: string) {
  return { equals: normalizeEmail(email), mode: "insensitive" as const };
}
