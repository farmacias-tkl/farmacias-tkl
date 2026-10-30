// =============================================================================
// Nombres de personas en la carga: "Apellido, Nombre" (con coma).
// =============================================================================

import { normalizeLabel } from "./catalog";

export interface SplitName {
  lastName: string;
  firstName: string;
  /** Clave de identidad: "apellido, nombre" normalizado. */
  nameKey: string;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Clave de identidad a partir de apellido y nombre (la misma que usa la carga). */
export function nameKeyOf(lastName: string, firstName: string): string {
  return `${normalizeLabel(tidy(lastName))}, ${normalizeLabel(tidy(firstName))}`;
}

/** null si no tiene exactamente una coma con texto a ambos lados. */
export function splitApellidoNombre(raw: string): SplitName | null {
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lastName = tidy(parts[0]);
  const firstName = tidy(parts[1]);
  if (!lastName || !firstName) return null;
  return { lastName, firstName, nameKey: nameKeyOf(lastName, firstName) };
}
