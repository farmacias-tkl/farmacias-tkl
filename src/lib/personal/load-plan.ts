// =============================================================================
// Carga de personal real: plan (lógica pura).
//
// Entrada: el texto de los tres CSV y una foto de lo que hay en la base.
// Salida: qué se crearía, actualizaría o quedaría igual, con los errores y
// avisos de cada fila. scripts/load-personal.ts lo imprime (dry-run) y, con
// --apply y sin errores, lo escribe con load-apply.ts.
//
// Identidad de una persona: "apellido, nombre" normalizado + sucursal de
// contrato (dos personas pueden llamarse igual en sucursales distintas).
//
// CSV (formato del encargo r1; apellido_nombre = "Apellido, Nombre" con coma):
//   empleados.csv  apellido_nombre, contrato, trabaja_en, puesto,
//                  puesto_secundario, dt, rotativo, horas_semanales,
//                  fecha_ingreso, situacion, situacion_desde, situacion_hasta,
//                  tareas_adicionales
//   horarios.csv   apellido_nombre, contrato, vigente_desde, semana, referencia_ab,
//                  dia, tramo, entrada, salida, sucursal, otro_lugar
//   saldos.csv     apellido_nombre, contrato, anio, dias
//
// Cambios hechos en la plataforma: si un campo se editó a mano después de la
// última carga (DbSnapshot.uiEdits, ver ui-edits.ts) y la planilla dice otra
// cosa, es un CONFLICTO: no se pisa, queda como está en la plataforma y se
// informa en la vista previa. Solo se pisa con overwriteUiEdits
// (--overwrite-ui-edits). Vale para los campos de empleados.csv, para la
// licencia de la columna situacion y para horarios.csv.
// =============================================================================

import { parseCsv, type CsvRow } from "./csv";
import { splitApellidoNombre } from "./names";
import {
  BRANCH_CODES, CALL_CENTER_BRANCH_NAME, CALL_CENTER_TOKEN, POSITION_CATALOG,
  normalizeLabel, positionKeyOf,
} from "./catalog";
import { parseISODate, toISODate } from "./dates";
import type { EmployeeUiField, UiEdit, UiField } from "./ui-edits";
import {
  parseHHMM, validateSchedule, weeklyHours, weeklyHoursWarning,
  type ScheduleSlot, type ScheduleWeekValue,
} from "./schedule";

// -----------------------------------------------------------------------------
// Foto de la base (la arma load-apply.ts con Prisma)
// -----------------------------------------------------------------------------

export interface SnapshotEmployee {
  id: string;
  nameKey: string;
  contractBranchId: string;
  firstName: string;
  lastName: string;
  positionId: string;
  secondaryPositionId: string | null;
  isTechnicalDirector: boolean;
  isRotating: boolean;
  currentBranchId: string | null;
  weeklyHours: number | null;
  hireDate: string | null; // YYYY-MM-DD
  extraTasks: string | null;
  active: boolean;
}

export interface DbSnapshot {
  branches: Array<{ id: string; name: string; code: string | null }>;
  positions: Array<{ id: string; name: string }>;
  /** Solo empleados con nameKey (cargados por este script). */
  employees: SnapshotEmployee[];
  schedules: Array<{ employeeId: string; validFrom: string; abReferenceDate: string | null; slots: ScheduleSlot[] }>;
  balances: Array<{ employeeId: string; year: number; days: number }>;
  /** Empleados con movimientos CONSUME o REFUND: su saldo no se recarga sin --force-saldos. */
  employeesWithConsumption: string[];
  leaves: Array<{ employeeId: string; absenceType: string; startDate: string; endDate: string }>;
  /** Fecha (ISO) del último AuditLog PERSONAL_LOAD; null si nunca se cargó. */
  lastLoadAt?: string | null;
  /** Campos editados en la plataforma después de la última carga (ver ui-edits.ts). */
  uiEdits?: UiEdit[];
}

export interface LoadPlanOptions {
  /** --force-saldos: recargar el saldo aunque la persona tenga consumos/devoluciones (queda LOAD_ADJUST). */
  forceBalances?: boolean;
  /** --overwrite-ui-edits: pisar con la planilla también lo que se editó en la plataforma. */
  overwriteUiEdits?: boolean;
}

