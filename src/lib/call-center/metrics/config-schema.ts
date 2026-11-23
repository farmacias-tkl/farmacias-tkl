/**
 * Forma y validación de la configuración de las métricas del Call Center (el JSON de
 * CallCenterMetricsConfig.data). PURO: sin Prisma ni red.
 *
 * Los valores reales (horarios, cuentas de Emozion, vendedores de SIAF) los carga Dirección
 * desde la plataforma y viven solo en la base. Acá no hay ningún valor por defecto con datos
 * de la operación; los ejemplos de las pruebas son inventados.
 */
import { z } from "zod";

export const CONFIG_SCHEMA_VERSION = 1;

/** Días de la semana ISO: 1 = lunes … 7 = domingo. */
export const ISO_WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" → minutos desde las 00:00. "24:00" vale solo como fin de franja. */
export function hhmmToMinutes(s: string): number {
  if (s === "24:00") return 1440;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

const timeRangeSchema = z
  .object({
    from: z.string().regex(HHMM, "Hora de inicio inválida (HH:MM)"),
    to: z.string().refine((v) => v === "24:00" || HHMM.test(v), "Hora de fin inválida (HH:MM)"),
  })
  .strict()
  .refine((r) => hhmmToMinutes(r.from) < hhmmToMinutes(r.to), "La franja tiene que terminar después de empezar");

export type TimeRange = z.infer<typeof timeRangeSchema>;

/** Franjas de un día: ordenadas y sin superponerse. Un día sin atención es una lista vacía. */
const dayRangesSchema = z
  .array(timeRangeSchema)
  .max(6)
  .refine((ranges) => {
    for (let i = 1; i < ranges.length; i++) {
      if (hhmmToMinutes(ranges[i].from) < hhmmToMinutes(ranges[i - 1].to)) return false;
    }
    return true;
  }, "Las franjas de un día van en orden y sin superponerse");

/** Horario semanal: los siete días, cada uno con sus franjas. */
const weekScheduleSchema = z
  .object({
    "1": dayRangesSchema, "2": dayRangesSchema, "3": dayRangesSchema, "4": dayRangesSchema,
    "5": dayRangesSchema, "6": dayRangesSchema, "7": dayRangesSchema,
  })
  .strict();

export type WeekSchedule = z.infer<typeof weekScheduleSchema>;

const accountSchema = z
  .object({
    /** Número de la cuenta en Emozion (ConversationMessage.externalSenderId). */
    externalId: z.string().trim().min(1).max(64).regex(/^\S+$/, "Sin espacios"),
    /** Texto que se muestra en lugar del número. No es el nombre de una persona. */
    alias: z.string().trim().max(60).nullable(),
    /** La cuenta está en uso. Una ausencia temporal no la desactiva. */
    active: z.boolean(),
    /** La usa otra persona que su titular: no se atribuye a nadie. */
    borrowed: z.boolean(),
    /** Ya no se usa; se muestra solo en los períodos en que tuvo actividad. */
    historical: z.boolean(),
    /**
     * Cuenta de sistema: no es una persona (por ejemplo, una cuenta a la que Emozion asigna
     * conversaciones de forma automática). OPCIONAL: las versiones guardadas antes de este
     * campo no lo traen y siguen siendo válidas; ausente equivale a false (isSystemAccount).
     * Por ahora solo se guarda: ni la bandeja ni las métricas lo usan todavía.
     */
    system: z.boolean().optional(),
  })
  .strict()
  .refine((a) => !(a.active && a.historical), "Una cuenta no puede ser activa e histórica a la vez");

export type ConfigAccount = z.infer<typeof accountSchema>;

/** ¿Es una cuenta de sistema? El campo es opcional: sin él, no lo es. */
export function isSystemAccount(a: Pick<ConfigAccount, "system">): boolean {
  return a.system === true;
}

const vendorSchema = z
  .object({
    /** Branch.id. Los códigos de vendedor de SIAF son por sucursal. */
    branchId: z.string().trim().min(1).max(64),
    /** Código de vendedor de SIAF en esa sucursal. */
    code: z.string().trim().min(1).max(32),
    /**
     * Cuenta de operador (externalId de `accounts`) a la que pertenece este código, para
     * juntar en una ficha los códigos que una misma persona tiene en distintas sucursales.
     * OPCIONAL: las versiones guardadas antes de este campo no lo traen y siguen siendo
     * válidas; sin el campo, el código se muestra en su propia ficha.
     */
    accountId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type ConfigVendor = z.infer<typeof vendorSchema>;

export const callCenterMetricsConfigSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    /** Horario que se le informa al cliente. La meta de primera respuesta corre solo acá. */
    publicHours: weekScheduleSchema,
    /** Horario en que trabajan los operadores. Sirve para la actividad fuera del horario público. */
    operatorHours: weekScheduleSchema,
    /** Meta de primera respuesta humana, en minutos hábiles del horario público. */
    firstResponseGoalMinutes: z.number().int().min(1).max(1440),
    /**
     * Minutos hábiles de espera a partir de los cuales un caso es "crítico" en el semáforo de
     * "Ahora" (entre la meta y este valor es "demorado"). OPCIONAL: las versiones guardadas
     * antes de este campo no lo traen y siguen siendo válidas; ausente vale
     * DEFAULT_CRITICAL_WAIT_MINUTES (criticalWaitMinutesOf).
     */
    criticalWaitMinutes: z.number().int().min(1).max(1440).optional(),
    /**
     * Horas antes del cierre de la ventana de WhatsApp desde las que un caso se marca "por
     * vencer" en "Ahora". OPCIONAL, igual que criticalWaitMinutes: ausente vale
     * DEFAULT_WINDOW_WARNING_HOURS. Las 24 horas de la ventana son una regla de Meta y no se
     * configuran (whatsapp-window.ts).
     */
    windowWarningHours: z.number().int().min(1).max(23).optional(),
    accounts: z.array(accountSchema).max(100),
    callCenterVendors: z.array(vendorSchema).max(500),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.criticalWaitMinutes !== undefined && cfg.criticalWaitMinutes <= cfg.firstResponseGoalMinutes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["criticalWaitMinutes"], message: "La demora crítica tiene que ser mayor que la meta" });
    }
    const ids = new Set<string>();
    for (const a of cfg.accounts) {
      if (ids.has(a.externalId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accounts"], message: `Cuenta repetida: ${a.externalId}` });
      }
      ids.add(a.externalId);
    }
    const vendors = new Set<string>();
    for (const v of cfg.callCenterVendors) {
      const key = `${v.branchId}|${v.code}`;
      if (vendors.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["callCenterVendors"], message: "Vendedor repetido en la misma sucursal" });
      }
      vendors.add(key);
      if (v.accountId !== undefined && !ids.has(v.accountId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["callCenterVendors"], message: "Vendedor asociado a una cuenta que no está en la lista de cuentas" });
      }
    }
  });

