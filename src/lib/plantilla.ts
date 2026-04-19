/**
 * Farmacias TKL — Plantel real del día
 *
 * getPlantillaReal(branchId, date) devuelve el plantel de una sucursal en una fecha.
 *
 * Reglas:
 *   Fijos:     currentBranchId = branchId AND active = true
 *   Rotativos: asignación ROTATION/TEMPORARY_COVERAGE con:
 *              - status = ACTIVE
 *              - startDate <= date <= endDate
 *
 * Los dos cambios respecto a la versión anterior:
 *   1. Filtro explícito status = "ACTIVE" en todas las queries de asignaciones
 *   2. PlantillaMember incluye positionCovered (puesto cubierto por el rotativo)
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
  // Para rotativos: detalles de la asignación activa
  rotatingAssignment?: {
    id:              string;
    type:            "ROTATION" | "TEMPORARY_COVERAGE";
    startDate:       Date;
    endDate:         Date | null;
    status:          string;
    // Puesto que cubre en esta sucursal (puede diferir del puesto base del empleado)
    positionCovered: { id: string; name: string; requiresCoverage: boolean } | null;
  };
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
  summary: {
    totalFijos:      number;
    totalRotativos:  number;
    totalPlantel:    number;
    ausentesHoy:     number;
    licenciasHoy:    number;
    disponiblesHoy:  number;
    puestosCriticos: PlantillaMember[];
  };
};

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
  const dayEnd   = new Date(dayStart); dayEnd.setHours(23, 59, 59, 999);

  // ── 1. Fijos ──────────────────────────────────────────────────────────────
  const fijosRaw = await prisma.employee.findMany({
    where: { currentBranchId: branchId, active: true, isRotating: false },
    include: {
      position: { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
    },
    orderBy: [{ position: { name: "asc" } }, { lastName: "asc" }],
  });

  // ── 2. Rotativos con asignación ACTIVE en esta sucursal y fecha ───────────
  const asignaciones = await prisma.employeeBranchAssignment.findMany({
    where: {
      branchId,
      type:      { in: ["ROTATION", "TEMPORARY_COVERAGE"] },
      status:    "ACTIVE",                          // ← nuevo filtro
      startDate: { lte: dayEnd },
      OR: [
        { endDate: null },
        { endDate: { gte: dayStart } },
      ],
      employee: { active: true, isRotating: true },
    },
    include: {
      employee: {
        include: {
          position: { select: { id: true, name: true, requiresCoverage: true, isRotatingRole: true } },
        },
      },
      // Puesto cubierto en esta asignación (puede ser distinto al puesto base)
      position: { select: { id: true, name: true, requiresCoverage: true } },
    },
    orderBy: { startDate: "asc" },
  });

  // Deduplicar rotativos (tomar asignación más reciente si hay más de una activa)
  const rotativosMap = new Map<string, typeof asignaciones[0]>();
  for (const a of asignaciones) {
    const existing = rotativosMap.get(a.employeeId);
    if (!existing || a.startDate > existing.startDate) {
      rotativosMap.set(a.employeeId, a);
    }
  }

  // ── 3. Ausencias activas hoy ──────────────────────────────────────────────
  const fijoIds = fijosRaw.map(e => e.id);
  const rotIds  = Array.from(rotativosMap.keys());
  const allIds  = [...fijoIds, ...rotIds];

  const ausencias = allIds.length > 0
    ? await prisma.absenceRecord.findMany({
        where: {
          employeeId: { in: allIds },
          startDate:  { lte: dayEnd },
          endDate:    { gte: dayStart },
        },
        select: {
          id: true, employeeId: true, absenceType: true, status: true,
          branchDetectedFromAssignment: true,
        },
      })
    : [];

  const absenceMap = new Map(ausencias.map(a => [a.employeeId, a]));
  const LEAVE_TYPES = ["MEDICAL_LEAVE", "SPECIAL_LEAVE"];

  function calcStatus(empId: string): PlantillaMember["statusHoy"] {
    const abs = absenceMap.get(empId);
    if (!abs) return "ACTIVE";
    return LEAVE_TYPES.includes(abs.absenceType) ? "ON_LEAVE" : "ABSENT";
  }

  // ── 4. Construir fijos ────────────────────────────────────────────────────
  const fijos: PlantillaMember[] = fijosRaw.map(emp => ({
    id: emp.id, firstName: emp.firstName, lastName: emp.lastName,
    isRotating: false, active: emp.active, hireDate: emp.hireDate,
    workScheduleNotes: emp.workScheduleNotes, zone: emp.zone,
    position: emp.position, currentBranchId: emp.currentBranchId,
    statusHoy:  calcStatus(emp.id),
    absenceHoy: absenceMap.get(emp.id) ?? null,
  }));

  // ── 5. Construir rotativos ────────────────────────────────────────────────
  const rotativos: PlantillaMember[] = Array.from(rotativosMap.values()).map(a => ({
    id: a.employee.id, firstName: a.employee.firstName, lastName: a.employee.lastName,
    isRotating: true, active: a.employee.active, hireDate: a.employee.hireDate,
    workScheduleNotes: a.employee.workScheduleNotes, zone: a.employee.zone,
    position: a.employee.position, currentBranchId: a.employee.currentBranchId,
    rotatingAssignment: {
      id:        a.id,
      type:      a.type as "ROTATION" | "TEMPORARY_COVERAGE",
      startDate: a.startDate,
      endDate:   a.endDate,
      status:    a.status,
      positionCovered: a.position ?? null,
    },
    statusHoy:  calcStatus(a.employee.id),
    absenceHoy: absenceMap.get(a.employee.id) ?? null,
  }));

  const all = [...fijos, ...rotativos];

  const ausentesHoy     = all.filter(m => m.statusHoy === "ABSENT").length;
  const licenciasHoy    = all.filter(m => m.statusHoy === "ON_LEAVE").length;
  const puestosCriticos = all.filter(m => {
    if (m.statusHoy === "ACTIVE") return false;
    // Para rotativos: usar el puesto cubierto en la asignación si existe
    const pos = m.rotatingAssignment?.positionCovered ?? m.position;
    return pos.requiresCoverage;
  });

  return {
    fijos, rotativos, all,
    summary: {
      totalFijos:     fijos.length,
      totalRotativos: rotativos.length,
      totalPlantel:   all.length,
      ausentesHoy, licenciasHoy,
      disponiblesHoy: all.length - ausentesHoy - licenciasHoy,
      puestosCriticos,
    },
  };
}

/**
 * Versión liviana para múltiples sucursales (dashboard/lista).
 * Filtra status=ACTIVE en asignaciones de rotativos.
 */
