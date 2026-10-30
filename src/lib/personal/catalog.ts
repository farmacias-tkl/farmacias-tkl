// =============================================================================
// Catálogos cerrados de personal: puestos y códigos de sucursal.
//
// Las reglas de negocio reconocen los puestos por POSITION_KEYS, nunca por
// textos sueltos. La clave sale del nombre exacto del catálogo (normalizado:
// sin tildes, minúsculas), así "Encargado/a" en la base es ENCARGADO.
// =============================================================================

export const POSITION_CATALOG = [
  { key: "ENCARGADO",      name: "Encargado/a" },
  { key: "FARMACEUTICO",   name: "Farmacéutico/a" },
  { key: "ATENCION",       name: "Representante de Atención al Cliente" },
  { key: "CAJERO",         name: "Cajero/a" },
  { key: "ADMINISTRATIVO", name: "Administrativo/a" },
  { key: "PERFUMERIA",     name: "Perfumería" },
  { key: "LABORATORIO",    name: "Laboratorio (magistrales)" },
  { key: "CADETERIA",      name: "Reposición / Cadetería" },
  { key: "MAESTRANZA",     name: "Maestranza / Limpieza" },
  { key: "CALL_CENTER",    name: "Call Center" },
  { key: "SUPERVISOR",     name: "Supervisor/a" },
] as const;

export type PositionKey = (typeof POSITION_CATALOG)[number]["key"];

/** Puestos que se cubren con rotativos (adenda D). */
export const ROTATIVE_COVERAGE_KEYS: readonly PositionKey[] = ["CADETERIA", "CAJERO", "MAESTRANZA"];

export function normalizeLabel(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const KEY_BY_LABEL = new Map<string, PositionKey>(
  POSITION_CATALOG.map((p) => [normalizeLabel(p.name), p.key]),
);

/** Clave del catálogo para un nombre de puesto, o null si no es del catálogo. */
export function positionKeyOf(name: string | null | undefined): PositionKey | null {
  if (!name) return null;
  return KEY_BY_LABEL.get(normalizeLabel(name)) ?? null;
}

export function usesRotativeCoverage(key: PositionKey | null): boolean {
  return !!key && ROTATIVE_COVERAGE_KEYS.includes(key);
}

// -----------------------------------------------------------------------------
// Zonas (Branch.zone). La cobertura con rotativos aplica solo a CABA: en
// PROVINCIA (o sucursal sin zona) no se proponen rotativos, no hay advertencia
// "sin rotativo libre" y la solicitud no queda "sin cobertura".
// -----------------------------------------------------------------------------
export const ROTATIVE_ZONE = "CABA";

export function isRotativeZone(zone: string | null | undefined): boolean {
  return !!zone && normalizeLabel(zone) === normalizeLabel(ROTATIVE_ZONE);
}

/** Se cubre con rotativos: puesto de cobertura y sucursal en zona CABA. */
export function coveredByRotatives(key: PositionKey | null, branchZone: string | null | undefined): boolean {
  return usesRotativeCoverage(key) && isRotativeZone(branchZone);
}

// -----------------------------------------------------------------------------
// Sucursales. code → nombre REAL en la tabla Branch (no el nombre comercial:
// "Central San Miguel" es "San Miguel" en la base). El UPDATE que carga
// Branch.code está en prisma/gates/2026-10-29-personal-real.sql.
// -----------------------------------------------------------------------------
export const BRANCH_CODES: Record<string, string> = {
  AME: "America",
  AYA: "Facultad",
  CSM: "San Miguel",
  ETC: "Etcheverry",
  GAL: "Galesa",
  LAR: "Larcade",
  MUN: "La Perla",
  NAV: "Naveira",
  QUI: "Quintana",
  SAG: "San Agustin",
  TEK: "Tekiel",
};

/** Valor de los CSV para "trabaja en el Call Center" (no es un código de sucursal). */
export const CALL_CENTER_TOKEN = "CALLCENTER";
export const CALL_CENTER_BRANCH_NAME = "Call Center";