export type CallCenterMetricsConfigData = z.infer<typeof callCenterMetricsConfigSchema>;

/** Demora crítica cuando la versión no la trae. */
export const DEFAULT_CRITICAL_WAIT_MINUTES = 60;

/**
 * Minutos hábiles desde los que un caso es crítico. Sin el campo vale el valor por defecto;
 * nunca queda por debajo de la meta (una versión vieja con una meta mayor a 60 minutos).
 */
export function criticalWaitMinutesOf(d: Pick<CallCenterMetricsConfigData, "firstResponseGoalMinutes" | "criticalWaitMinutes">): number {
  return Math.max(d.criticalWaitMinutes ?? DEFAULT_CRITICAL_WAIT_MINUTES, d.firstResponseGoalMinutes + 1);
}

/** Aviso de ventana por vencer cuando la versión no lo trae. */
export const DEFAULT_WINDOW_WARNING_HOURS = 4;

export function windowWarningHoursOf(d: Pick<CallCenterMetricsConfigData, "windowWarningHours">): number {
  return d.windowWarningHours ?? DEFAULT_WINDOW_WARNING_HOURS;
}

export type ParseConfigResult =
  | { ok: true; data: CallCenterMetricsConfigData }
  | { ok: false; errors: string[] };

/** Valida el JSON de una versión. Los mensajes llevan la ruta del campo, nunca el valor. */
export function parseConfigData(raw: unknown): ParseConfigResult {
  const r = callCenterMetricsConfigSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`),
  };
}
