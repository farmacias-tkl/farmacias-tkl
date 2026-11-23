/**
 * Etiquetas VISTAS durante una conversación. PURO.
 *
 * `Conversation.externalLabels` es la lista actual de Emozion y cada evento la reemplaza. Una
 * automatización de Emozion quita, al resolver, las etiquetas de sucursal y de modalidad que
 * marcó el bot, así que después del cierre ese dato ya no está en la lista actual.
 *
 * "Vistas" es la unión de las etiquetas que tuvo la conversación desde que se abrió (o se
 * reabrió) por última vez: solo suma. Al resolver se copia a la fila RESUELTA del historial y
 * al reabrir empieza de nuevo con las etiquetas de ese momento, para que un pedido nuevo del
 * mismo cliente no herede la sucursal del anterior.
 */

/** Tope de etiquetas vistas por conversación (defensa: la lista actual ya tiene su propio tope). */
export const LABELS_SEEN_MAX = 100;

/** Unión en orden de aparición, sin repetidos. Las listas null o ausentes no aportan. */
export function mergeLabelsSeen(...lists: Array<readonly string[] | null | undefined>): string[] {
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const l of list) {
      if (out.length >= LABELS_SEEN_MAX) return out;
      if (!out.includes(l)) out.push(l);
    }
  }
  return out;
}

/**
 * Etiquetas de una conversación para leer su sucursal o modalidad: las vistas más las
 * actuales. Las conversaciones anteriores a este dato tienen las vistas vacías.
 */
export function labelsEverSeen(c: { externalLabelsSeen?: readonly string[] | null; externalLabels?: readonly string[] | null }): string[] {
  return mergeLabelsSeen(c.externalLabelsSeen, c.externalLabels);
}
