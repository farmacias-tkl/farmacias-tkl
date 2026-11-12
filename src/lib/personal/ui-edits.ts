// =============================================================================
// Cambios hechos en la plataforma que la carga de personal no debe pisar.
// Lógica pura: recibe filas de AuditLog y devuelve qué campo de qué persona
// se editó a mano después de la última carga.
//
// Qué cuenta como "editado en la plataforma":
//   - AuditLog UPDATE / Employee (PATCH /api/employees/[id]): detail trae, por
//     campo, { from, to }. El formulario manda todos los campos, cambien o no,
//     así que solo cuentan los que tienen from distinto de to.
//   - AuditLog ASSIGN_BRANCH / Employee con type PERMANENT: cambia la sucursal
//     donde trabaja.
//   - Lo que la carga anterior ya dejó sin pisar (PERSONAL_LOAD.detail
//     .keptUiEdits): sin esto, la protección duraría una sola carga, porque
//     esa carga pasa a ser "la última" y la edición queda antes que ella.
//
// "Última carga" = el AuditLog PERSONAL_LOAD más reciente. Sin cargas previas
// cuentan todas las ediciones.
// =============================================================================

/** Campos de empleados.csv, con el nombre de la columna (o "activo" para la situación). */
export type EmployeeUiField =
  | "nombre" | "trabaja_en" | "puesto" | "puesto_secundario" | "dt" | "rotativo"
  | "horas_semanales" | "fecha_ingreso" | "tareas_adicionales" | "activo";

/** "horario" = horarios.csv · "situacion" = licencia de la columna situacion. */
export type UiField = EmployeeUiField | "horario" | "situacion";

export interface UiEdit {
  employeeId: string;
  field: UiField;
  /** Cuándo se editó en la plataforma (ISO). */
  at: string;
  /** Solo "situacion": período de la licencia tocada en la plataforma. */
  range?: { startDate: string; endDate: string };
}

/** Campo del detalle de AuditLog UPDATE/Employee → columna de la planilla. */
export const AUDIT_FIELD_TO_CSV: Record<string, EmployeeUiField> = {
  firstName: "nombre",
  lastName: "nombre",
  currentBranchId: "trabaja_en",
  positionId: "puesto",
  secondaryPositionId: "puesto_secundario",
  isTechnicalDirector: "dt",
  isRotating: "rotativo",
  weeklyHours: "horas_semanales",
  hireDate: "fecha_ingreso",
  extraTasks: "tareas_adicionales",
  active: "activo",
};

export interface AuditRow {
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  createdAt: Date | string;
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Valores comparables: el "from" sale de la base (Decimal, Date) y el "to" del formulario. */
function comparable(key: string, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (key === "weeklyHours") { const n = Number(v); return Number.isNaN(n) ? String(v) : n; }
  if (key === "hireDate") return String(v).slice(0, 10);
  return v;
}

const iso = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).toISOString();

/** Ediciones que una carga dejó sin pisar, guardadas en PERSONAL_LOAD.detail.keptUiEdits. */
export function keptUiEditsOf(detail: unknown): UiEdit[] {
  if (!isObject(detail) || !Array.isArray(detail.keptUiEdits)) return [];
  const out: UiEdit[] = [];
  for (const k of detail.keptUiEdits) {
    if (!isObject(k) || typeof k.employeeId !== "string" || typeof k.field !== "string" || typeof k.at !== "string") continue;
    const range = isObject(k.range) && typeof k.range.startDate === "string" && typeof k.range.endDate === "string"
      ? { startDate: k.range.startDate, endDate: k.range.endDate } : undefined;
    out.push({ employeeId: k.employeeId, field: k.field as UiField, at: k.at, ...(range && { range }) });
  }
  return out;
}

/**
 * Ediciones de campos de empleado hechas en la plataforma después de la última
 * carga, más todo lo que la última carga dejó sin pisar (también horarios y
 * licencias). Una por (persona, campo), con la fecha de la edición más reciente.
 */
export function employeeUiEdits(rows: AuditRow[]): { lastLoadAt: string | null; edits: UiEdit[] } {
  const loads = rows.filter((r) => r.action === "PERSONAL_LOAD")
    .sort((a, b) => iso(a.createdAt).localeCompare(iso(b.createdAt)));
  const last = loads.length ? loads[loads.length - 1] : null;
  const lastLoadAt = last ? iso(last.createdAt) : null;

  const byKey = new Map<string, UiEdit>();
  const add = (e: UiEdit) => {
    const key = `${e.employeeId}|${e.field}|${e.range?.startDate ?? ""}`;
    const prev = byKey.get(key);
    if (!prev || prev.at < e.at) byKey.set(key, e);
  };
  if (last) for (const k of keptUiEditsOf(last.detail)) add(k);

  for (const r of rows) {
    if (r.entity !== "Employee" || !r.entityId) continue;
    const at = iso(r.createdAt);
    if (lastLoadAt && at <= lastLoadAt) continue;
    if (r.action === "UPDATE" && isObject(r.detail)) {
      for (const [key, change] of Object.entries(r.detail)) {
        const field = AUDIT_FIELD_TO_CSV[key];
        if (!field || !isObject(change) || !("to" in change)) continue;
        if (comparable(key, change.from) === comparable(key, change.to)) continue;
        add({ employeeId: r.entityId, field, at });
      }
    } else if (r.action === "ASSIGN_BRANCH" && isObject(r.detail) && r.detail.type === "PERMANENT") {
      add({ employeeId: r.entityId, field: "trabaja_en", at });
    }
  }
  return { lastLoadAt, edits: [...byKey.values()] };
}
