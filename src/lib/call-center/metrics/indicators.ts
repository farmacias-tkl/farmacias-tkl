/**
 * Diccionario de indicadores de las métricas del Call Center. FUENTE ÚNICA: tarjetas,
 * gráficos y tablas toman de acá el nombre, la definición, el nivel de evidencia y los
 * límites de cada indicador. Un mismo indicador no se define en dos lugares.
 *
 * Reglas que valen para todos:
 *  - "Día" es el día de calendario de Buenos Aires.
 *  - Un dato faltante se muestra como "No disponible", nunca como cero.
 *  - Mensaje público = no es nota interna.
 *  - Las medianas y los percentiles se calculan solo entre las conversaciones respondidas
 *    y se muestran siempre junto con los pendientes y su antigüedad.
 */

/** De dónde sale el dato. */
export type EvidenceLevel =
  | "MEDIDO"         // sale directo de datos verificables
  | "DETECTADO"      // sale de interpretar el texto de los mensajes
  | "CONFIRMADO"     // hay validación de una persona
  | "NO_DISPONIBLE"; // faltan datos

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  MEDIDO: "Medido",
  DETECTADO: "Detectado",
  CONFIRMADO: "Confirmado",
  NO_DISPONIBLE: "No disponible",
};

/** A qué fecha responde el filtro de período de un indicador. */
export type Population =
  | "ENTRADA"    // conversaciones creadas en el período
  | "ACTIVIDAD"  // conversaciones o mensajes con actividad en el período
  | "AHORA"      // estado al momento de la consulta, sin período
  | "COMPROBANTE"; // fecha del comprobante de SIAF

export const POPULATION_LABELS: Record<Population, string> = {
  ENTRADA: "Filtra por fecha de entrada",
  ACTIVIDAD: "Filtra por actividad en el día",
  AHORA: "Estado actual",
  COMPROBANTE: "Filtra por fecha del comprobante",
};

export type IndicatorBlock = "AHORA" | "ATENCION" | "OPERADORES" | "VENTAS" | "DETECTADOS" | "DATOS";

export interface IndicatorDefinition {
  key: string;
  block: IndicatorBlock;
  /** Nombre en pantalla. */
  label: string;
  /** Qué mide y cómo se calcula, en una o dos frases. */
  definition: string;
  /** Tablas y campos de los que sale. */
  source: string;
  population: Population;
  /** Sobre qué se calcula un porcentaje o una mediana. null si es un conteo simple. */
  denominator: string | null;
  evidence: EvidenceLevel;
  /** Qué no se puede concluir del número. */
  limitations: string[];
  /** Necesita una versión vigente de la configuración; sin ella se muestra "No disponible". */
  needsConfig: boolean;
}

const BOT_EXIT =
  "La salida del bot es el primer cambio de estado de Pendiente a Sin asignar o Asignada. Es una " +
  "aproximación a la derivación: indica que la conversación salió del bot, por pedido completo o por " +
  "tiempo, no que una persona la tomó. Su hora es la de procesamiento del evento.";

const QUEUE_NO_ASSIGNEE =
  "Sin el asignado no se puede separar la espera en cola de la espera con el caso ya tomado: la demora es " +
  "del equipo, no de una cuenta.";

