/**
 * Tipos de "Motivos de contacto". Archivo aparte, sin imports de servidor, para que la
 * pantalla (cliente) los use sin arrastrar Prisma.
 *
 * La pestaña responde una sola pregunta: ¿para qué nos escriben los clientes? El motivo es la
 * NECESIDAD que originó el contacto, no cómo terminó la gestión: los resultados (venta,
 * pérdida, no se pudo vender) viven en "Reclamos y pérdidas".
 */
import type { ConsultKind, MainKind } from "./kinds-types";

/**
 * Motivo principal: uno por conversación, así el resumen suma el total.
 *  - PEDIDO: solicita medicamentos o productos, compre o no al final;
 *  - CONSULTA: precio, disponibilidad, cobertura, horarios, sucursales, pagos o servicios;
 *  - SEGUIMIENTO: pregunta por una entrega, retiro, pago o gestión que ya inició;
 *  - RECLAMO: expresa un problema con un pedido, cobro, entrega o atención;
 *  - SALUDO: solo saludo o agradecimiento, sin otra solicitud;
 *  - NO_IDENTIFICADO: la información no alcanza para clasificarlo.
 */
export type Motive = "PEDIDO" | "CONSULTA" | "SEGUIMIENTO" | "RECLAMO" | "SALUDO" | "NO_IDENTIFICADO";
export const MOTIVES: readonly Motive[] = ["PEDIDO", "CONSULTA", "SEGUIMIENTO", "RECLAMO", "SALUDO", "NO_IDENTIFICADO"];

export const MOTIVE_LABELS: Record<Motive, string> = {
  PEDIDO: "Solicitar un pedido",
  CONSULTA: "Hacer una consulta",
  SEGUIMIENTO: "Consultar un pedido o pago existente",
  RECLAMO: "Hacer un reclamo",
  SALUDO: "Solo saludo o agradecimiento",
  NO_IDENTIFICADO: "Motivo no identificado",
};

/** Por qué una solicitud de pedido se reconoce como tal: la señal más fuerte que tiene. */
export type OrderSignal = "RECETA" | "DATOS_COMPLETOS" | "TEXTO" | "BOTON_Y_CONTENIDO";
export const ORDER_SIGNALS: readonly OrderSignal[] = ["RECETA", "DATOS_COMPLETOS", "TEXTO", "BOTON_Y_CONTENIDO"];

/** Por qué no se pudo identificar el motivo. */
export type UnknownReason = "BOTON_PEDIDO" | "ADJUNTO" | "ASESOR" | "SOLO_BOTONES" | "SIN_MENSAJES" | "TEXTO";
export const UNKNOWN_REASONS: readonly UnknownReason[] = ["BOTON_PEDIDO", "ADJUNTO", "ASESOR", "SOLO_BOTONES", "SIN_MENSAJES", "TEXTO"];

export interface ConversationMotive {
  main: Motive;
  /** Los demás temas tratados en la conversación, sin el principal. */
  extra: Motive[];
  /** Tema de la consulta, cuando el principal es CONSULTA. */
  consult: ConsultKind | null;
  orderSignal: OrderSignal | null;
  unknownReason: UnknownReason | null;
  /** Característica del contacto, no un motivo: ¿trae una receta digital?, ¿de qué plataforma? */
  prescription: { has: boolean; platform: string | null };
}

export type MotiveCounts = Record<Motive, number>;

export interface MotivesPayload {
  /** Base de los porcentajes: todas las conversaciones del período, incluidos saludo y no identificado. */
  conversations: number;
  total: MotiveCounts;
  /** Conversaciones en las que cada motivo aparece como tema adicional. */
  extra: MotiveCounts;
  consults: Record<ConsultKind, number>;
  orderSignals: Record<OrderSignal, number>;
  unknownReasons: Record<UnknownReason, number>;
  /** Conversaciones con receta digital y de qué plataforma ("otra" si no se reconoce el dominio). */
  prescription: { has: number; byPlatform: Array<{ platform: string; count: number }> };
  byDay: Array<{ day: string } & MotiveCounts>;
  /** Por hora de Buenos Aires de entrada: 24 posiciones. */
  byHour: MotiveCounts[];
  /** Cuánto cambia respecto de la clasificación anterior ("Tipos"): por tipo anterior, en qué motivo quedó. */
  fromKind: Record<MainKind, MotiveCounts>;
}

/** Una conversación del detalle de un motivo: id interno (para el enlace), fecha y marcas. Sin teléfono, nombre ni texto. */
export interface MotiveCase {
  conversationId: string;
  createdAt: string;
  /** Los demás temas tratados. */
  extra: Motive[];
  consult: ConsultKind | null;
  orderSignal: OrderSignal | null;
  unknownReason: UnknownReason | null;
  prescription: boolean;
}

export interface MotiveCasesPayload {
  motive: Motive;
  from: string;
  to: string;
  generatedAt: string;
  /** Conversaciones con ese motivo principal, antes del tope de filas. */
  total: number;
  cases: MotiveCase[];
}

export const MOTIVE_CASES_MAX_ROWS = 200;

export function isMotive(v: unknown): v is Motive {
  return typeof v === "string" && (MOTIVES as readonly string[]).includes(v);
}
