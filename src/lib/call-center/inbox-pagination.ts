/**
 * Paginación de la bandeja del Call Center. PURO.
 *
 * La bandeja traía y dibujaba TODAS las conversaciones (más de 22.000): la página pesaba
 * decenas de MB. Ahora trae de a INBOX_PAGE_SIZE, de la más reciente a la más antigua.
 */

export const INBOX_PAGE_SIZE = 50;

/** ?page= → número de página válido (1 en adelante). Cualquier valor raro → 1. */
export function parsePage(value: string | undefined): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 ? n : 1;
}

export interface InboxPageInfo {
  /** Página efectiva: si se pide una posterior a la última, es la última. */
  page: number;
  totalPages: number;
  /** Filas a saltear en la consulta. */
  skip: number;
  /** Posición de la primera y la última fila mostradas (1 en adelante); 0 si no hay filas. */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function inboxPageInfo(total: number, requestedPage: number, pageSize: number = INBOX_PAGE_SIZE): InboxPageInfo {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const skip = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    skip,
    from: total === 0 ? 0 : skip + 1,
    to: Math.min(total, skip + pageSize),
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/** Enlace de la bandeja conservando el filtro de estado. La página 1 no lleva ?page. */
export function inboxHref(status: string | null, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/call-center?${qs}` : "/call-center";
}
