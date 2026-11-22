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
  /** null si no hay configuración vigente: sin horario no hay semáforo. */
  level: WaitLevel | null;
  /** Minutos hábiles de espera; null sin configuración. */
  businessMinutes: number | null;
  hasHumanResponse: boolean;
  botOrderComplete: boolean;
  thanksCandidate: boolean;
}

/** Abierta con más de `windowHours` de espera: para cerrar en Emozion. */
export interface NowStaleItem {
  conversationId: string;
  waitStart: string;
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
    oldestWaitStart: string | null;
  };
  /** Creadas hoy (día de Buenos Aires) y, de esas, las que ya tienen respuesta de una persona. null si no se pudo calcular. */
  today: { entered: number; answered: number } | null;
  /** Las de `waiting`, de la espera más vieja a la más nueva. */
  list: NowListItem[];
  /** Filas de la lista antes del tope. */
  listTotal: number;
  /** Abiertas con más de `windowHours` de espera: no cuentan como clientes esperando. */
  stale: { total: number; oldestWaitStart: string | null; items: NowStaleItem[] };
  /** null si no se pudo calcular. */
  closedUnanswered: Omit<ClosedUnansweredReport, "notCustomers"> | null;
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
  };
}
