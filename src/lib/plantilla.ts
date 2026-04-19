/**
 * Farmacias TKL — Plantel real del día
 *
 * getPlantillaReal(branchId, date) devuelve el plantel completo de una sucursal
 * en una fecha dada, combinando:
 *   1. Empleados fijos (currentBranchId = branchId, active = true)
 *   2. Rotativos con asignación ROTATION o TEMPORARY_COVERAGE activa en
 *      esa sucursal y fecha (startDate <= date <= endDate)
 *
 * Regla de solapamiento (endDate inclusivo):
 *   asignación activa si startDate <= date AND (endDate IS NULL OR endDate >= date)
 *
 * Los resultados se enriquecen con:
 *   - isRotating: boolean
 *   - assignmentType: tipo de asignación del rotativo (si aplica)
 *   - statusHoy: ACTIVE | ABSENT | ON_LEAVE (calculado contra AbsenceRecord)
 */

import { prisma } from "@/lib/prisma";

export type PlantillaMember = {
  id:               string;
  firstName:        string;
  lastName:         string;
  isRotating:       boolean;
  active:           boolean;
  hireDate:         Date | null;
  workScheduleNotes:string | null;
  zone:             string | null;
  position: {
    id:              string;
    name:            string;
    requiresCoverage: boolean;
    isRotatingRole:  boolean;
  };
  currentBranchId: string | null;
  // Para rotativos: detalles de la asignación que los trae a esta sucursal hoy
  rotatingAssignment?: {
    id:        string;
    type:      "ROTATION" | "TEMPORARY_COVERAGE";
    startDate: Date;
    endDate:   Date | null;
  };
  // Estado operativo hoy
  statusHoy: "ACTIVE" | "ABSENT" | "ON_LEAVE";
  absenceHoy?: {
    id:          string;
    absenceType: string;
    status:      string;
    branchDetectedFromAssignment: boolean;
  } | null;
};

export type PlantillaResult = {
  fijos:    PlantillaMember[];
  rotativos: PlantillaMember[];
  all:      PlantillaMember[];
  // Resumen para dotación
  summary: {
    totalFijos:          number;
    totalRotativos:      number;
    totalPlantel:        number;
    ausentesHoy:         number;
    licenciasHoy:        number;
    disponiblesHoy:      number;
    puestosCriticos:     PlantillaMember[]; // ausentes con requiresCoverage=true
  };
};

/**
 * Normaliza una fecha a medianoche (00:00:00) para comparaciones de día.
 */
function normalizeToDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getPlantillaReal(
  branchId: string,
  date: Date = new Date()
): Promise<PlantillaResult> {
  const dayStart = normalizeToDay(date);
  const dayEnd   = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  // ── 1. Empleados fijos ────────────────────────────────────────────────────
  const fijosRaw = await prisma.employee.findMany({
    where: {
      currentBranchId: branchId,
      active:          true,
      isRotating:      false,
    },
    include: {
      position: { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
    },
    orderBy: [{ position: { name: "asc" } }, { lastName: "asc" }],
  });

  // ── 2. Rotativos asignados a esta sucursal en esta fecha ──────────────────
  const asignacionesRotativas = await prisma.employeeBranchAssignment.findMany({
    where: {
      branchId,
      type:      { in: ["ROTATION", "TEMPORARY_COVERAGE"] },
      startDate: { lte: dayEnd },
      OR: [
        { endDate: null },
        { endDate: { gte: dayStart } },
      ],
      employee: {
        active:    true,
        isRotating: true,
      },
    },
    include: {
      employee: {
        include: {
          position: { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
        },
      },
    },
    orderBy: { startDate: "asc" },
  });

  // Deduplicar rotativos (puede haber más de una asignación activa, tomar la más reciente)
  const rotativosMap = new Map<string, typeof asignacionesRotativas[0]>();
  for (const a of asignacionesRotativas) {
    const existing = rotativosMap.get(a.employeeId);
    if (!existing || a.startDate > existing.startDate) {
      rotativosMap.set(a.employeeId, a);
    }
  }

  // ── 3. IDs para consultar ausencias ──────────────────────────────────────
  const fijoIds    = fijosRaw.map(e => e.id);
  const rotIds     = Array.from(rotativosMap.keys());
  const allIds     = [...fijoIds, ...rotIds];

  // ── 4. Ausencias activas hoy para todo el plantel ─────────────────────────
  const ausencias = allIds.length > 0
    ? await prisma.absenceRecord.findMany({
        where: {
          employeeId: { in: allIds },
          startDate:  { lte: dayEnd },
          endDate:    { gte: dayStart },
        },
        select: {
          id:         true,
          employeeId: true,
          absenceType:true,
          status:     true,
          branchDetectedFromAssignment: true,
        },
      })
    : [];

  const absenceMap = new Map(ausencias.map(a => [a.employeeId, a]));

  // ── 5. Calcular statusHoy ─────────────────────────────────────────────────
  const LEAVE_TYPES = ["MEDICAL_LEAVE", "SPECIAL_LEAVE"];

  function calcStatus(empId: string): PlantillaMember["statusHoy"] {
    const abs = absenceMap.get(empId);
    if (!abs) return "ACTIVE";
    return LEAVE_TYPES.includes(abs.absenceType) ? "ON_LEAVE" : "ABSENT";
  }

  // ── 6. Construir miembros fijos ───────────────────────────────────────────
  const fijos: PlantillaMember[] = fijosRaw.map(emp => ({
    id:                emp.id,
    firstName:         emp.firstName,
    lastName:          emp.lastName,
    isRotating:        false,
    active:            emp.active,
    hireDate:          emp.hireDate,
    workScheduleNotes: emp.workScheduleNotes,
    zone:              emp.zone,
    position:          emp.position,
    currentBranchId:   emp.currentBranchId,
    statusHoy:         calcStatus(emp.id),
    absenceHoy:        absenceMap.get(emp.id) ?? null,
  }));

  // ── 7. Construir miembros rotativos ───────────────────────────────────────
  const rotativos: PlantillaMember[] = Array.from(rotativosMap.values()).map(a => ({
    id:                a.employee.id,
    firstName:         a.employee.firstName,
    lastName:          a.employee.lastName,
    isRotating:        true,
    active:            a.employee.active,
    hireDate:          a.employee.hireDate,
    workScheduleNotes: a.employee.workScheduleNotes,
    zone:              a.employee.zone,
    position:          a.employee.position,
    currentBranchId:   a.employee.currentBranchId,
    rotatingAssignment: {
      id:        a.id,
      type:      a.type as "ROTATION" | "TEMPORARY_COVERAGE",
      startDate: a.startDate,
      endDate:   a.endDate,
    },
    statusHoy:  calcStatus(a.employee.id),
    absenceHoy: absenceMap.get(a.employee.id) ?? null,
  }));

  const all = [...fijos, ...rotativos];

  // ── 8. Resumen ────────────────────────────────────────────────────────────
  const ausentesHoy    = all.filter(m => m.statusHoy === "ABSENT").length;
  const licenciasHoy   = all.filter(m => m.statusHoy === "ON_LEAVE").length;
  const puestosCriticos = all.filter(
    m => m.statusHoy !== "ACTIVE" && m.position.requiresCoverage
  );

  return {
    fijos,
    rotativos,
    all,
    summary: {
      totalFijos:      fijos.length,
      totalRotativos:  rotativos.length,
      totalPlantel:    all.length,
      ausentesHoy,
      licenciasHoy,
      disponiblesHoy:  all.length - ausentesHoy - licenciasHoy,
      puestosCriticos,
    },
  };
}

/**
 * Versión liviana para calcular dotación en múltiples sucursales a la vez.
 * Usada en la página de lista de sucursales (cards con OK/Justa/Crítica).
 */
export async function getDotacionMultiple(
  branchIds: string[],
  date: Date = new Date()
): Promise<Map<string, {
  totalPlantel:   number;
  disponibles:    number;
  ausentes:       number;
  licencias:      number;
  criticos:       number;
  estado:         "OK" | "JUSTA" | "CRITICA";
}>> {
  const dayStart = normalizeToDay(date);
  const dayEnd   = new Date(dayStart); dayEnd.setHours(23,59,59,999);

  // Fijos por sucursal
  const fijos = await prisma.employee.findMany({
    where: { currentBranchId: { in: branchIds }, active: true, isRotating: false },
    select: {
      id: true, currentBranchId: true,
      position: { select: { requiresCoverage: true } },
    },
  });

  // Rotativos asignados
  const rotAsignaciones = await prisma.employeeBranchAssignment.findMany({
    where: {
      branchId:  { in: branchIds },
      type:      { in: ["ROTATION","TEMPORARY_COVERAGE"] },
      startDate: { lte: dayEnd },
      OR: [{ endDate: null }, { endDate: { gte: dayStart } }],
      employee: { active: true, isRotating: true },
    },
    select: {
      id: true, branchId: true, employeeId: true,
      employee: { select: { position: { select: { requiresCoverage: true } } } },
    },
  });

  // Deduplicar rotativos por sucursal
  const rotByBranch = new Map<string, Set<string>>();
  for (const a of rotAsignaciones) {
    if (!rotByBranch.has(a.branchId)) rotByBranch.set(a.branchId, new Set());
    rotByBranch.get(a.branchId)!.add(a.employeeId);
  }

  // Todos los IDs del plantel por sucursal
  const plantelByBranch = new Map<string, { empId: string; requiresCoverage: boolean }[]>();
  for (const b of branchIds) plantelByBranch.set(b, []);
  for (const e of fijos) {
    if (e.currentBranchId) {
      plantelByBranch.get(e.currentBranchId)!.push({
        empId: e.id, requiresCoverage: e.position.requiresCoverage,
      });
    }
  }
  for (const a of rotAsignaciones) {
    // Solo si no está ya (dedup)
    const list = plantelByBranch.get(a.branchId)!;
    if (!list.find(x => x.empId === a.employeeId)) {
      list.push({ empId: a.employeeId, requiresCoverage: a.employee.position.requiresCoverage });
    }
  }

  // Ausencias activas hoy para todos los empleados del plantel
  const allEmpIds = [...new Set([
    ...fijos.map(e => e.id),
    ...rotAsignaciones.map(a => a.employeeId),
  ])];

  const ausencias = allEmpIds.length > 0
    ? await prisma.absenceRecord.findMany({
        where: {
          employeeId: { in: allEmpIds },
          startDate:  { lte: dayEnd },
          endDate:    { gte: dayStart },
        },
        select: { employeeId: true, absenceType: true, branchId: true },
      })
    : [];

  // Para rotativos: la ausencia descuenta de la sucursal donde están asignados (branchId en AbsenceRecord)
  const ausenciasByEmpBranch = new Map<string, string>(); // empId -> absenceType
  for (const a of ausencias) {
    ausenciasByEmpBranch.set(a.employeeId, a.absenceType);
  }

  const LEAVE_TYPES = ["MEDICAL_LEAVE","SPECIAL_LEAVE"];
  const result = new Map<string, ReturnType<typeof getDotacionMultiple> extends Promise<Map<string, infer V>> ? V : never>();

  for (const branchId of branchIds) {
    const plantel  = plantelByBranch.get(branchId) ?? [];
    let ausentes   = 0;
    let licencias  = 0;
    let criticos   = 0;

    for (const { empId, requiresCoverage } of plantel) {
      const absType = ausenciasByEmpBranch.get(empId);
      if (!absType) continue;
      if (LEAVE_TYPES.includes(absType)) licencias++;
      else ausentes++;
      if (requiresCoverage) criticos++;
    }

    const total      = plantel.length;
    const disponibles= total - ausentes - licencias;
    const ratio      = total > 0 ? (ausentes + licencias) / total : 0;
    const estado: "OK"|"JUSTA"|"CRITICA" =
      criticos > 0 ? "CRITICA"
      : ratio >= 0.2 || (ausentes + licencias > 0 && total <= 3) ? "CRITICA"
      : ratio > 0 ? "JUSTA"
      : "OK";

    result.set(branchId, { totalPlantel: total, disponibles, ausentes, licencias, criticos, estado });
  }

  return result;
}
