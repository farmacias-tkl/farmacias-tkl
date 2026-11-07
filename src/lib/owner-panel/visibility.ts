// Usuarios ocultos del Panel de Dirección (/owner y /api/owner/*).
// Un usuario con hiddenFromOwnerPanel = true no aparece en listas, conteos,
// búsquedas ni filtros del panel, y su detalle o edición por id da 404, salvo
// para ese mismo usuario. El panel de Administración no usa este filtro.
import type { Prisma } from "@prisma/client";

/** Filtro de Prisma: usuarios que quien mira puede ver en el panel. */
export function ownerPanelVisibleWhere(viewerId: string): Prisma.UserWhereInput {
  return { OR: [{ hiddenFromOwnerPanel: false }, { id: viewerId }] };
}

/** Filtro para buscar un usuario puntual por id (sin coincidencia → 404). */
export function ownerPanelUserByIdWhere(id: string, viewerId: string): Prisma.UserWhereInput {
  return { AND: [{ id }, ownerPanelVisibleWhere(viewerId)] };
}

/** La misma regla, sobre un usuario ya leído. */
export function isVisibleInOwnerPanel(target: { id: string; hiddenFromOwnerPanel: boolean }, viewerId: string): boolean {
  return !target.hiddenFromOwnerPanel || target.id === viewerId;
}
