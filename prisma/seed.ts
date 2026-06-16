/**
 * Farmacias TKL — Seed completo v2
 * Sin imports externos. Todo inline.
 * Incluye: Call Center + Operador Call Center
 */
import { PrismaClient, UserRole, PositionScope, AbsenceType, AbsenceStatus, ConversationStatus, ConversationMessageAuthor } from "@prisma/client";
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
  const prev = await prisma.employeeBranchAssignment.findFirst({
    where: { employeeId, type: "PERMANENT", endDate: null },
  });
  if (prev) {
    const closeDate = new Date(startDate);
    closeDate.setDate(closeDate.getDate() - 1);
    await prisma.employeeBranchAssignment.update({
      where: { id: prev.id },
      data:  { endDate: closeDate },
    });
  }
  await prisma.employeeBranchAssignment.create({
    data: { employeeId, branchId, startDate, endDate: null, type: "PERMANENT", reason: "Alta inicial" },
  });
  await prisma.employee.update({
    where: { id: employeeId },
    data:  { currentBranchId: branchId },
  });
}

const BRANCHES = [
  "Tekiel", "San Miguel", "Galesa", "San Agustin", "Etcheverry",
  "Quintana", "America", "Naveira", "Facultad", "La Perla", "Larcade", "Call Center",
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
  { name: "RRHH TKL",               email: "rrhh@farmaciastkl.com",         role: "HR",             branchName: null },
  { name: "Personal Mantenimiento", email: "mantenimiento@farmaciastkl.com",role: "MAINTENANCE",    branchName: null },
  { name: "Encargada Tekiel",       email: "tekiel@farmaciastkl.com",       role: "BRANCH_MANAGER", branchName: "Tekiel" },
  { name: "Encargada Galesa",       email: "galesa@farmaciastkl.com",       role: "BRANCH_MANAGER", branchName: "Galesa" },
  { name: "Encargado San Miguel",   email: "sanmiguel@farmaciastkl.com",    role: "BRANCH_MANAGER", branchName: "San Miguel" },
];

