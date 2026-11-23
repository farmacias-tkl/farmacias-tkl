/**
 * Tipos de la respuesta del bloque "Ahora" y de la pestaña "Calidad de datos", y su
 * intervalo de refresco. Archivo aparte, sin imports de servidor, para que las pantallas
 * (cliente) los usen sin arrastrar Prisma.
 *
 * "Ahora" responde una sola pregunta: quién está esperando en este momento. Mira solo las
 * abiertas con hasta `windowHours` de espera. Lo demás (abiertas viejas, cerradas, histórico
 * y calidad de datos) va aparte y no se suma a la cola.
 */
import type { QueueGroupCounts } from "./queue-types";
import type { WindowState } from "./whatsapp-window";

/** Segundos de caché del bloque en el servidor y de refresco en la pantalla. */
export const NOW_CACHE_SECONDS = 60;

/** Semáforo de espera, en minutos hábiles del horario público. */
export type WaitLevel = "EN_PLAZO" | "DEMORADO" | "CRITICO" | "FUERA_HORARIO";

/**
 * Responsable de un caso, según la cuenta de Emozion asignada y la configuración vigente:
 * una cuenta de sistema (asignación automática), una cuenta configurada, o nadie identificado
 * (sin asignado, o asignado a una cuenta que no está en la configuración).
 */
export type NowOwner =
  | { kind: "SYSTEM" }
  | { kind: "ACCOUNT"; /** Alias de la configuración, o "cuenta N" si no tiene. */ label: string }
  | { kind: "UNKNOWN" };

export interface NowListItem {
  conversationId: string;
  /** Estado de la conversación: PENDIENTE, SIN_ASIGNAR o ASIGNADA. */
  status: string;
  owner: NowOwner;
  /** ISO. Cuándo entró la conversación. */
  createdAt: string;
  /** ISO. Desde cuándo espera: primer mensaje del cliente del bloque sin responder. */
  waitStart: string;
  waitMinutes: number;
  /** ISO. Último mensaje del cliente: desde acá corre la ventana de WhatsApp. */
  lastCustomerAt: string;
  /** Ventana de 24 horas de WhatsApp, en tiempo real. Independiente del semáforo. */
  window: WindowState;
  /**
   * Alerta por lo que escribió el cliente y sigue sin respuesta de un operador: URGENTE por
   * palabras (pide urgencia o avisa que se va); INSISTIENDO por 2 mensajes o más separados por
   * más de 10 minutos después del bot. Si son las dos, URGENTE. null si ninguna.
   */
  alert: "URGENTE" | "INSISTIENDO" | null;
  /** null si no hay configuración vigente: sin horario no hay semáforo. */
  level: WaitLevel | null;
  /** Minutos hábiles de espera; null sin configuración. */
  businessMinutes: number | null;
  hasHumanResponse: boolean;
  botOrderComplete: boolean;
  thanksCandidate: boolean;
}

/**
 * Abierta con más de `windowHours` de espera, para revisar.
 *  - PROBABLE_CLOSE: el último mensaje del cliente es un agradecimiento o un cierre;
 *    probablemente quedó resuelta y abierta por error;
 *  - PENDING: sigue pendiente;
 *  - null: no se pudo clasificar.
 */
export type StaleKind = "PROBABLE_CLOSE" | "PENDING";

export interface NowStaleItem {
  conversationId: string;
  waitStart: string;
  kind: StaleKind | null;
  /** Pasaron más de 24 horas desde el último mensaje del cliente: requiere plantilla. */
  windowClosed: boolean;
}

export type ClosedReason = "QUESTION" | "ORDER" | "ATTACHMENT";

export interface NowClosedItem {
  conversationId: string;
  /** ISO. Último mensaje del cliente. */
  lastCustomerAt: string;
  reason: ClosedReason;
}

/** Cerradas sin responder de los últimos `days` días, por lo que pedía el último bloque del cliente. */
export interface ClosedUnansweredReport {
  days: number;
  total: number;
  question: number;
  order: number;
  attachment: number;
  /** Proveedores, currículums y publicidad: no entran en total ni en la lista. */
  notCustomers: number;
  items: NowClosedItem[];
}

/** Primera respuesta de un día, vista a una hora dada. */
export interface ProgressSide {
  day: string;
  entries: number;
  /** Cumplimiento de la meta entre las evaluables. null sin configuración o sin evaluables. */
  compliance: number | null;
  /** Mediana hábil de la primera respuesta, entre las respondidas. null si no hay. */
  medianBusinessMinutes: number | null;
  /** ¿Ese día tiene horario público? null sin configuración. Si no tiene, la meta pública no aplica a sus entradas. */
  hasPublicHours: boolean | null;
  /** Recibieron la primera respuesta de una persona, y siguen sin ella, vistas a esa hora. */
  answered: number;
  pending: number;
  /** Mediana de la espera real (de reloj) hasta la primera respuesta, entre las respondidas. null si no hay. */
  medianClockMinutes: number | null;
}

