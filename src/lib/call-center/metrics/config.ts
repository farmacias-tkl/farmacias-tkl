/**
 * Versiones de la configuración de las métricas y cuál rige cada día.
 *
 * Regla de vigencia: para un día vale la versión con mayor validFrom que no lo supere; a
 * igual validFrom, la creada más tarde. Antes de la primera versión no hay configuración:
 * los indicadores que dependen de ella se muestran como "No disponible", nunca con un
 * horario supuesto.
 *
 * Las funciones de selección son PURAS (se prueban sin base). loadConfigVersions es la
 * única que toca Prisma.
 */
import { prisma } from "@/lib/prisma";
import { parseConfigData, type CallCenterMetricsConfigData } from "./config-schema";

export interface ConfigVersion {
  id: string;
  /** Día de Buenos Aires desde el que rige, "YYYY-MM-DD". */
  validFrom: string;
  createdAt: Date;
  data: CallCenterMetricsConfigData;
}

/** Ordena de la más nueva a la más vieja: validFrom desc y, a igualdad, createdAt desc. */
export function sortVersions(versions: readonly ConfigVersion[]): ConfigVersion[] {
  return [...versions].sort((a, b) =>
    a.validFrom === b.validFrom
      ? b.createdAt.getTime() - a.createdAt.getTime()
      : a.validFrom < b.validFrom ? 1 : -1,
  );
}

/** Versión que rige el día `dayISO` ("YYYY-MM-DD"), o null si todavía no había ninguna. */
export function configForDay(versions: readonly ConfigVersion[], dayISO: string): ConfigVersion | null {
  for (const v of sortVersions(versions)) {
    if (v.validFrom <= dayISO) return v;
  }
  return null;
}

/** Qué período rige una versión, o si quedó reemplazada y no rige ningún día. */
export type VersionPeriod =
  | { superseded: true }
  /** `to` es el último día en que rige; null si sigue vigente sin fecha de fin. */
  | { superseded: false; from: string; to: string | null };

const previousDayISO = (dayISO: string) =>
  new Date(new Date(`${dayISO}T00:00:00.000Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/**
 * Período de cada versión, por id. Una versión queda REEMPLAZADA cuando hay otra con la
 * misma fecha de vigencia creada después: no rige ningún día. Las demás rigen desde su
 * fecha hasta el día anterior a la siguiente; la última, sin fecha de fin. Es la misma
 * regla de configForDay, vista por versión en lugar de por día.
 */
export function versionPeriods(versions: readonly ConfigVersion[]): Map<string, VersionPeriod> {
  const out = new Map<string, VersionPeriod>();
  // De la más nueva a la más vieja: la primera que aparece de cada fecha es la que rige.
  const effective: ConfigVersion[] = [];
  const seen = new Set<string>();
  for (const v of sortVersions(versions)) {
    if (seen.has(v.validFrom)) { out.set(v.id, { superseded: true }); continue; }
    seen.add(v.validFrom);
    effective.push(v);
  }
  effective.forEach((v, i) => {
    const next = i > 0 ? effective[i - 1] : null; // la siguiente en el tiempo
    out.set(v.id, { superseded: false, from: v.validFrom, to: next ? previousDayISO(next.validFrom) : null });
  });
  return out;
}

/** "2026-03-01" → "01/03"; con el año si no es el de `today`. */
function shortDay(dayISO: string, today: string): string {
  const [y, m, d] = dayISO.split("-");
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

/** Texto del período para la tabla de versiones. `today` es el día de Buenos Aires. */
export function versionPeriodLabel(period: VersionPeriod, today: string): string {
  if (period.superseded) return "Reemplazada";
  const future = period.from > today;
  const from = shortDay(period.from, today);
  if (period.to === null) return `${future ? "Regirá" : "Rige"} desde el ${from}`;
  return `${future ? "Regirá" : "Rige"} del ${from} al ${shortDay(period.to, today)}`;
}

/**
 * Lee todas las versiones. Una fila cuyo JSON no valida se descarta y se informa en
 * `invalid` (solo el id): no se usa una configuración a medias. Son pocas filas: una por
 * cada cambio de horario, meta, cuentas o vendedores.
 */
export async function loadConfigVersions(): Promise<{ versions: ConfigVersion[]; invalid: string[] }> {
  const rows = await prisma.callCenterMetricsConfig.findMany({
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
    select: { id: true, validFrom: true, createdAt: true, data: true },
  });
  const versions: ConfigVersion[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    const parsed = parseConfigData(row.data);
    if (!parsed.ok) { invalid.push(row.id); continue; }
    versions.push({
      id: row.id,
      validFrom: row.validFrom.toISOString().slice(0, 10), // @db.Date → 00:00 UTC
      createdAt: row.createdAt,
      data: parsed.data,
    });
  }
  return { versions, invalid };
}
