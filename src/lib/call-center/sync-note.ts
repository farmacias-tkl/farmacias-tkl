/**
 * Filas de ConversationStateHistory que NO son un cierre de un operador ni un evento de
 * Emozion: correcciones de estado hechas al comparar nuestra base con Emozion (una
 * conversación que figuraba abierta acá y allá ya estaba resuelta). PURO.
 *
 * Se reconocen por el comienzo de la nota. Su `changedAt` es la hora del último mensaje, no la
 * de una resolución real; no tienen asignado ni resultado de cierre. No cuentan como cierres
 * del día ni de una cuenta, ni como "cierre previo" del cliente.
 *
 * Es una marca por texto: sirve mientras estas correcciones sean pocas y manuales. Si pasan a
 * ser periódicas conviene una columna de origen en la tabla (migración aparte).
 */
export const SYNC_NOTE_PREFIX = "Sincronizada con Emozion";

/** Patrón LIKE de SQL para esas notas. */
export const SYNC_NOTE_LIKE = `${SYNC_NOTE_PREFIX}%`;

export function isSyncNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.startsWith(SYNC_NOTE_PREFIX);
}