export async function getDotacionMultiple(
  branchIds: string[],
  date: Date = new Date()
): Promise<Map<string, {
  totalPlantel:  number;
  disponibles:   number;
  ausentes:      number;
  licencias:     number;
  criticos:      number;
  estado:        "OK" | "JUSTA" | "CRITICA";
}>> {
  const dayStart = normalizeToDay(date);
  const dayEnd   = new Date(dayStart); dayEnd.setHours(23,59,59,999);

  const fijos = await prisma.employee.findMany({
    where: { currentBranchId: { in: branchIds }, active: true, isRotating: false },
    select: {
      id: true, currentBranchId: true,
      position: { select: { requiresCoverage: true } },
    },
  });

  const rotAsignaciones = await prisma.employeeBranchAssignment.findMany({
    where: {
      branchId:  { in: branchIds },
      type:      { in: ["ROTATION","TEMPORARY_COVERAGE"] },
      status:    "ACTIVE",                          // ← nuevo filtro
      startDate: { lte: dayEnd },
      OR: [{ endDate: null }, { endDate: { gte: dayStart } }],
      employee:  { active: true, isRotating: true },
    },
    select: {
      branchId: true, employeeId: true,
      // Usar puesto cubierto si existe, si no el puesto base
      position: { select: { requiresCoverage: true } },
      employee: { select: { position: { select: { requiresCoverage: true } } } },
    },
  });

  // Plantel por sucursal
  const plantelByBranch = new Map<string, { empId: string; requiresCoverage: boolean }[]>();
  for (const b of branchIds) plantelByBranch.set(b, []);

  for (const e of fijos) {
    if (e.currentBranchId) {
      plantelByBranch.get(e.currentBranchId)!.push({
        empId: e.id, requiresCoverage: e.position.requiresCoverage,
      });
    }
  }

  // Dedup rotativos por sucursal
  const rotSeen = new Set<string>();
  for (const a of rotAsignaciones) {
    const key = `${a.branchId}-${a.employeeId}`;
    if (!rotSeen.has(key)) {
      rotSeen.add(key);
      const requiresCoverage =
        a.position?.requiresCoverage ?? a.employee.position.requiresCoverage;
      plantelByBranch.get(a.branchId)!.push({ empId: a.employeeId, requiresCoverage });
    }
  }

  // Ausencias activas hoy
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
        select: { employeeId: true, absenceType: true },
      })
    : [];

  const ausenciaMap = new Map(ausencias.map(a => [a.employeeId, a.absenceType]));
  const LEAVE_TYPES = ["MEDICAL_LEAVE","SPECIAL_LEAVE"];

  const result = new Map<string, any>();
  for (const branchId of branchIds) {
    const plantel  = plantelByBranch.get(branchId) ?? [];
    let ausentes   = 0, licencias = 0, criticos = 0;

    for (const { empId, requiresCoverage } of plantel) {
      const absType = ausenciaMap.get(empId);
      if (!absType) continue;
      if (LEAVE_TYPES.includes(absType)) licencias++;
      else ausentes++;
      if (requiresCoverage) criticos++;
    }

    const total       = plantel.length;
    const disponibles = total - ausentes - licencias;
    const ratio       = total > 0 ? (ausentes + licencias) / total : 0;
    const estado: "OK"|"JUSTA"|"CRITICA" =
      criticos > 0 ? "CRITICA"
      : ratio >= 0.2 || (ausentes + licencias > 0 && total <= 3) ? "CRITICA"
      : ratio > 0 ? "JUSTA"
      : "OK";

    result.set(branchId, { totalPlantel: total, disponibles, ausentes, licencias, criticos, estado });
  }

  return result;
}
