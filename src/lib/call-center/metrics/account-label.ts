/**
 * Cómo se nombra una cuenta de Emozion en pantalla. PURO, sin imports de servidor.
 *
 * El nombre sale SOLO de la configuración de métricas vigente: el alias, o "Cuenta N" si la
 * cuenta no tiene alias o no está configurada. Una cuenta no es una persona.
 */
import { isSupervisionAccount, isSystemAccount, type ConfigAccount } from "./config-schema";

/** OPERADOR incluye las cuentas que no están en la configuración: no se sabe que sean otra cosa. */
export type AccountRole = "OPERADOR" | "SUPERVISION" | "SISTEMA";

export interface AccountRef {
  account: string;
  /** Alias de la configuración, o "Cuenta N". */
  label: string;
  role: AccountRole;
}

/** Subconjunto de la configuración que hace falta para nombrar una cuenta. */
export type LabelAccount = Pick<ConfigAccount, "externalId" | "alias" | "system" | "supervision">;

/**
 * Un bot de Emozion como asignado (el del menú, por ejemplo). Los bots y los usuarios tienen
 * numeraciones separadas, así que un bot NUNCA se busca entre las cuentas de la configuración:
 * su clave lleva este prefijo y cuenta como sistema ("Sin tomar"), no como una persona.
 */
export const BOT_ACCOUNT_PREFIX = "bot:";

/**
 * Clave de cuenta del asignado de una conversación: el id, o "bot:<id>" si el evento dijo que
 * es un bot. Sin tipo (dato anterior, o el evento no lo dijo) vale el id solo, como hasta ahora.
 */
export function assigneeAccount(id: string | null, type: string | null | undefined): string | null {
  return id && type === "AGENT_BOT" ? `${BOT_ACCOUNT_PREFIX}${id}` : id;
}

export function accountRef(account: string, accounts: readonly LabelAccount[]): AccountRef {
  if (account.startsWith(BOT_ACCOUNT_PREFIX)) {
    return { account, label: `Bot ${account.slice(BOT_ACCOUNT_PREFIX.length)}`, role: "SISTEMA" };
  }
  const cfg = accounts.find((a) => a.externalId === account);
  const alias = cfg?.alias?.trim();
  return {
    account,
    label: alias ? alias : `Cuenta ${account}`,
    role: !cfg ? "OPERADOR" : isSystemAccount(cfg) ? "SISTEMA" : isSupervisionAccount(cfg) ? "SUPERVISION" : "OPERADOR",
  };
}

/** Clave de quién tiene un caso: todas las cuentas de sistema comparten una, y sin asignado otra. */
export const OWNER_KEY_SYSTEM = "system";
export const OWNER_KEY_NONE = "none";

export function ownerKeyOf(assignee: string | null, accounts: readonly LabelAccount[]): string {
  if (!assignee) return OWNER_KEY_NONE;
  return accountRef(assignee, accounts).role === "SISTEMA" ? OWNER_KEY_SYSTEM : `a:${assignee}`;
}

/** Textos fijos de quién tiene un caso. */
export const OWNER_TEXT = {
  system: "Sin tomar",
  none: "Sin dato de asignado",
  supervision: "supervisión",
} as const;

/** "Alias" o "Alias · supervisión". */
export function accountDisplay(ref: AccountRef): string {
  return ref.role === "SUPERVISION" ? `${ref.label} · ${OWNER_TEXT.supervision}` : ref.label;
}

/** Texto de quién atiende un caso según su asignado actual. */
export function ownerDisplay(assignee: string | null, accounts: readonly LabelAccount[]): string {
  if (!assignee) return OWNER_TEXT.none;
  const ref = accountRef(assignee, accounts);
  return ref.role === "SISTEMA" ? OWNER_TEXT.system : accountDisplay(ref);
}