export const INDICATORS: readonly IndicatorDefinition[] = [
  // ── Ahora ──────────────────────────────────────────────────────────────────────────
  {
    key: "queue.open_waiting",
    block: "AHORA",
    label: "Abiertas esperando",
    definition:
      "Conversaciones abiertas cuyo último mensaje público, entre cliente y operador, es del cliente. " +
      "Cuenta todas, de cualquier antigüedad y con o sin salida del bot registrada.",
    source: "Conversation.status, ConversationMessage",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Incluye mensajes finales del cliente que no piden respuesta."],
    needsConfig: false,
  },
  {
    key: "queue.closed_unanswered",
    block: "AHORA",
    label: "Cerradas sin respuesta",
    definition:
      "Conversaciones resueltas cuyo último mensaje público es del cliente. Se separan en las que nunca " +
      "tuvieron respuesta de una persona y las que esperaban la siguiente respuesta.",
    source: "Conversation.status, ConversationMessage",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [
      "No se sabe quién resolvió la conversación ni por qué.",
      "La lista muestra por defecto las últimas 72 horas; el conteo es completo y está abierto por antigüedad.",
    ],
    needsConfig: false,
  },
  {
    key: "queue.thanks_candidates",
    block: "AHORA",
    label: "Candidatos a agradecimiento",
    definition:
      "Conversaciones sin respuesta de una persona, de un cliente con otra conversación resuelta en las 24 " +
      "horas previas, con 40 caracteres o menos escritos en total, sin adjuntos y sin pedido completo en el bot.",
    source: "ConversationMessage, ConversationStateHistory",
    population: "AHORA",
    denominator: "Conversaciones sin respuesta de una persona",
    evidence: "DETECTADO",
    limitations: [
      "El criterio solo selecciona candidatos: puede incluir una confirmación o una consulta corta.",
      "No se excluyen de ningún conteo: siguen pendientes hasta que alguien los revise.",
    ],
    needsConfig: false,
  },
  {
    key: "queue.completed_orders_waiting",
    block: "AHORA",
    label: "Pedidos completos esperando",
    definition:
      "Conversaciones sin respuesta de una persona en las que el bot llegó a su mensaje final de pedido recibido.",
    source: "ConversationMessage (texto del bot)",
    population: "AHORA",
    denominator: null,
    evidence: "DETECTADO",
    limitations: ["Depende del texto del mensaje final del bot: si cambia, hay que actualizar el patrón."],
    needsConfig: false,
  },
  {
    key: "queue.no_bot_exit",
    block: "AHORA",
    label: "Sin salida del bot registrada",
    definition: "Conversaciones en espera que no tienen el cambio de estado de salida del bot.",
    source: "ConversationStateHistory",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Puede ser un evento que no llegó o que quedó sin procesar, no solo un caso trabado en el bot."],
    needsConfig: false,
  },
  {
    key: "queue.old_open",
    block: "AHORA",
    label: "Abiertas hace más de 72 horas",
    definition: "Conversaciones abiertas esperando cuya espera empezó hace más de 72 horas.",
    source: "Conversation.status, ConversationMessage",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [],
    needsConfig: false,
  },
  {
    key: "queue.waiting_now",
    block: "AHORA",
    label: "Conversaciones esperando respuesta",
    definition:
      "Abiertas esperando cuya espera empezó hace 72 horas o menos. Las abiertas con más espera se muestran " +
      "aparte, como casos antiguos por revisar, y no cuentan como conversaciones esperando.",
    source: "Conversation.status, ConversationMessage",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Incluye mensajes finales del cliente que no piden respuesta."],
    needsConfig: false,
  },
  {
    key: "queue.today",
    block: "AHORA",
    label: "Entraron hoy y respondidos hoy",
    definition:
      "Conversaciones creadas hoy, en hora de Buenos Aires, y de esas las que ya tienen al menos una " +
      "respuesta pública de un operador. Es una sola población.",
    source: "Conversation.createdAt, ConversationMessage",
    population: "ENTRADA",
    denominator: "Conversaciones creadas hoy",
    evidence: "MEDIDO",
    limitations: ["No cuenta las respuestas dadas hoy a conversaciones creadas otros días."],
    needsConfig: false,
  },
  {
    key: "queue.closed_needs_reply",
    block: "AHORA",
    label: "Cerradas sin responder",
    definition:
      "Cerradas cuyo último mensaje público es del cliente, de los últimos 7 días, en las que el último " +
      "bloque del cliente tiene una consulta, un pedido o un adjunto. Quedan afuera los agradecimientos, " +
      "los avisos de que ya compró, los que no son clientes y las consultas que el bot ya contestó.",
    source: "Conversation.status, ConversationMessage (texto y adjuntos)",
    population: "AHORA",
    denominator: null,
    evidence: "DETECTADO",
    limitations: [
      "Depende de palabras: no toma los reclamos escritos sin signo de pregunta.",
      "Una imagen sola cuenta como receta o comprobante: puede ser otra cosa.",
      "Depende de los textos del bot: si cambian, hay que actualizar los patrones.",
    ],
    needsConfig: false,
  },
  {
    key: "queue.whatsapp_window",
    block: "AHORA",
    label: "Ventana de WhatsApp",
    definition:
      "Regla de Meta: desde el último mensaje del cliente hay 24 horas de reloj para responder libremente; " +
      "después, la conversación solo se reabre con una plantilla aprobada. \"Cerrada\" es que pasaron más de " +
      "24 horas; \"por vencer\", que todavía se puede responder y falta menos que el aviso configurado " +
      "(4 horas si no se cargó). Tiempo real: corre de noche, fines de semana y feriados. Es independiente " +
      "del semáforo de la meta, que mide minutos hábiles.",
    source: "ConversationMessage.sentAt del último mensaje del cliente",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [
      "Usa la hora del mensaje que informa Emozion. No se consulta a WhatsApp si la ventana sigue abierta.",
      "Un mensaje del cliente que no llegó a la plataforma no reabre la ventana acá.",
    ],
    needsConfig: false,
  },
  {
    key: "whatsapp_window.closed_unanswered",
    block: "ATENCION",
    label: "Ventana de WhatsApp cerrada sin respuesta",
    definition:
      "Conversaciones en las que pasaron más de 24 horas de reloj desde el último mensaje del cliente sin la " +
      "primera respuesta de una persona, o en las que esa respuesta llegó después. Para retomarlas hace falta " +
      "una plantilla aprobada: es una oportunidad perdida. En \"Atención y demoras\" cuenta las que entraron en " +
      "el período; en Avances, las que se cerraron hoy contra el mismo día de la semana anterior a la misma hora.",
    source: "ConversationMessage.sentAt",
    population: "ENTRADA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [
      "Mira solo la primera respuesta: no cuenta las ventanas que se cierran más adelante en la conversación, " +
        "porque ahí el último mensaje del cliente suele ser un agradecimiento.",
      "No cuenta las conversaciones en las que el cliente solo saludó, agradeció o tocó botones del bot.",
      "Las conversaciones de los últimos dos días pueden no haber llegado todavía a las 24 horas.",
    ],
    needsConfig: false,
  },
  {
    key: "queue.not_customers",
    block: "DATOS",
    label: "No son clientes",
    definition: "Cerradas de los últimos 7 días cuyo último bloque es de un proveedor, un currículum o publicidad.",
    source: "ConversationMessage (texto)",
    population: "AHORA",
    denominator: null,
    evidence: "DETECTADO",
    limitations: ["Depende de palabras: puede dejar afuera a un cliente o no reconocer a un proveedor."],
    needsConfig: false,
  },
  {
    key: "freshness",
    block: "AHORA",
    label: "Última actualización",
    definition: "Hora del último evento recibido de Emozion y del último mensaje guardado.",
    source: "WebhookEvent.receivedAt, ConversationMessage.sentAt",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Fuera del horario de atención es normal que pasen varios minutos sin eventos."],
    needsConfig: false,
  },

  // ── Atención y demoras ─────────────────────────────────────────────────────────────
  {
    key: "entries",
    block: "ATENCION",
    label: "Entradas",
    definition: "Conversaciones creadas en el día.",
    source: "Conversation.createdAt",
    population: "ENTRADA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Un agradecimiento posterior a un cierre abre una conversación nueva y cuenta como entrada."],
    needsConfig: false,
  },
  {
    key: "active_customer",
    block: "ATENCION",
    label: "Conversaciones con actividad del cliente",
    definition: "Conversaciones con al menos un mensaje del cliente en el día, sin importar cuándo se crearon.",
    source: "ConversationMessage",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Una conversación cuenta en cada día en que tuvo actividad: no se suma entre días."],
    needsConfig: false,
  },
  {
    key: "attended",
    block: "ATENCION",
    label: "Conversaciones atendidas",
    definition: "Conversaciones con al menos un mensaje público de operador en el día.",
    source: "ConversationMessage",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Una conversación cuenta en cada día en que tuvo actividad: no se suma entre días."],
    needsConfig: false,
  },
  {
    key: "bot_time",
    block: "ATENCION",
    label: "Tiempo en el bot",
    definition: "Desde la creación de la conversación hasta la salida del bot. Se muestra por vía de salida.",
    source: "Conversation.createdAt, ConversationStateHistory",
    population: "ENTRADA",
    denominator: "Conversaciones con salida del bot registrada",
    evidence: "MEDIDO",
    limitations: [BOT_EXIT],
    needsConfig: false,
  },
  {
    key: "first_response.clock",
    block: "ATENCION",
    label: "Primera respuesta humana (tiempo de reloj)",
    definition:
      "Desde la salida del bot hasta el primer mensaje público de un operador, en tiempo de reloj. Si no hay " +
      "salida del bot registrada, desde la creación. Mediana y percentil 90.",
    source: "ConversationStateHistory, ConversationMessage",
    population: "ENTRADA",
    denominator: "Conversaciones respondidas; las pendientes se muestran al lado con su antigüedad",
    evidence: "MEDIDO",
    limitations: [BOT_EXIT, "Incluye noches, fines de semana y feriados.", QUEUE_NO_ASSIGNEE],
    needsConfig: false,
  },
  {
    key: "first_response.business",
    block: "ATENCION",
    label: "Primera respuesta humana (tiempo hábil)",
    definition:
      "Igual que la anterior, contando solo los minutos dentro del horario público. Lo que entra fuera de " +
      "horario empieza a contar al abrir. Lo respondido fuera del horario público, antes de que vuelva a abrir, " +
      "no entra en la meta: se informa aparte como \"Respondidas fuera del horario público\", con su espera real.",
    source: "ConversationStateHistory, ConversationMessage, configuración",
    population: "ENTRADA",
    denominator: "Conversaciones respondidas; las pendientes se muestran al lado con su antigüedad",
    evidence: "MEDIDO",
    limitations: [BOT_EXIT, "Usa el horario vigente cada día y descuenta los feriados nacionales.", QUEUE_NO_ASSIGNEE],
    needsConfig: true,
  },
  {
    key: "first_response.from_first_message",
    block: "ATENCION",
    label: "Espera desde el primer mensaje del cliente",
    definition:
      "Desde el primer mensaje del cliente hasta el primer mensaje público de un operador, en tiempo de reloj. " +
      "Suma el tiempo en el bot y la espera humana.",
    source: "ConversationMessage",
    population: "ENTRADA",
    denominator: "Conversaciones respondidas; las pendientes se muestran al lado con su antigüedad",
    evidence: "MEDIDO",
    limitations: ["Incluye el tiempo que el cliente pasó en el bot: no es demora del equipo."],
    needsConfig: false,
  },
  {
    key: "goal.compliance",
    block: "ATENCION",
    label: "Cumplimiento de la meta",
    definition:
      "Conversaciones con primera respuesta humana dentro de la meta de minutos hábiles, sobre las respondidas " +
      "más los pendientes ya vencidos. Los candidatos a agradecimiento cuentan como pendientes vencidos; al " +
      "lado se muestra la cifra sin ellos.",
    source: "ConversationStateHistory, ConversationMessage, configuración",
    population: "ENTRADA",
    denominator: "Respondidas más pendientes vencidos. Los pendientes dentro del plazo se muestran aparte",
    evidence: "MEDIDO",
    limitations: [BOT_EXIT, "Un pendiente incumple cuando vence su plazo, no cuando entra.", QUEUE_NO_ASSIGNEE],
    needsConfig: true,
  },
  {
    key: "pending_at_close",
    block: "ATENCION",
    label: "Pendientes al cierre",
    definition:
      "Conversaciones que salieron del bot dentro del horario público del día y al cierre de ese horario no " +
      "tenían respuesta de una persona.",
    source: "ConversationStateHistory, ConversationMessage, configuración",
    population: "ENTRADA",
    denominator: "Conversaciones que salieron del bot dentro del horario público",
    evidence: "MEDIDO",
    limitations: [BOT_EXIT],
    needsConfig: true,
  },
  {
    key: "unanswered_same_day",
    block: "ATENCION",
    label: "Sin respuesta el día de entrada",
    definition:
      "Conversaciones creadas en el día que terminaron ese día sin respuesta de una persona. Se muestra el " +
      "total, las que entraron dentro del horario público y las que tenían pedido completo en el bot.",
    source: "Conversation.createdAt, ConversationMessage",
    population: "ENTRADA",
    denominator: "Entradas del día",
    evidence: "MEDIDO",
    limitations: ["El total incluye lo que entró fuera de horario; por eso se muestra junto con el de horario público."],
    needsConfig: true,
  },
  {
    key: "late_orders_same_day",
    block: "ATENCION",
    label: "Pedidos desde las 17:00 respondidos en el día",
    definition: "Pedidos creados desde las 17:00 que tuvieron respuesta de una persona el mismo día.",
    source: "Conversation.createdAt, ConversationMessage",
    population: "ENTRADA",
    denominator: "Pedidos creados desde las 17:00",
    evidence: "DETECTADO",
    limitations: ["El tipo de gestión \"pedido\" se detecta por el recorrido del bot."],
    needsConfig: false,
  },
  {
    key: "followup_response",
    block: "ATENCION",
    label: "Respuestas posteriores",
    definition:
      "Por cada bloque de mensajes seguidos del cliente posterior a una respuesta de operador: del primer " +
      "mensaje del bloque al siguiente mensaje público de operador. La espera no se reinicia si el cliente insiste.",
    source: "ConversationMessage",
    population: "ACTIVIDAD",
    denominator: "Bloques respondidos; los que no tuvieron respuesta se muestran aparte",
    evidence: "MEDIDO",
    limitations: ["El último bloque de una conversación suele ser un mensaje que no pide respuesta."],
    needsConfig: false,
  },
  {
    key: "management_type",
    block: "ATENCION",
    label: "Tipo de gestión",
    definition:
      "Pedido: el cliente eligió pedir medicamentos o el bot preguntó por la cobertura. Meducar: el primer " +
      "mensaje del cliente es el pedido sobre una receta con enlace de Meducar. El resto: otros.",
    source: "ConversationMessage (texto del bot y del cliente)",
    population: "ENTRADA",
    denominator: null,
    evidence: "DETECTADO",
    limitations: ["Depende de los textos del bot y del mensaje de Meducar."],
    needsConfig: false,
  },

  // ── Operadores (por cuenta de Emozion) ─────────────────────────────────────────────
  {
    key: "account.conversations",
    block: "OPERADORES",
    label: "Conversaciones con participación",
    definition: "Conversaciones con al menos un mensaje público de la cuenta en el período.",
    source: "ConversationMessage.externalSenderId",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [
      "Una conversación con dos cuentas cuenta para las dos y una sola vez en el total del equipo.",
      "Una cuenta no es una persona: puede estar prestada o compartida.",
    ],
    needsConfig: false,
  },
  {
    key: "account.first_responses",
    block: "OPERADORES",
    label: "Primeras respuestas",
    definition: "Primeras respuestas humanas que dio la cuenta, con la demora de los casos que tomó.",
    source: "ConversationMessage, ConversationStateHistory",
    population: "ENTRADA",
    denominator: "Primeras respuestas dadas por la cuenta",
    evidence: "MEDIDO",
    limitations: [QUEUE_NO_ASSIGNEE, "No sirve para ordenar cuentas: depende de qué casos tomó cada una y en qué turno."],
    needsConfig: false,
  },
  {
    key: "account.followups",
    block: "OPERADORES",
    label: "Respuestas posteriores",
    definition: "Respuestas posteriores dadas por la cuenta, con mediana y percentil 90.",
    source: "ConversationMessage",
    population: "ACTIVIDAD",
    denominator: "Bloques respondidos por la cuenta",
    evidence: "MEDIDO",
    limitations: ["Se atribuye a la cuenta que respondió, que puede no ser la que venía atendiendo."],
    needsConfig: false,
  },
  {
    key: "account.private_notes",
    block: "OPERADORES",
    label: "Notas internas",
    definition: "Mensajes de la cuenta marcados como nota interna.",
    source: "ConversationMessage.isPrivate",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [],
    needsConfig: false,
  },
  {
    key: "account.observed_activity",
    block: "OPERADORES",
    label: "Actividad observada",
    definition:
      "Primer y último mensaje del día y mensajes dentro del horario público, dentro del horario de " +
      "operadores y fuera de ambos.",
    source: "ConversationMessage, configuración",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Es actividad, no jornada: no indica conexión ni horas trabajadas."],
    needsConfig: true,
  },

  // ── Ventas SIAF ────────────────────────────────────────────────────────────────────
  {
    key: "sales.gross",
    block: "VENTAS",
    label: "Importe bruto",
    definition: "Suma del importe bruto de los vendedores configurados como Call Center, por sucursal y día.",
    source: "SalesSnapshot.rawData.vendedores, configuración",
    population: "COMPROBANTE",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [
      "Es bruto y ya descuenta las notas de crédito. No es efectivo cobrado.",
      "Las ventas se cargan con un día de atraso.",
      "Los coseguros son cobertura de la misma venta y no se suman.",
    ],
    needsConfig: true,
  },
  {
    key: "sales.receipts",
    block: "VENTAS",
    label: "Comprobantes",
    definition: "Cantidad de comprobantes distintos de los vendedores configurados como Call Center.",
    source: "SalesSnapshot.rawData.vendedores, configuración",
    population: "COMPROBANTE",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Incluye las notas de crédito como comprobantes: no es una cantidad de ventas."],
    needsConfig: true,
  },
  {
    key: "sales.discounts",
    block: "VENTAS",
    label: "Descuentos",
    definition: "Suma de descuentos de los vendedores configurados como Call Center.",
    source: "SalesSnapshot.rawData.vendedores, configuración",
    population: "COMPROBANTE",
    denominator: null,
    evidence: "MEDIDO",
    limitations: ["Se muestra aparte: bruto menos descuentos no es lo cobrado."],
    needsConfig: true,
  },
  {
    key: "sales.receipts_per_100_orders",
    block: "VENTAS",
    label: "Comprobantes cada 100 pedidos",
    definition:
      "Comprobantes sobre pedidos, por cien. Pedido es una conversación de pedido en el bot o una receta de " +
      "Meducar (Meducar es un pedido con receta), creada ese día. Se calcula solo sobre los días que tienen " +
      "ventas de SIAF cargadas.",
    source: "SalesSnapshot, Conversation, configuración",
    population: "COMPROBANTE",
    denominator: "Pedidos (pedido en el bot o receta de Meducar) de los días con ventas cargadas",
    evidence: "MEDIDO",
    limitations: [
      "Es una relación de volúmenes, no una tasa de conversión: no hay vínculo entre conversación y comprobante.",
    ],
    needsConfig: true,
  },

  // ── Detectados ─────────────────────────────────────────────────────────────────────
  {
    key: "detected.candidates",
    block: "DETECTADOS",
    label: "Posibles reclamos y pérdidas",
    definition:
      "Conversaciones creadas en el período con mensajes del cliente que coinciden con los patrones de cada " +
      "grupo. Ventas: pérdida confirmada (otra farmacia, otro lado o cancela), compró por su cuenta sin decir " +
      "dónde, y compró en TKL (menciona TKL o una sucursal, o ya retiró el pedido); las tres van por separado " +
      "y solo la primera es una pérdida. Reclamos del Call Center: demora, pedido sin novedades, producto o " +
      "cantidad incorrectos, stock, factura con queja, precio o cobertura, pago o devolución, trato y otros. " +
      "Envíos: no llegó el pedido y problema con la entrega. Tienda online: pagó y no recibió la confirmación, " +
      "y problemas con la página.",
    source: "ConversationMessage (texto del cliente)",
    population: "ENTRADA",
    denominator: null,
    evidence: "DETECTADO",
    limitations: [
      "Son candidatos para revisar, no reclamos ni pérdidas confirmados.",
      "Una frase como \"ya compré\" puede ser una compra en la propia farmacia.",
      "No se atribuye una pérdida a la demora.",
    ],
    needsConfig: false,
  },

  // ── Calidad de los datos ───────────────────────────────────────────────────────────
  {
    key: "data.unprocessed_events",
    block: "DATOS",
    label: "Eventos sin procesar",
    definition: "Eventos de Emozion que quedaron con error o sin procesar: mensajes o cambios de estado que faltan.",
    source: "WebhookEvent.status",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [],
    needsConfig: false,
  },
  {
    key: "data.bot_exit_coverage",
    block: "DATOS",
    label: "Cobertura de la salida del bot",
    definition: "Porcentaje de las conversaciones del período que tienen registrada la salida del bot.",
    source: "ConversationStateHistory",
    population: "ENTRADA",
    denominator: "Entradas del período",
    evidence: "MEDIDO",
    limitations: ["Que exista el evento no prueba que represente siempre una derivación efectiva."],
    needsConfig: false,
  },
  {
    key: "data.unknown_accounts",
    block: "DATOS",
    label: "Cuentas sin configurar",
    definition: "Cuentas de Emozion con mensajes en el período que no figuran en la configuración.",
    source: "ConversationMessage.externalSenderId, configuración",
    population: "ACTIVIDAD",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [],
    needsConfig: true,
  },
  {
    key: "data.sales_last_day",
    block: "DATOS",
    label: "Último día de ventas cargado",
    definition: "Fecha más reciente con ventas de SIAF cargadas.",
    source: "SalesSnapshot.snapshotDate",
    population: "AHORA",
    denominator: null,
    evidence: "MEDIDO",
    limitations: [],
    needsConfig: false,
  },
];

const BY_KEY = new Map(INDICATORS.map((i) => [i.key, i]));

/** Definición de un indicador. Lanza si la clave no existe: es un error de programación. */
export function indicator(key: string): IndicatorDefinition {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Indicador desconocido: ${key}`);
  return def;
}

export function indicatorsOfBlock(block: IndicatorBlock): IndicatorDefinition[] {
  return INDICATORS.filter((i) => i.block === block);
}

/**
 * Nivel de evidencia a mostrar: el del indicador, o "No disponible" si necesita
 * configuración y no hay una versión vigente.
 */
export function effectiveEvidence(def: IndicatorDefinition, hasConfig: boolean): EvidenceLevel {
  return def.needsConfig && !hasConfig ? "NO_DISPONIBLE" : def.evidence;
}