/** "Avances": el turno de hoy y la primera respuesta frente al mismo día de la semana anterior. */
export interface NowProgress {
  /** null antes del primer turno del día, un día sin turno o sin configuración: no hay dato, no es cero. */
  shift: {
    startedAt: string;
    /** Abiertas con el último mensaje del cliente y hasta 72 horas de espera, al empezar el turno. */
    pendingAtStart: number;
    /** De esas, las que recibieron una respuesta pública de un operador desde entonces. */
    attendedSince: number;
  } | null;
  /** Hoy hasta ahora, y el mismo día de la semana anterior cortado a la misma hora. */
  firstResponse: { today: ProgressSide; previous: ProgressSide };
  /**
   * Conversaciones cuya ventana de 24 horas de WhatsApp se cerró sin la primera respuesta:
   * hoy hasta ahora, y el mismo día de la semana anterior hasta la misma hora. Por momento
   * del cierre, no por fecha de entrada. null si no se pudo calcular.
   */
  windowClosed: { today: number; previous: number } | null;
}

/** Controles de "Calidad de datos" sobre los últimos `days` días. */
export interface QualityChecks {
  days: number;
  /** Eventos de Emozion: con error, recibidos sin procesar y total recibido. */
  events: { error: number; received: number; total: number };
  /** Conversaciones creadas en la ventana y cuántas tienen registrada la salida del bot. */
  botExit: { entries: number; withExit: number };
  /** Números de cuenta con mensajes que no están en la configuración. null sin configuración vigente. */
  unknownAccounts: string[] | null;
  /** Último día con ventas de SIAF cargadas. null si no hay ninguno. */
  salesLastDay: string | null;
}

export interface NowGroup extends Omit<QueueGroupCounts, "oldestWaitStart"> {
  oldestWaitStart: string | null;
}

export interface NowPayload {
  generatedAt: string;
  /** Horas de espera hasta las que una abierta cuenta como cliente esperando. */
  windowHours: number;
  /** Horario y umbrales del semáforo al momento del cálculo. null sin configuración vigente. */
  schedule: {
    inPublicHours: boolean;
    /** Fuera del horario público pero dentro del de operadores. Ese turno no tiene objetivo. */
    operatorShiftActive: boolean;
    goalMinutes: number;
    criticalMinutes: number;
  } | null;
  /** Abiertas con hasta `windowHours` de espera. */
  waiting: {
    total: number;
    /** Esperan la primera respuesta de una persona. */
    neverHuman: number;
    /** Ya les respondieron y volvieron a escribir. */
    awaitingNext: number;
    /** Sin respuesta de una persona y con pedido completo en el bot. */
    completedOrders: number;
    /** En demora crítica según el semáforo. null sin configuración vigente. */
    critical: number | null;
    oldestWaitStart: string | null;
    /** Clientes urgentes (por palabras) e insistiendo (sin contar los urgentes), sin respuesta de un operador. */
    urgent: number;
    insisting: number;
  };
  /**
   * Hoy, día de Buenos Aires. null si no se pudo calcular. Son dos poblaciones:
   *  - entered / answered: las creadas hoy y, de esas, las que ya tienen respuesta de una persona;
   *  - attended: conversaciones con al menos una respuesta pública de un operador hoy, se
   *    hayan creado cuando se hayan creado (incluye el atraso de días anteriores).
   */
  today: { entered: number; answered: number; attended: number } | null;
  /** Las de `waiting`, de la espera más vieja a la más nueva. */
  list: NowListItem[];
  /** Filas de la lista antes del tope. */
  listTotal: number;
  /** Abiertas con más de `windowHours` de espera: no cuentan como clientes esperando. */
  stale: {
    total: number;
    /** null si no se pudieron clasificar. Las dos suman `total`: ninguna desaparece. */
    probableClose: number | null;
    pending: number | null;
    oldestWaitStart: string | null;
    items: NowStaleItem[];
  };
  /** null si no se pudo calcular. Cada caso lleva si su ventana de WhatsApp ya está cerrada. */
  closedUnanswered: (Omit<ClosedUnansweredReport, "notCustomers" | "items"> & { items: Array<NowClosedItem & { windowClosed: boolean }> }) | null;
  /**
   * Ventana de WhatsApp: 24 horas de reloj desde el último mensaje del cliente (regla de
   * Meta). Conteos sobre todos los casos, no solo sobre las filas que entran en las listas.
   */
  window: {
    hours: number;
    /** Aviso de "por vencer", de la configuración vigente o el valor por defecto. */
    warningHours: number;
    /** Entre los que esperan (`waiting`): cerrada, y por vencer. */
    closed: number;
    closing: number;
    /** Entre los antiguos (`stale`). */
    staleClosed: number;
    /** Entre las cerradas sin responder; null si no se pudieron calcular. */
    closedUnansweredClosed: number | null;
  };
  /** null si no se pudo calcular. */
  progress: NowProgress | null;
  /** Lo que muestra la pestaña "Calidad de datos". */
  quality: {
    /** Evidencia de actualización. null si no hay ningún evento o mensaje. */
    freshness: { lastWebhookAt: string | null; lastMessageAt: string | null };
    /** Todas las abiertas esperando, de cualquier antigüedad. */
    openWaiting: NowGroup;
    /** Cerradas cuyo último mensaje es del cliente, creadas desde closedSince, sin filtrar por contenido. */
    closedUnanswered: NowGroup;
    closedSince: string;
    /** Las anteriores a closedSince. null si no se pudo calcular. */
    closedBefore: { total: number; neverHuman: number; awaitingNext: number; completedOrders: number } | null;
    /** No son clientes, en los últimos días de closedUnanswered. null si no se pudo calcular. */
    notCustomers: number | null;
    notCustomersDays: number;
    /** null si no se pudieron calcular. */
    checks: QualityChecks | null;
  };
}