async function main() {
  console.log("🌱 Seed Farmacias TKL v2\n");

  // Sucursales — code único por branch real; aliases vacíos hasta que el cliente entregue el mapeo
  console.log("📍 Sucursales...");
  const BRANCH_CODES: Record<string, string> = {
    "Tekiel":      "TEK",
    "San Miguel":  "SMI",
    "Galesa":      "GAL",
    "San Agustin": "SAG",
    "Etcheverry":  "ETC",
    "Quintana":    "QUI",
    "America":     "AME",
    "Naveira":     "NAV",
    "Facultad":    "FAC",
    "La Perla":    "LPE",
    "Larcade":     "LAR",
    "Call Center": "CCE",
  };
  const branchMap: Record<string, string> = {};
  for (const name of BRANCHES) {
    const code = BRANCH_CODES[name] ?? name.substring(0, 3).toUpperCase();
    const b = await prisma.branch.upsert({
      where:  { name },
      update: { code, aliases: [] }, // force-refresh aliases/code en branches existentes
      create: { name, active: true, code, aliases: [] },
    });
    branchMap[name] = b.id;
  }
  console.log(`   ✓ ${BRANCHES.length} sucursales (codes actualizados, aliases vacíos pendientes del cliente)`);

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

  // Call Center — fixtures conversacionales (Sprint 1)
  // PII (Ley 25.326): datos 100% FICTICIOS y anonimizados. Teléfonos obviamente
  // falsos (+54 9 11 0000 000X), nombres "Cliente Ficticio N", textos genéricos
  // que representan PATRONES operativos, NO conversaciones reales.
  // Actores (assignedTo/sender/changedBy) = Users con acceso al módulo por rol
  // (SUPERVISOR/ADMIN). Todas las transiciones respetan la whitelist canónica.
  console.log("☎️  Call Center (fixtures)...");
  const existingConvs = await prisma.conversation.count();
  if (existingConvs === 0) {
    const operatorA = reporterId; // SUPERVISOR
    const operatorB = (await prisma.user.findFirst({ where: { role: "ADMIN" } }))?.id ?? "";

    if (!operatorA || !operatorB) {
      console.log(`   ⚠ Faltan usuarios actor (SUPERVISOR/ADMIN), omito fixtures Call Center`);
    } else {
      const now = new Date();
      const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

      const CUSTOMERS = [
        { phone: "+5491100000001", displayName: "Cliente Ficticio 1" },
        { phone: "+5491100000002", displayName: "Cliente Ficticio 2" },
        { phone: "+5491100000003", displayName: null },               // wa_id sin perfil
        { phone: "+5491100000004", displayName: "Cliente Ficticio 4" },
        { phone: "+5491100000005", displayName: "Cliente Ficticio 5" },
      ];
      const custMap: Record<string, string> = {};
      for (const c of CUSTOMERS) {
        const cust = await prisma.customer.upsert({
          where: { phone: c.phone },
          update: { displayName: c.displayName },
          create: { phone: c.phone, displayName: c.displayName },
        });
        custMap[c.phone] = cust.id;
      }

      type MsgSeed = { author: ConversationMessageAuthor; senderUserId?: string; body: string; sentAt: Date };
      type HistSeed = {
        fromStatus: ConversationStatus | null; toStatus: ConversationStatus;
        fromAssignedToUserId?: string | null; toAssignedToUserId?: string | null;
        changedByUserId?: string | null; changedAt: Date; note?: string;
      };
      async function createConversation(conv: {
        phone: string; status: ConversationStatus; assignedToUserId?: string | null;
        source: string; externalConversationId?: string | null;
        firstResponseAt?: Date | null; closedAt?: Date | null; createdAt: Date;
        messages: MsgSeed[]; history: HistSeed[];
      }) {
        const created = await prisma.conversation.create({
          data: {
            customerId: custMap[conv.phone],
            status: conv.status,
            assignedToUserId: conv.assignedToUserId ?? null,
            customerPhoneSnapshot: conv.phone,            // congelado al crear (DM-7)
            source: conv.source,
            externalConversationId: conv.externalConversationId ?? null,
            firstResponseAt: conv.firstResponseAt ?? null,
            closedAt: conv.closedAt ?? null,
            createdAt: conv.createdAt,
          },
        });
        for (const m of conv.messages) {
          await prisma.conversationMessage.create({
            data: {
              conversationId: created.id, author: m.author,
              senderUserId: m.senderUserId ?? null, body: m.body, sentAt: m.sentAt,
            },
          });
        }
        for (const h of conv.history) {
          await prisma.conversationStateHistory.create({
            data: {
              conversationId: created.id,
              fromStatus: h.fromStatus, toStatus: h.toStatus,
              fromAssignedToUserId: h.fromAssignedToUserId ?? null,
              toAssignedToUserId: h.toAssignedToUserId ?? null,
              changedByUserId: h.changedByUserId ?? null,
              changedAt: h.changedAt, note: h.note,
            },
          });
        }
      }

      // A — PENDIENTE: recién ingresó, aún sin operador
      await createConversation({
        phone: "+5491100000001", status: ConversationStatus.PENDIENTE,
        source: "EMOZION", externalConversationId: "EMZ-DEMO-0001", createdAt: minsAgo(3),
        messages: [
          { author: ConversationMessageAuthor.CUSTOMER, body: "Hola, ¿tienen disponibilidad de un producto de venta libre?", sentAt: minsAgo(3) },
          { author: ConversationMessageAuthor.BOT, body: "¡Hola! Soy el asistente de Farmacias TKL. Un operador te responderá a la brevedad.", sentAt: minsAgo(2) },
        ],
        history: [
          { fromStatus: null, toStatus: ConversationStatus.PENDIENTE, changedByUserId: null, changedAt: minsAgo(3) },
        ],
      });

      // B — SIN_ASIGNAR: nadie la tomó, timeout automático (sin actor humano)
      await createConversation({
        phone: "+5491100000002", status: ConversationStatus.SIN_ASIGNAR,
        source: "WHATSAPP_CLOUD", externalConversationId: "WA-DEMO-0002", createdAt: minsAgo(25),
        messages: [
          { author: ConversationMessageAuthor.CUSTOMER, body: "Buenas, consulta por el horario de atención de la sucursal.", sentAt: minsAgo(25) },
          { author: ConversationMessageAuthor.BOT, body: "¡Hola! En breve un operador te asiste.", sentAt: minsAgo(24) },
        ],
        history: [
          { fromStatus: null, toStatus: ConversationStatus.PENDIENTE, changedByUserId: null, changedAt: minsAgo(25) },
          { fromStatus: ConversationStatus.PENDIENTE, toStatus: ConversationStatus.SIN_ASIGNAR, changedByUserId: null, changedAt: minsAgo(14), note: "Timeout automático (10')" },
        ],
      });

      // C — ASIGNADA: tomada por un operador
      await createConversation({
        phone: "+5491100000003", status: ConversationStatus.ASIGNADA, assignedToUserId: operatorA,
        source: "EMOZION", externalConversationId: "EMZ-DEMO-0003",
        firstResponseAt: minsAgo(40), createdAt: minsAgo(50),
        messages: [
          { author: ConversationMessageAuthor.CUSTOMER, body: "Hola, necesito información sobre un trámite.", sentAt: minsAgo(50) },
          { author: ConversationMessageAuthor.BOT, body: "¡Hola! Un operador continúa la conversación.", sentAt: minsAgo(49) },
          { author: ConversationMessageAuthor.OPERATOR, senderUserId: operatorA, body: "Hola, soy del equipo de atención. ¿En qué puedo ayudarte?", sentAt: minsAgo(40) },
        ],
        history: [
          { fromStatus: null, toStatus: ConversationStatus.SIN_ASIGNAR, changedByUserId: null, changedAt: minsAgo(50) },
          { fromStatus: ConversationStatus.SIN_ASIGNAR, toStatus: ConversationStatus.ASIGNADA, toAssignedToUserId: operatorA, changedByUserId: operatorA, changedAt: minsAgo(41) },
        ],
      });

      // D — ASIGNADA con reasignación (handoff ASIGNADA→ASIGNADA, cambia dueño)
      await createConversation({
        phone: "+5491100000004", status: ConversationStatus.ASIGNADA, assignedToUserId: operatorB,
        source: "MANUAL", externalConversationId: null,
        firstResponseAt: minsAgo(120), createdAt: minsAgo(130),
        messages: [
          { author: ConversationMessageAuthor.CUSTOMER, body: "Consulta sobre una factura.", sentAt: minsAgo(130) },
          { author: ConversationMessageAuthor.OPERATOR, senderUserId: operatorA, body: "Hola, te ayudo con eso.", sentAt: minsAgo(120) },
          { author: ConversationMessageAuthor.OPERATOR, senderUserId: operatorB, body: "Hola, continúo yo con tu consulta.", sentAt: minsAgo(60) },
        ],
        history: [
          { fromStatus: null, toStatus: ConversationStatus.SIN_ASIGNAR, changedByUserId: null, changedAt: minsAgo(130) },
          { fromStatus: ConversationStatus.SIN_ASIGNAR, toStatus: ConversationStatus.ASIGNADA, toAssignedToUserId: operatorA, changedByUserId: operatorA, changedAt: minsAgo(121) },
          { fromStatus: ConversationStatus.ASIGNADA, toStatus: ConversationStatus.ASIGNADA, fromAssignedToUserId: operatorA, toAssignedToUserId: operatorB, changedByUserId: operatorB, changedAt: minsAgo(60), note: "Reasignación" },
        ],
      });

      // E — RESUELTA: cerrada pero NO terminal (puede reabrir)
      await createConversation({
        phone: "+5491100000005", status: ConversationStatus.RESUELTA, assignedToUserId: operatorA,
        source: "EMOZION", externalConversationId: "EMZ-DEMO-0005",
        firstResponseAt: minsAgo(90), closedAt: minsAgo(15), createdAt: minsAgo(100),
        messages: [
          { author: ConversationMessageAuthor.CUSTOMER, body: "Hola, una consulta rápida por favor.", sentAt: minsAgo(100) },
          { author: ConversationMessageAuthor.BOT, body: "¡Hola! Un operador te asiste enseguida.", sentAt: minsAgo(99) },
          { author: ConversationMessageAuthor.OPERATOR, senderUserId: operatorA, body: "Hola, ¿en qué te puedo ayudar?", sentAt: minsAgo(90) },
          { author: ConversationMessageAuthor.CUSTOMER, body: "Perfecto, muchas gracias.", sentAt: minsAgo(20) },
          { author: ConversationMessageAuthor.OPERATOR, senderUserId: operatorA, body: "¡Gracias a vos! Cerramos la consulta.", sentAt: minsAgo(15) },
        ],
        history: [
          { fromStatus: null, toStatus: ConversationStatus.SIN_ASIGNAR, changedByUserId: null, changedAt: minsAgo(100) },
          { fromStatus: ConversationStatus.SIN_ASIGNAR, toStatus: ConversationStatus.ASIGNADA, toAssignedToUserId: operatorA, changedByUserId: operatorA, changedAt: minsAgo(91) },
          { fromStatus: ConversationStatus.ASIGNADA, toStatus: ConversationStatus.RESUELTA, fromAssignedToUserId: operatorA, toAssignedToUserId: operatorA, changedByUserId: operatorA, changedAt: minsAgo(15), note: "Consulta resuelta" },
        ],
      });

      console.log(`   ✓ ${CUSTOMERS.length} clientes ficticios · 5 conversaciones (1 por estado + reasignación)`);
    }
  } else {
    console.log(`   ℹ Ya existen conversaciones, omitiendo`);
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
