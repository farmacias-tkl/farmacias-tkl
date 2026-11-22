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
