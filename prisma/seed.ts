/**
 * Farmacias TKL — Seed completo v2
 * Sin imports externos. Todo inline.
 * Incluye: Call Center + Operador Call Center
 */
import { PrismaClient, UserRole, PositionScope, AbsenceType, AbsenceStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();
const isDev  = process.env.NODE_ENV !== "production";

function getPassword() {
  if (isDev) return "TKL.Dev.2025!";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  return Array.from(crypto.randomBytes(16)).map(b => chars[b % chars.length]).join("");
}

async function assignPermanent(employeeId: string, branchId: string, startDate: Date) {
  return prisma.$transaction(async (tx) => {
    const prev = await tx.employeeBranchAssignment.findFirst({
      where: { employeeId, type: "PERMANENT", endDate: null },
    });
    if (prev) {
      const closeDate = new Date(startDate);
      closeDate.setDate(closeDate.getDate() - 1);
      await tx.employeeBranchAssignment.update({
        where: { id: prev.id },
        data:  { endDate: closeDate },
      });
    }
    await tx.employeeBranchAssignment.create({
      data: { employeeId, branchId, startDate, endDate: null, type: "PERMANENT", reason: "Alta inicial" },
    });
    await tx.employee.update({
      where: { id: employeeId },
      data:  { currentBranchId: branchId },
    });
  });
}

const BRANCHES = [
  "Tekiel", "San Miguel", "Galesa", "San Agustin", "Etcheverry",
  "Quintana", "America", "Naveira", "Facultad", "La Perla", "Larcade",
  "Call Center",  // nueva
];

const POSITIONS: Array<{
  name: string; requiresCoverage: boolean; isRotatingRole: boolean;
  scope: PositionScope; notes?: string; specificBranches?: string[];
}> = [
  { name: "Encargado",            requiresCoverage: false, isRotatingRole: false, scope: "ALL" },
  { name: "Cajera",               requiresCoverage: true,  isRotatingRole: false, scope: "ALL",      notes: "Puesto critico." },
  { name: "Cadete",               requiresCoverage: true,  isRotatingRole: false, scope: "ALL",      notes: "Puesto critico." },
  { name: "Mostrador",            requiresCoverage: false, isRotatingRole: false, scope: "ALL" },
  { name: "Perfumeria",           requiresCoverage: false, isRotatingRole: false, scope: "ALL" },
  { name: "Rotativa",             requiresCoverage: false, isRotatingRole: true,  scope: "ALL",      notes: "No requiere cobertura." },
  { name: "Personal laboratorio", requiresCoverage: false, isRotatingRole: false, scope: "SPECIFIC", specificBranches: ["San Miguel","Tekiel","La Perla"] },
  { name: "Auditoria",            requiresCoverage: false, isRotatingRole: false, scope: "SPECIFIC", specificBranches: ["San Miguel","Tekiel","La Perla"] },
  { name: "Maestranza",           requiresCoverage: false, isRotatingRole: false, scope: "ALL",      notes: "No critico por ahora." },
  { name: "Operador Call Center", requiresCoverage: false, isRotatingRole: false, scope: "SPECIFIC",
    specificBranches: ["Call Center"],
    notes: "Especifico de sucursal Call Center." },
];

const USERS: Array<{ name: string; email: string; role: UserRole; branchName: string | null }> = [
  { name: "Administrador Sistema",  email: "admin@farmaciastkl.com",        role: "ADMIN",          branchName: null },
  { name: "Direccion TKL",          email: "dueno@farmaciastkl.com",        role: "OWNER",          branchName: null },
  { name: "Supervisora TKL",        email: "supervisor@farmaciastkl.com",   role: "SUPERVISOR",     branchName: null },
  { name: "Co-supervisora TKL",     email: "cosupervisor@farmaciastkl.com", role: "CO_SUPERVISOR",  branchName: null },
  { name: "RRHH TKL",               email: "rrhh@farmaciastkl.com",         role: "HR",             branchName: null },
  { name: "Personal Mantenimiento", email: "mantenimiento@farmaciastkl.com",role: "MAINTENANCE",    branchName: null },
  { name: "Encargada Tekiel",       email: "tekiel@farmaciastkl.com",       role: "BRANCH_MANAGER", branchName: "Tekiel" },
  { name: "Encargada Galesa",       email: "galesa@farmaciastkl.com",       role: "BRANCH_MANAGER", branchName: "Galesa" },
  { name: "Encargado San Miguel",   email: "sanmiguel@farmaciastkl.com",    role: "BRANCH_MANAGER", branchName: "San Miguel" },
];

async function main() {
  console.log("🌱 Seed Farmacias TKL v2\n");

  // Sucursales
  console.log("📍 Sucursales...");
  const branchMap: Record<string, string> = {};
  for (const name of BRANCHES) {
    const b = await prisma.branch.upsert({
      where: { name }, update: {},
      create: { name, active: true },
    });
    branchMap[name] = b.id;
  }
  console.log(`   ✓ ${BRANCHES.length} sucursales`);

  // Puestos
  console.log("💼 Puestos...");
  const posMap: Record<string, string> = {};
  for (const p of POSITIONS) {
    const pos = await prisma.position.upsert({
      where: { name: p.name },
      update: { requiresCoverage: p.requiresCoverage, isRotatingRole: p.isRotatingRole, scope: p.scope, notes: p.notes ?? null },
      create: { name: p.name, requiresCoverage: p.requiresCoverage, isRotatingRole: p.isRotatingRole, scope: p.scope, notes: p.notes ?? null, active: true },
    });
    posMap[p.name] = pos.id;
    if (p.specificBranches) {
      for (const bn of p.specificBranches) {
        const bid = branchMap[bn];
        if (!bid) continue;
        await prisma.positionBranchScope.upsert({
          where: { positionId_branchId: { positionId: pos.id, branchId: bid } },
          update: {}, create: { positionId: pos.id, branchId: bid },
        });
      }
    }
  }
  console.log(`   ✓ ${POSITIONS.length} puestos`);

  // Usuarios
  console.log("👤 Usuarios...");
  const passwords: { email: string; password: string }[] = [];
  for (const u of USERS) {
    const password = getPassword();
    const hash     = await bcrypt.hash(password, 12);
    const branchId = u.branchName ? (branchMap[u.branchName] ?? null) : null;
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, branchId },
      create: { name: u.name, email: u.email, passwordHash: hash, role: u.role, branchId, mustChangePassword: true, active: true },
    });
    if (isDev) passwords.push({ email: u.email, password });
  }
  const reporterId = (await prisma.user.findFirst({ where: { role: "SUPERVISOR" } }))?.id ?? "";
  console.log(`   ✓ ${USERS.length} usuarios`);

  // Empleados
  console.log("👥 Empleados...");
  let created = 0;

  async function createEmp(params: {
    firstName: string; lastName: string; positionName: string;
    branchName: string | null; hireDate?: Date; workScheduleNotes?: string;
    isRotating?: boolean; zone?: string; maxConcurrentAssignments?: number;
  }) {
    const branchId   = params.branchName ? branchMap[params.branchName] : null;
    const positionId = posMap[params.positionName];
    if (!positionId) { console.warn(`   ⚠ Puesto no encontrado: ${params.positionName}`); return null; }

    const existing = await prisma.employee.findFirst({
      where: { firstName: params.firstName, lastName: params.lastName, positionId },
    });
    if (existing) {
      await prisma.employee.update({
        where: { id: existing.id },
        data: { isRotating: params.isRotating ?? false, zone: params.zone ?? null,
          maxConcurrentAssignments: params.maxConcurrentAssignments ?? 1 },
      });
      return existing;
    }

    const emp = await prisma.employee.create({
      data: {
        firstName: params.firstName, lastName: params.lastName, positionId,
        currentBranchId: null, active: true, hireDate: params.hireDate,
        workScheduleNotes: params.workScheduleNotes,
        isRotating: params.isRotating ?? false, zone: params.zone ?? null,
        maxConcurrentAssignments: params.maxConcurrentAssignments ?? 1,
      },
    });
    if (branchId) {
      await assignPermanent(emp.id, branchId, params.hireDate ?? new Date("2020-01-01"));
    }
    created++;
    return emp;
  }

  // Farmacias (11 sucursales originales)
  const farmBranches = BRANCHES.filter(b => b !== "Call Center");
  for (const b of farmBranches) {
    await createEmp({ firstName: "Encargada",  lastName: b, positionName: "Encargado",  branchName: b, hireDate: new Date("2020-01-01"), workScheduleNotes: "Lunes a sabado" });
    await createEmp({ firstName: "Cajera 1",   lastName: b, positionName: "Cajera",     branchName: b, hireDate: new Date("2021-03-01"), workScheduleNotes: "Turno manana" });
    await createEmp({ firstName: "Cajera 2",   lastName: b, positionName: "Cajera",     branchName: b, hireDate: new Date("2021-03-01"), workScheduleNotes: "Turno tarde" });
    await createEmp({ firstName: "Cadete",     lastName: b, positionName: "Cadete",     branchName: b, hireDate: new Date("2022-06-01") });
    await createEmp({ firstName: "Mostrador",  lastName: b, positionName: "Mostrador",  branchName: b, hireDate: new Date("2021-09-01") });
  }

  // Rotativos
  const zones = ["CABA Norte","CABA Sur","CABA","CABA Norte","CABA"];
  for (let i = 0; i < 5; i++) {
    await createEmp({
      firstName: `Rotativa ${String.fromCharCode(65+i)}`, lastName: zones[i],
      positionName: "Rotativa", branchName: null,
      hireDate: new Date("2020-06-01"), workScheduleNotes: "Cobertura CABA",
      isRotating: true, zone: zones[i], maxConcurrentAssignments: 2,
    });
  }

  // Laboratorio, auditoría, maestranza
  for (const b of ["San Miguel","Tekiel","La Perla"]) {
    await createEmp({ firstName: "Lab",       lastName: b, positionName: "Personal laboratorio", branchName: b, hireDate: new Date("2019-01-01") });
    await createEmp({ firstName: "Auditoria", lastName: b, positionName: "Auditoria",            branchName: b, hireDate: new Date("2020-03-01") });
  }
  for (const b of ["Tekiel","San Miguel","Galesa","La Perla"]) {
    await createEmp({ firstName: "Maestranza", lastName: b, positionName: "Maestranza", branchName: b, hireDate: new Date("2021-01-01") });
  }

  // Call Center
  for (let i = 1; i <= 4; i++) {
    await createEmp({ firstName: `Operador ${i}`, lastName: "Call Center",
      positionName: "Operador Call Center", branchName: "Call Center", hireDate: new Date("2023-01-01") });
  }

  console.log(`   ✓ ${created} nuevos empleados`);

  // Ausencias de ejemplo
  console.log("📋 Ausencias...");
  const existingAbs = await prisma.absenceRecord.count();
  if (existingAbs === 0 && reporterId) {
    const hoy    = new Date(); hoy.setHours(0,0,0,0);
    const ayer   = new Date(hoy); ayer.setDate(ayer.getDate()-1);
    const manana = new Date(hoy); manana.setDate(manana.getDate()+1);
    const hace3  = new Date(hoy); hace3.setDate(hace3.getDate()-3);
    const en7    = new Date(hoy); en7.setDate(en7.getDate()+6);

    const tid = branchMap["Tekiel"];
    const sid = branchMap["San Miguel"];

    const c1 = await prisma.employee.findFirst({ where: { firstName: "Cajera 1",  currentBranchId: tid } });
    const c2 = await prisma.employee.findFirst({ where: { firstName: "Cajera 2",  currentBranchId: tid } });
    const cd = await prisma.employee.findFirst({ where: { firstName: "Cadete",    currentBranchId: tid } });
    const ms = await prisma.employee.findFirst({ where: { firstName: "Mostrador", currentBranchId: sid } });

    const records: any[] = [];
    if (c1) records.push({ employeeId: c1.id, branchId: tid, startDate: hoy,   endDate: hoy,    absenceType: "SICKNESS"      as AbsenceType, status: "REPORTED"   as AbsenceStatus, notes: "Llamo a las 8am." });
    if (cd) records.push({ employeeId: cd.id, branchId: tid, startDate: ayer,  endDate: manana, absenceType: "MEDICAL_LEAVE" as AbsenceType, status: "JUSTIFIED"  as AbsenceStatus, hasCertificate: true });
    if (ms) records.push({ employeeId: ms.id, branchId: sid, startDate: hace3, endDate: hace3,  absenceType: "NO_SHOW"       as AbsenceType, status: "UNJUSTIFIED" as AbsenceStatus, notes: "No aviso." });
    if (c2) records.push({ employeeId: c2.id, branchId: tid, startDate: manana,endDate: en7,    absenceType: "SPECIAL_LEAVE" as AbsenceType, status: "REPORTED"   as AbsenceStatus });

    for (const r of records) {
      await prisma.absenceRecord.create({ data: { ...r, reportedByUserId: reporterId } });
    }
    console.log(`   ✓ ${records.length} ausencias de ejemplo`);
  } else {
    console.log(`   ℹ Ya existen ausencias, omitiendo`);
  }

  // Resumen + verificacion
  const [te, ta, tabs] = await Promise.all([
    prisma.employee.count(),
    prisma.employeeBranchAssignment.count(),
    prisma.absenceRecord.count(),
  ]);
  const withBranch    = await prisma.employee.count({ where: { currentBranchId: { not: null } } });
  const activeAssigns = await prisma.employeeBranchAssignment.count({ where: { endDate: null } });
  const sinBranchFijo = await prisma.employee.count({ where: { currentBranchId: null, isRotating: false } });
  const sinAsignacion = await prisma.employee.count({
    where: {
      isRotating: false,
      branchAssignments: { none: { endDate: null } },
    },
  });

  console.log(`\n✅ ${BRANCHES.length} sucursales · ${POSITIONS.length} puestos · ${USERS.length} usuarios`);
  console.log(`   ${te} empleados · ${ta} asignaciones · ${tabs} ausencias`);
  console.log(`\n📊 Verificacion:`);
  console.log(`   ${withBranch} empleados con currentBranchId`);
  console.log(`   ${activeAssigns} asignaciones activas (endDate=null)`);
  console.log(`   ${sinBranchFijo} empleados fijos sin currentBranchId ${sinBranchFijo > 0 ? "⚠ ERROR" : "✓"}`);
  console.log(`   ${sinAsignacion} empleados fijos sin asignacion activa ${sinAsignacion > 0 ? "⚠ ERROR" : "✓"}`);

  if (isDev) {
    console.log("\n🔑 Accesos de desarrollo:");
    for (const p of passwords) {
      console.log(`   ${p.email.padEnd(40)} ${p.password}`);
    }
  }
}

main()
  .catch(e => { console.error("❌", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