/** Un campo que la plataforma y la planilla tienen distinto, editado a mano después de la última carga. */
export interface UiConflict {
  personKey: string;
  name: string;
  file: FileName;
  line: number;
  field: UiField;
  /** Valor actual en la plataforma y valor de la planilla, ya legibles. */
  platform: string;
  csv: string;
  /** Cuándo se editó en la plataforma (ISO). */
  editedAt: string;
  /** true = se pisa igual (--overwrite-ui-edits); false = queda como está en la plataforma. */
  overwritten: boolean;
  /** Para dejar constancia en el AuditLog de la carga. */
  employeeId: string;
  range?: { startDate: string; endDate: string };
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

export type FileName = "empleados.csv" | "horarios.csv" | "saldos.csv";

export interface RowIssue {
  file: FileName;
  line: number;
  message: string;
}

export interface EmployeeData {
  firstName: string;
  lastName: string;
  nameKey: string;
  contractBranchId: string;
  currentBranchId: string | null;
  positionName: string;       // nombre del catálogo
  secondaryPositionName: string | null;
  isTechnicalDirector: boolean;
  isRotating: boolean;
  weeklyHours: number | null;
  hireDate: string | null;
  extraTasks: string | null;
  /** La planilla siempre trae personal activo; false solo si se dio de baja en la plataforma y no se pisa. */
  active: boolean;
}

export interface PlannedEmployee {
  personKey: string;
  line: number;
  action: "create" | "update" | "unchanged";
  existingId: string | null;
  changes: string[];
  data: EmployeeData;
}

export interface PlannedSchedule {
  personKey: string;
  validFrom: string;
  abReferenceDate: string | null;
  slots: ScheduleSlot[];
  /** conflict = el horario se editó en la plataforma: no se crea el de la planilla. */
  action: "create" | "unchanged" | "conflict";
  hours: { A: number; B: number; alternating: boolean };
}

export interface PlannedBalance {
  personKey: string;
  year: number;
  days: number;
  previous: number | null;
  /** blocked = la persona ya tiene consumos o devoluciones y no se pasó --force-saldos. */
  action: "create" | "update" | "unchanged" | "blocked";
}

export const LEAVE_SITUATIONS: Record<string, "MEDICAL_LEAVE" | "MATERNITY_LEAVE" | "SPECIAL_LEAVE"> = {
  "licencia medica": "MEDICAL_LEAVE",
  "licencia por maternidad": "MATERNITY_LEAVE",
  "otra licencia": "SPECIAL_LEAVE",
};

export interface PlannedLeave {
  personKey: string;
  absenceType: "MEDICAL_LEAVE" | "MATERNITY_LEAVE" | "SPECIAL_LEAVE";
  startDate: string;
  endDate: string;
  /** conflict = la licencia de ese período se tocó en la plataforma: no se crea la de la planilla. */
  action: "create" | "unchanged" | "conflict";
}

export interface LoadPlan {
  errors: RowIssue[];
  warnings: RowIssue[];
  positionsToCreate: string[];
  employees: PlannedEmployee[];
  schedules: PlannedSchedule[];
  balances: PlannedBalance[];
  leaves: PlannedLeave[];
  /** situacion = Vacaciones: no se crea VacationRequest, solo se lista. */
  vacationSituations: Array<{ personKey: string; name: string; startDate: string; endDate: string; line: number }>;
  branchNames: Record<string, string>;
  forceBalances: boolean;
  /** Campos editados en la plataforma que la planilla trae distintos. */
  conflicts: UiConflict[];
  overwriteUiEdits: boolean;
  lastLoadAt: string | null;
}

const REQUIRED_HEADERS: Record<FileName, string[]> = {
  "empleados.csv": ["apellido_nombre", "contrato", "trabaja_en", "puesto", "puesto_secundario", "dt", "rotativo",
    "horas_semanales", "fecha_ingreso", "situacion", "situacion_desde", "situacion_hasta", "tareas_adicionales"],
  "horarios.csv": ["apellido_nombre", "contrato", "vigente_desde", "semana", "referencia_ab", "dia", "tramo",
    "entrada", "salida", "sucursal", "otro_lugar"],
  "saldos.csv": ["apellido_nombre", "contrato", "anio", "dias"],
};

export const personKeyOf = (nameKey: string, contractBranchId: string) => `${nameKey}|${contractBranchId}`;

/** Código de sucursal de los CSV → id (por Branch.code o, si falta, por el nombre real). CALLCENTER solo si se permite. */
export function branchIdByCode(
  branches: Array<{ id: string; name: string; code: string | null }>,
  code: string,
  allowCallCenter: boolean,
): string | null {
  const c = code.trim().toUpperCase();
  if (c === CALL_CENTER_TOKEN) {
    if (!allowCallCenter) return null;
    return branches.find((b) => b.name === CALL_CENTER_BRANCH_NAME)?.id ?? null;
  }
  if (!BRANCH_CODES[c]) return null;
  return branches.find((b) => b.code === c)?.id
    ?? branches.find((b) => b.name === BRANCH_CODES[c])?.id
    ?? null;
}

/** "2026-03-01" o "01/03/2026" → "2026-03-01". */
export function parseFlexibleDate(s: string): string | null {
  const t = s.trim();
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : t;
  const d = parseISODate(iso);
  return d ? toISODate(d) : null;
}

function parseYesNo(s: string): boolean | null {
  const t = normalizeLabel(s);
  if (t === "s" || t === "si") return true;
  if (t === "n" || t === "no" || t === "") return false;
  return null;
}

function parseNumber(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const sameSlots = (a: ScheduleSlot[], b: ScheduleSlot[]) => {
  const key = (s: ScheduleSlot) => [s.week, s.dayOfWeek, s.slot, s.startMinute, s.endMinute, s.branchId ?? "", s.otherPlace ?? ""].join("|");
  const ka = a.map(key).sort(), kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
};

export function buildLoadPlan(files: Record<FileName, string>, db: DbSnapshot, opts: LoadPlanOptions = {}): LoadPlan {
  const forceBalances = opts.forceBalances === true;
  const overwriteUiEdits = opts.overwriteUiEdits === true;
  const conflicts: UiConflict[] = [];
  const uiEdits = db.uiEdits ?? [];
  /** Edición en la plataforma de ese campo de esa persona, si hubo. */
  const uiEditOf = (employeeId: string, field: UiField) =>
    uiEdits.filter((e) => e.employeeId === employeeId && e.field === field).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const err = (file: FileName, line: number, message: string) => errors.push({ file, line, message });
  const warn = (file: FileName, line: number, message: string) => warnings.push({ file, line, message });
  const branchNames = Object.fromEntries(db.branches.map((b) => [b.id, b.name]));

  // --- Resolución de sucursales y puestos ---
  const branchByCode = (code: string, allowCallCenter: boolean) => branchIdByCode(db.branches, code, allowCallCenter);
  const catalogName = (s: string) => {
    const key = positionKeyOf(s);
    return key ? POSITION_CATALOG.find((p) => p.key === key)!.name : null;
  };
  const positionIdByName = new Map(db.positions.map((p) => [p.name, p.id]));
  const positionsToCreate = POSITION_CATALOG.map((p) => p.name).filter((n) => !positionIdByName.has(n));

  const parsed: Record<FileName, CsvRow[]> = {} as Record<FileName, CsvRow[]>;
  for (const f of Object.keys(REQUIRED_HEADERS) as FileName[]) {
    const csv = parseCsv(files[f] ?? "");
    const missing = REQUIRED_HEADERS[f].filter((h) => !csv.headers.includes(h));
    if (missing.length) err(f, 1, `Faltan columnas: ${missing.join(", ")}.`);
    parsed[f] = missing.length ? [] : csv.rows;
  }

  // Persona de una fila (apellido_nombre + contrato)
  const personOf = (file: FileName, row: CsvRow): { nameKey: string; contractBranchId: string; lastName: string; firstName: string } | null => {
    const name = splitApellidoNombre(row.values.apellido_nombre ?? "");
    if (!name) { err(file, row.line, `apellido_nombre "${row.values.apellido_nombre}" tiene que ser "Apellido, Nombre" (con una coma).`); return null; }
    const contractBranchId = branchByCode(row.values.contrato ?? "", false);
    if (!contractBranchId) { err(file, row.line, `Sucursal de contrato desconocida: "${row.values.contrato}".`); return null; }
    return { ...name, contractBranchId };
  };

  const existingByKey = new Map(db.employees.map((e) => [personKeyOf(e.nameKey, e.contractBranchId), e]));

  // --- empleados.csv ---
  const employees: PlannedEmployee[] = [];
  const leaves: PlannedLeave[] = [];
  const vacationSituations: LoadPlan["vacationSituations"] = [];
  const seen = new Map<string, number>();
  /** Sucursal donde trabaja según la planilla (data.currentBranchId puede quedar con la de la plataforma). */
  const csvBranchByKey = new Map<string, string | null>();
  for (const row of parsed["empleados.csv"]) {
    const F: FileName = "empleados.csv";
    const v = row.values;
    const person = personOf(F, row);
    if (!person) continue;
    const key = personKeyOf(person.nameKey, person.contractBranchId);
    if (seen.has(key)) { err(F, row.line, `Persona duplicada (misma que la línea ${seen.get(key)}).`); continue; }
    seen.set(key, row.line);

    let ok = true;
    const rotativo = parseYesNo(v.rotativo);
    if (rotativo === null) { err(F, row.line, `rotativo tiene que ser S o N: "${v.rotativo}".`); ok = false; }
    const dt = parseYesNo(v.dt);
    if (dt === null) { err(F, row.line, `dt tiene que ser S o N: "${v.dt}".`); ok = false; }

    let currentBranchId: string | null = null;
    if (v.trabaja_en) {
      currentBranchId = branchByCode(v.trabaja_en, true);
      if (!currentBranchId) { err(F, row.line, `Sucursal donde trabaja desconocida: "${v.trabaja_en}".`); ok = false; }
    } else if (!rotativo) {
      err(F, row.line, "Falta trabaja_en (solo puede quedar vacío para rotativos).");
      ok = false;
    }

    const positionName = catalogName(v.puesto);
    if (!positionName) { err(F, row.line, `Puesto desconocido: "${v.puesto}".`); ok = false; }
    const secondaryPositionName = v.puesto_secundario ? catalogName(v.puesto_secundario) : null;
    if (v.puesto_secundario && !secondaryPositionName) { err(F, row.line, `Puesto secundario desconocido: "${v.puesto_secundario}".`); ok = false; }

    let weeklyHoursValue: number | null = null;
    if (v.horas_semanales) {
      weeklyHoursValue = parseNumber(v.horas_semanales);
      if (weeklyHoursValue === null || weeklyHoursValue > 168) { err(F, row.line, `horas_semanales mal escritas: "${v.horas_semanales}".`); ok = false; }
      else if (weeklyHoursValue > 48) warn(F, row.line, `horas_semanales ${weeklyHoursValue} (más de 48).`);
    } else if (rotativo) {
      warn(F, row.line, "Rotativo/a sin horas_semanales.");
    }

    let hireDate: string | null = null;
    if (v.fecha_ingreso) {
      hireDate = parseFlexibleDate(v.fecha_ingreso);
      if (!hireDate) { err(F, row.line, `fecha_ingreso inválida: "${v.fecha_ingreso}".`); ok = false; }
    }

    // Situación
    const situation = normalizeLabel(v.situacion || "activo");
    if (!["activo", "activa", "activo/a", "vacaciones", ...Object.keys(LEAVE_SITUATIONS)].includes(situation)) {
      err(F, row.line, `situacion desconocida: "${v.situacion}".`); ok = false;
    }
    let sitStart: string | null = null, sitEnd: string | null = null;
    if (!situation.startsWith("activ")) {
      sitStart = parseFlexibleDate(v.situacion_desde ?? "");
      sitEnd = parseFlexibleDate(v.situacion_hasta ?? "");
      if (!sitStart || !sitEnd) { err(F, row.line, "situacion_desde y situacion_hasta son obligatorias (YYYY-MM-DD) si no está activo/a."); ok = false; }
      else if (sitEnd < sitStart) { err(F, row.line, "situacion_hasta es anterior a situacion_desde."); ok = false; }
    }
    if (!ok) continue;

    csvBranchByKey.set(key, currentBranchId);
    const data: EmployeeData = {
      firstName: person.firstName,
      lastName: person.lastName,
      nameKey: person.nameKey,
      contractBranchId: person.contractBranchId,
      currentBranchId,
      positionName: positionName!,
      secondaryPositionName,
      isTechnicalDirector: dt!,
      isRotating: rotativo!,
      weeklyHours: weeklyHoursValue,
      hireDate,
      extraTasks: v.tareas_adicionales || null,
      active: true,
    };

    const existing = existingByKey.get(key);
    const changes: string[] = [];
    if (existing) {
      const posName = (id: string | null) => db.positions.find((p) => p.id === id)?.name ?? null;
      const yn = (b: unknown) => (b ? "S" : "N");
      const text = (x: unknown) => (x === null || x === undefined || x === "" ? "(vacío)" : String(x));
      const branch = (id: unknown) => (id ? branchNames[String(id)] ?? String(id) : "(sin sucursal)");
      // Por campo: valor en la base, valor de la planilla, cómo mostrarlo y cómo
      // dejar `data` igual que la base si el cambio de la plataforma no se pisa.
      const cmp: Array<{ label: EmployeeUiField; a: unknown; b: unknown; show: (x: unknown) => string; keep: () => void }> = [
        { label: "nombre", a: `${existing.lastName}, ${existing.firstName}`, b: `${data.lastName}, ${data.firstName}`, show: text,
          keep: () => { data.firstName = existing.firstName; data.lastName = existing.lastName; } },
        { label: "trabaja_en", a: existing.currentBranchId, b: data.currentBranchId, show: branch,
          keep: () => { data.currentBranchId = existing.currentBranchId; } },
        { label: "puesto", a: posName(existing.positionId), b: data.positionName, show: text,
          keep: () => { data.positionName = posName(existing.positionId) ?? data.positionName; } },
        { label: "puesto_secundario", a: posName(existing.secondaryPositionId), b: data.secondaryPositionName, show: text,
          keep: () => { data.secondaryPositionName = posName(existing.secondaryPositionId); } },
        { label: "dt", a: existing.isTechnicalDirector, b: data.isTechnicalDirector, show: yn,
          keep: () => { data.isTechnicalDirector = existing.isTechnicalDirector; } },
        { label: "rotativo", a: existing.isRotating, b: data.isRotating, show: yn,
          keep: () => { data.isRotating = existing.isRotating; } },
        { label: "horas_semanales", a: existing.weeklyHours, b: data.weeklyHours, show: text,
          keep: () => { data.weeklyHours = existing.weeklyHours; } },
        { label: "fecha_ingreso", a: existing.hireDate, b: data.hireDate, show: text,
          keep: () => { data.hireDate = existing.hireDate; } },
        { label: "tareas_adicionales", a: existing.extraTasks, b: data.extraTasks, show: text,
          keep: () => { data.extraTasks = existing.extraTasks; } },
        { label: "activo", a: existing.active, b: true, show: (x) => (x ? "activo/a" : "dado/a de baja"),
          keep: () => { data.active = existing.active; } },
      ];
      for (const c of cmp) {
        if (c.a === c.b) continue;
        const edit = uiEditOf(existing.id, c.label);
        if (edit) {
          conflicts.push({
            personKey: key, name: `${existing.lastName}, ${existing.firstName}`, file: F, line: row.line,
            field: c.label, platform: c.show(c.a), csv: c.show(c.b), editedAt: edit.at,
            overwritten: overwriteUiEdits, employeeId: existing.id,
          });
          if (!overwriteUiEdits) { c.keep(); continue; }
        }
        changes.push(c.label);
      }
    }
    employees.push({
      personKey: key,
      line: row.line,
      action: !existing ? "create" : changes.length ? "update" : "unchanged",
      existingId: existing?.id ?? null,
      changes,
      data,
    });

    if (situation === "vacaciones") {
      vacationSituations.push({ personKey: key, name: `${data.lastName}, ${data.firstName}`, startDate: sitStart!, endDate: sitEnd!, line: row.line });
    } else if (LEAVE_SITUATIONS[situation]) {
      const absenceType = LEAVE_SITUATIONS[situation];
      const exists = existing && db.leaves.some((l) =>
        l.employeeId === existing.id && l.absenceType === absenceType && l.startDate === sitStart && l.endDate === sitEnd);
      // La licencia de ese período se cargó o se tocó en la plataforma: la de la
      // planilla (otras fechas u otro tipo) no se suma encima.
      const touched = !exists && existing
        ? uiEdits.filter((e) => e.employeeId === existing.id && e.field === "situacion" && e.range
            && e.range.startDate <= sitEnd! && e.range.endDate >= sitStart!)
            .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
        : null;
      if (touched) {
        conflicts.push({
          personKey: key, name: `${data.lastName}, ${data.firstName}`, file: F, line: row.line, field: "situacion",
          platform: `licencia ${touched.range!.startDate} → ${touched.range!.endDate}`,
          csv: `${v.situacion} ${sitStart} → ${sitEnd}`, editedAt: touched.at,
          overwritten: overwriteUiEdits, employeeId: existing!.id, range: touched.range,
        });
      }
      leaves.push({
        personKey: key, absenceType, startDate: sitStart!, endDate: sitEnd!,
        action: exists ? "unchanged" : touched && !overwriteUiEdits ? "conflict" : "create",
      });
    }
  }

  const plannedByKey = new Map(employees.map((e) => [e.personKey, e]));
  /** Persona de horarios/saldos: tiene que estar en empleados.csv o ya en la base. */
  const known = (file: FileName, row: CsvRow) => {
    const p = personOf(file, row);
    if (!p) return null;
    const key = personKeyOf(p.nameKey, p.contractBranchId);
    if (!plannedByKey.has(key) && !existingByKey.has(key)) {
      err(file, row.line, `${row.values.apellido_nombre} (${row.values.contrato}) no está en empleados.csv ni en la base.`);
      return null;
    }
    return key;
  };

  // --- horarios.csv ---
  const groups = new Map<string, { key: string; validFrom: string; ref: string | null; refLine: number; slots: ScheduleSlot[]; csvSlots: ScheduleSlot[]; lines: number[]; bad: boolean }>();
  for (const row of parsed["horarios.csv"]) {
    const F: FileName = "horarios.csv";
    const v = row.values;
    const key = known(F, row);
    if (!key) continue;
    const validFrom = parseFlexibleDate(v.vigente_desde ?? "");
    if (!validFrom) { err(F, row.line, `vigente_desde inválida: "${v.vigente_desde}".`); continue; }
    const gk = `${key}#${validFrom}`;
    const g = groups.get(gk) ?? { key, validFrom, ref: null, refLine: row.line, slots: [], csvSlots: [], lines: [], bad: false };
    groups.set(gk, g);
    g.lines.push(row.line);

    const week = (v.semana || "TODAS").toUpperCase();
    const weekValue: ScheduleWeekValue | null = week === "TODAS" ? "ALL" : week === "A" ? "A" : week === "B" ? "B" : null;
    if (!weekValue) { err(F, row.line, `semana tiene que ser TODAS, A o B: "${v.semana}".`); g.bad = true; continue; }
    if (v.referencia_ab) {
      const ref = parseFlexibleDate(v.referencia_ab);
      if (!ref) { err(F, row.line, `referencia_ab inválida: "${v.referencia_ab}".`); g.bad = true; continue; }
      if (g.ref && g.ref !== ref) { err(F, row.line, `referencia_ab distinta de la de la línea ${g.refLine} para el mismo horario.`); g.bad = true; continue; }
      g.ref = ref; g.refLine = row.line;
    }
    const day = Number(v.dia), slot = Number(v.tramo);
    const start = parseHHMM(v.entrada ?? ""), end = parseHHMM(v.salida ?? "");
    if (start === null) { err(F, row.line, `entrada mal escrita: "${v.entrada}" (HH:MM).`); g.bad = true; continue; }
    if (end === null) { err(F, row.line, `salida mal escrita: "${v.salida}" (HH:MM).`); g.bad = true; continue; }

    let branchId: string | null = null;
    let csvBranchId: string | null = null;
    const otherPlace = v.otro_lugar ? v.otro_lugar : null;
    if (v.sucursal) {
      branchId = branchByCode(v.sucursal, true);
      if (!branchId) { err(F, row.line, `Sucursal desconocida: "${v.sucursal}".`); g.bad = true; continue; }
    } else if (!otherPlace) {
      // Sin sucursal ni otro lugar: donde trabaja la persona. Si la sucursal se
      // cambió en la plataforma y no se pisa, es esa (data ya la trae), no la
      // de la planilla: un horario nuevo no manda a la persona a la sucursal
      // anterior. csvSlots guarda la lectura con la sucursal de la planilla,
      // para reconocer el horario que ya se había cargado así.
      branchId = plannedByKey.get(key)?.data.currentBranchId ?? existingByKey.get(key)?.currentBranchId ?? null;
      csvBranchId = csvBranchByKey.get(key) ?? branchId;
      if (!branchId) { err(F, row.line, "Tramo sin sucursal ni otro lugar, y la persona no tiene sucursal donde trabaja."); g.bad = true; continue; }
    }
    g.slots.push({ week: weekValue, dayOfWeek: day, slot, startMinute: start, endMinute: end, branchId, otherPlace });
    g.csvSlots.push({ week: weekValue, dayOfWeek: day, slot, startMinute: start, endMinute: end, branchId: csvBranchId ?? branchId, otherPlace });
  }

  const schedules: PlannedSchedule[] = [];
  for (const g of groups.values()) {
    if (g.bad) continue;
    const problems = validateSchedule({ abReferenceDate: g.ref ? parseISODate(g.ref) : null, slots: g.slots });
    if (problems.length) {
      for (const p of problems) err("horarios.csv", g.lines[0], `${g.key.split("|")[0]} desde ${g.validFrom}: ${p}`);
      continue;
    }
    const hw = weeklyHoursWarning(g.slots);
    if (hw) warn("horarios.csv", g.lines[0], `${g.key.split("|")[0]} desde ${g.validFrom}: ${hw}`);

    const existingId = existingByKey.get(g.key)?.id;
    const current = existingId ? db.schedules.find((s) => s.employeeId === existingId && s.validFrom === g.validFrom) : undefined;
    const same = !!current && current.abReferenceDate === g.ref
      && (sameSlots(current.slots, g.slots) || sameSlots(current.slots, g.csvSlots));
    // Horario editado en la plataforma después de la última carga: el de la
    // planilla (otro contenido u otra vigencia) no lo reemplaza.
    const edited = existingId && !same ? uiEditOf(existingId, "horario") : null;
    if (edited) {
      const person = plannedByKey.get(g.key)?.data ?? existingByKey.get(g.key)!;
      const h = weeklyHours(g.slots);
      conflicts.push({
        personKey: g.key, name: `${person.lastName}, ${person.firstName}`, file: "horarios.csv", line: g.lines[0],
        field: "horario", platform: "horario editado en la plataforma",
        csv: `vigente desde ${g.validFrom}, ${h.alternating && h.A !== h.B ? `A ${h.A} h / B ${h.B} h` : `${h.A} h`} semanales`,
        editedAt: edited.at, overwritten: overwriteUiEdits, employeeId: existingId!,
      });
      if (!overwriteUiEdits) {
        schedules.push({
          personKey: g.key, validFrom: g.validFrom, abReferenceDate: g.ref, slots: g.slots,
          action: "conflict", hours: h,
        });
        continue;
      }
    }
    if (current && !same) {
      err("horarios.csv", g.lines[0], `${g.key.split("|")[0]}: ya hay un horario vigente desde ${g.validFrom} y es distinto. Un cambio va con otra fecha vigente_desde (el anterior no se pisa).`);
      continue;
    }
    schedules.push({
      personKey: g.key, validFrom: g.validFrom, abReferenceDate: g.ref, slots: g.slots,
      action: current ? "unchanged" : "create", hours: weeklyHours(g.slots),
    });
  }

  // --- saldos.csv ---
  const balances: PlannedBalance[] = [];
  const seenYear = new Map<string, number>();
  const withConsumption = new Set(db.employeesWithConsumption);
  for (const row of parsed["saldos.csv"]) {
    const F: FileName = "saldos.csv";
    const key = known(F, row);
    if (!key) continue;
    const year = Number(row.values.anio);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { err(F, row.line, `anio inválido: "${row.values.anio}".`); continue; }
    const t = row.values.dias.trim();
    if (!/^-?\d+$/.test(t)) { err(F, row.line, `dias tiene que ser un número entero: "${row.values.dias}".`); continue; }
    const days = Number(t);
    if (days < 0) warn(F, row.line, `Saldo negativo (${days}) en ${year}.`);
    const yk = `${key}#${year}`;
    if (seenYear.has(yk)) { err(F, row.line, `Año ${year} duplicado para la persona (línea ${seenYear.get(yk)}).`); continue; }
    seenYear.set(yk, row.line);
    const existingId = existingByKey.get(key)?.id;
    const prev = existingId ? db.balances.find((b) => b.employeeId === existingId && b.year === year) : undefined;
    let action: PlannedBalance["action"] = !prev ? "create" : prev.days === days ? "unchanged" : "update";
    const consumed = !!existingId && withConsumption.has(existingId);
    if (action !== "unchanged" && consumed && !forceBalances) {
      action = "blocked";
      warn(F, row.line, `Saldo ${year} NO se recarga (${prev ? `${prev.days} → ${days}` : `nuevo: ${days}`}): la persona ya tiene vacaciones consumidas o devueltas. Para recargarlo igual: --force-saldos.`);
    } else if (prev && prev.days !== days) {
      warn(F, row.line, consumed
        ? `El saldo ${year} cambia de ${prev.days} a ${days} con --force-saldos: pisa el valor de la base, incluidos consumos (queda LOAD_ADJUST).`
        : `El saldo ${year} cambia de ${prev.days} a ${days} (queda LOAD_ADJUST).`);
    }
    balances.push({ personKey: key, year, days, previous: prev?.days ?? null, action });
  }

  return {
    errors, warnings, positionsToCreate, employees, schedules, balances, leaves, vacationSituations, branchNames, forceBalances,
    conflicts, overwriteUiEdits, lastLoadAt: db.lastLoadAt ?? null,
  };
}

// -----------------------------------------------------------------------------
// Informe del dry-run
// -----------------------------------------------------------------------------

export function formatPlanReport(plan: LoadPlan): string {
  const out: string[] = [];
  const name = (id: string | null) => (id ? plan.branchNames[id] ?? id : "(sin sucursal)");
  const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

  out.push("== Empleados por sucursal donde trabaja (crear / actualizar / igual) ==");
  const byBranch = new Map<string, PlannedEmployee[]>();
  for (const e of plan.employees) {
    const k = name(e.data.currentBranchId);
    byBranch.set(k, [...(byBranch.get(k) ?? []), e]);
  }
  for (const [b, es] of [...byBranch.entries()].sort((a, z) => a[0].localeCompare(z[0], "es"))) {
    out.push(`  ${b.padEnd(16)} ${count(es, (e) => e.action === "create")} / ${count(es, (e) => e.action === "update")} / ${count(es, (e) => e.action === "unchanged")}`);
  }
  out.push(`  TOTAL            ${count(plan.employees, (e) => e.action === "create")} / ${count(plan.employees, (e) => e.action === "update")} / ${count(plan.employees, (e) => e.action === "unchanged")}`);
  const diffContract = count(plan.employees, (e) => e.data.currentBranchId !== null && e.data.currentBranchId !== e.data.contractBranchId);
  out.push(`  Con contrato en otra sucursal que donde trabajan: ${diffContract}`);
  for (const e of plan.employees.filter((x) => x.action === "update")) {
    out.push(`  actualiza línea ${e.line}: ${e.changes.join(", ")}`);
  }

  if (plan.positionsToCreate.length) out.push(`\n== Puestos del catálogo a crear ==\n  ${plan.positionsToCreate.join(" · ")}`);

  out.push(`\n== Horarios ==\n  crear: ${count(plan.schedules, (s) => s.action === "create")} · igual: ${count(plan.schedules, (s) => s.action === "unchanged")}`
    + (plan.schedules.some((s) => s.action === "conflict") ? ` · en conflicto (no se crean): ${count(plan.schedules, (s) => s.action === "conflict")}` : ""));

  out.push("\n== Saldos de vacaciones por sucursal de contrato (días) ==");
  const totals = new Map<string, { days: number; people: Set<string> }>();
  for (const b of plan.balances) {
    const k = name(b.personKey.split("|")[1]);
    const t = totals.get(k) ?? { days: 0, people: new Set<string>() };
    t.days += b.days; t.people.add(b.personKey);
    totals.set(k, t);
  }
  for (const [b, t] of [...totals.entries()].sort((a, z) => a[0].localeCompare(z[0], "es"))) {
    out.push(`  ${b.padEnd(16)} ${String(t.days).padStart(6)} días · ${t.people.size} persona(s)`);
  }
  out.push(`  crear: ${count(plan.balances, (b) => b.action === "create")} · actualizar: ${count(plan.balances, (b) => b.action === "update")} · igual: ${count(plan.balances, (b) => b.action === "unchanged")} · frenados: ${count(plan.balances, (b) => b.action === "blocked")}`);
  const blockedPeople = new Set(plan.balances.filter((b) => b.action === "blocked").map((b) => b.personKey));
  if (blockedPeople.size > 0) {
    out.push(`  ${blockedPeople.size} persona(s) con consumos o devoluciones: su saldo no se recarga (ver avisos). Para forzar: --force-saldos.`);
  }
  if (plan.forceBalances) out.push("  --force-saldos: se recargan también los saldos de personas con consumos (queda LOAD_ADJUST).");

  out.push(`\n== Licencias (AbsenceRecord) ==\n  crear: ${count(plan.leaves, (l) => l.action === "create")} · igual: ${count(plan.leaves, (l) => l.action === "unchanged")}`
    + (plan.leaves.some((l) => l.action === "conflict") ? ` · en conflicto (no se crean): ${count(plan.leaves, (l) => l.action === "conflict")}` : ""));

  if (plan.vacationSituations.length) {
    out.push("\n== Situación \"Vacaciones\" (NO se crea solicitud; cargar por el circuito) ==");
    for (const v of plan.vacationSituations) out.push(`  línea ${v.line}: ${v.name} · ${v.startDate} → ${v.endDate}`);
  }

  out.push(...formatConflicts(plan));

  if (plan.warnings.length) {
    out.push(`\n== Avisos (${plan.warnings.length}) ==`);
    for (const w of plan.warnings) out.push(`  ${w.file}:${w.line}  ${w.message}`);
  }
  out.push(`\n== Errores (${plan.errors.length}) ==`);
  for (const e of plan.errors) out.push(`  ${e.file}:${e.line}  ${e.message}`);
  if (plan.errors.length === 0) out.push("  (ninguno)");
  return out.join("\n");
}

/** Sección de conflictos del informe: lo editado en la plataforma que la planilla trae distinto. */
export function formatConflicts(plan: LoadPlan): string[] {
  const out: string[] = [];
  const day = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
  const since = plan.lastLoadAt ? `desde la última carga (${day(plan.lastLoadAt)})` : "(no hay cargas anteriores registradas)";
  out.push(`\n== Conflictos con cambios hechos en la plataforma ${since}: ${plan.conflicts.length} ==`);
  if (plan.conflicts.length === 0) {
    out.push("  (ninguno)");
    return out;
  }
  out.push(plan.overwriteUiEdits
    ? "  --overwrite-ui-edits: SE PISAN con el valor de la planilla."
    : "  NO se pisan: queda el valor de la plataforma. Para pisarlos con la planilla: --overwrite-ui-edits.");
  for (const c of plan.conflicts) {
    out.push(`  conflicto ${c.file}:${c.line}  ${c.name} · ${c.field}: plataforma "${c.platform}" (editado el ${day(c.editedAt)}) · planilla "${c.csv}" → ${c.overwritten ? "se pisa" : "no se pisa"}`);
  }
  if (!plan.overwriteUiEdits) {
    out.push("  Si el valor correcto es el de la plataforma, corregí la planilla para que no vuelva a aparecer.");
  }
  return out;
}
