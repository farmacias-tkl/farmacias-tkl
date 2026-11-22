/**
 * Tipo de gestión de una conversación y vía por la que salió del bot. PURO.
 *
 * Las dos clasificaciones salen de textos (del bot y del primer mensaje del cliente) o de
 * la cercanía entre un mensaje y un cambio de estado: son nivel "Detectado" o aproximación,
 * y así se rotulan en pantalla. Los textos son plantillas fijas, no datos de clientes.
 */

export type ManagementType = "MEDUCAR" | "PEDIDO" | "OTROS";

export const MANAGEMENT_TYPE_LABELS: Record<ManagementType, string> = {
  MEDUCAR: "Meducar",
  PEDIDO: "Pedido",
  OTROS: "Otros",
};

/** Opción del menú del bot con la que el cliente inicia un pedido. */
export const CUSTOMER_ORDER_OPTION = "Pedir medicamentos";
/** Pregunta del bot que solo aparece dentro del recorrido de pedido. Patrón LIKE de SQL. */
export const BOT_ORDER_FLOW_LIKE = "%cobertura médica o lo abonás%";

/**
 * Meducar: el PRIMER mensaje del cliente es el pedido sobre una receta con un enlace al
 * dominio de Meducar. Regla confirmada por Dirección (21/11/2026). Se exigen las dos cosas:
 * una mención de Meducar más adelante en la conversación no alcanza.
 */
export const MEDUCAR_LINK_REGEX = "cdn\\.meducar\\.com";
export const MEDUCAR_PHRASE_REGEX = "quiero realizar un pedido sobre esta receta";

export function isMeducarFirstMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  return new RegExp(MEDUCAR_LINK_REGEX, "i").test(body) && new RegExp(MEDUCAR_PHRASE_REGEX, "i").test(body);
}

/** Meducar tiene prioridad: esas conversaciones también pueden pasar por el recorrido de pedido. */
export function classifyManagementType(c: { firstCustomerMessageIsMeducar: boolean; orderFlow: boolean }): ManagementType {
  if (c.firstCustomerMessageIsMeducar) return "MEDUCAR";
  if (c.orderFlow) return "PEDIDO";
  return "OTROS";
}

/**
 * Vía de salida del bot. La salida es el primer cambio de estado de Pendiente a Sin asignar
 * o Asignada: una APROXIMACIÓN a la derivación.
 *  - PEDIDO_COMPLETO: el cambio ocurre pegado al mensaje final del bot.
 *  - SIN_MENSAJE_FINAL: el cambio ocurre sin ese mensaje (el cliente pidió un asesor, entró
 *    fuera de horario o el bot lo soltó por tiempo). El cliente no dejó el pedido armado.
 *  - SIN_REGISTRO: no hay cambio de estado registrado.
 */
export type BotExitPath = "PEDIDO_COMPLETO" | "SIN_MENSAJE_FINAL" | "SIN_REGISTRO";

export const BOT_EXIT_PATH_LABELS: Record<BotExitPath, string> = {
  PEDIDO_COMPLETO: "Pedido completo en el bot",
  SIN_MENSAJE_FINAL: "Salió del bot sin completar",
  SIN_REGISTRO: "Sin salida registrada",
};

/** Tolerancia entre el mensaje final del bot y el cambio de estado (hora de procesamiento). */
export const BOT_EXIT_MATCH_SECONDS = 5;

export function classifyBotExit(botExitAt: Date | null, botOrderCompleteAt: Date | null): BotExitPath {
  if (!botExitAt) return "SIN_REGISTRO";
  if (botOrderCompleteAt && Math.abs(botExitAt.getTime() - botOrderCompleteAt.getTime()) <= BOT_EXIT_MATCH_SECONDS * 1000) {
    return "PEDIDO_COMPLETO";
  }
  return "SIN_MENSAJE_FINAL";
}
