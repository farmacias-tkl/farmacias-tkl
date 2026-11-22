/**
 * Permisos por rol: matriz completa rol × acción y rol × ruta, y la regla de
 * Dirección.
 *
 * REGLA: Dirección (OWNER) tiene el máximo nivel. Toda acción, ruta o ítem de
 * menú que tenga Administrador (ADMIN) o Supervisión (SUPERVISOR) lo tiene
 * OWNER. Este test recorre TODO lo que exporta permissions.ts y falla si un
 * permiso nuevo se olvida de Dirección, o si se agrega uno sin sumarlo a la
 * matriz de abajo.
 *
 *   npx tsx src/lib/permissions-owner.test.ts
 */
import {
  can, canAccessOwnerPanel, canAccessRoute, canViewCallCenter, canViewExecutive,
  canViewCallCenterMetrics, canViewCallCenterSales, canConfigureCallCenterMetrics,
  callCenterMetricsConfigAccess,
  canSeePlatformLinkFromCallCenter, PLATFORM_HOME_ROUTE,
  CALL_CENTER_ROLE_ACCESS, MENU_BY_ROLE, ROUTE_PERMISSIONS, visibleMenu,
} from "./permissions";
import type { UserRole } from "@prisma/client";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

const ROLES: UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR", "HR", "BRANCH_MANAGER", "MAINTENANCE"];
// O = Dirección, A = Administrador, S = Supervisión, H = RRHH, B = Encargado/a, M = Mantenimiento
const CODE: Record<string, UserRole> = { O: "OWNER", A: "ADMIN", S: "SUPERVISOR", H: "HR", B: "BRANCH_MANAGER", M: "MAINTENANCE" };
const roles = (codes: string): UserRole[] => codes.split("").map((c) => CODE[c]);
const ALL = "OASHBM";

// ── Rol × acción ────────────────────────────────────────────────────────────
const ACTIONS: Record<string, string> = {
  viewAllBranches: "OASH",
  manageBranches: "OA",
  viewAllEmployees: "OASH",
  manageEmployees: "OASHB",
  reassignEmployee: "OASH",
  viewVacationDetail: "OASHB",
  createVacation: "OASB",
  approveVacation: "OAS",
  confirmVacation: "OAS",
  changeVacationCoverage: "OAS",
  cancelVacation: "OASB",
  cancelApprovedVacation: "OAS",
  manageCoverage: "OASH",
  createAbsence: "OASHB",
  editAbsence: "OASHB",
  justifyAbsence: "OASH",
  viewAttendance: "OASHB",
  createTimeEvent: "OASB",
  authorizeTimeEvent: "OAS",
  resolveTimeEvent: "OAS",
  addCompensation: "OAS",
  editTimeEvent: "OAS", // registro cargado por otra persona; el propio se prueba aparte
  createActionPlan: "OASB",
  createOvertime: "OASB",
  approveOvertime: "OAS",
  viewHourBank: "OASHB",
  requestHourBank: "OASB",
  authorizeHourBank: "OAS",
  adjustHourBank: "OAS",
  viewAllTickets: "OASM",
  createTicket: "OASBM",
  assignTicket: "OAS",
  updateTicketStatus: "OASM",
  createTask: "OAS",
  updateTaskStatus: "OASB",
  accessWhatsApp: "OAS",
  viewInternalComments: ALL,
  manageUsers: "OA",
  managePositions: "OA",
  managePositionPermissions: "OA",
  viewAuditLog: "OA",
  isFullAccess: "OAS",
};

// ── Rol × ruta ──────────────────────────────────────────────────────────────
const ROUTES: Record<string, string> = {
  "/": ALL,
  "/dashboard": ALL,
  "/sucursales": "OAS",
  "/empleados": "OASHB",
  "/ausencias": "OASHB",
  "/planes-accion": "OASHB",
  "/horas-extras": "OASHB",
  "/banco-horas": "OASHB",
  "/vacaciones": "OASHB",
  "/rotativas": "OASH",
  "/mantenimiento": "OASBM",
  "/tareas": "OASB",
  "/whatsapp": "OAS",
  "/alertas": "OAS",
  "/puestos": "OA",
  "/admin": "OA",
  "/admin/usuarios": "OA",
  "/owner": "O",
  "/owner/usuarios": "O",
  "/perfil": ALL,
  "/sin-acceso": ALL,
  "/api/me": ALL,
  "/api/profile": ALL,
  "/api/branches": ALL,
  "/api/positions": ALL,
  "/api/employees": "OASHB",
  "/api/absences": "OASHB",
  "/api/vacations": "OASHB",
  "/api/time-events": "OASHB",
  "/api/action-plans": "OASHB",
  "/api/action-plan-forms": "OASHB",
  "/api/overtime": "OASHB",
  "/api/hour-bank": "OASHB",
  "/api/assignments": "OASH",
  "/api/admin": "OA",
  "/api/owner": "O",
  "/api/permissions": "OA",
  "/api/users": "OA",
  "/api/sync": "OAS",
};

const canFns = can as unknown as Record<string, (role: UserRole, flag?: boolean) => boolean>;

console.log("=== Rol × acción (can.*) ===");
assert("la matriz cubre exactamente los permisos de can.*",
  JSON.stringify(Object.keys(canFns).sort()) === JSON.stringify(Object.keys(ACTIONS).sort()));
for (const [name, codes] of Object.entries(ACTIONS)) {
  const fn = canFns[name];
  if (!fn) continue;
  for (const r of ROLES) {
    const expected = roles(codes).includes(r);
    assert(`can.${name}(${r}) → ${expected}`, fn(r, false) === expected);
  }
}
assert("editTimeEvent: el encargado corrige solo lo que cargó él",
  can.editTimeEvent("BRANCH_MANAGER", true) && !can.editTimeEvent("BRANCH_MANAGER", false));
assert("editTimeEvent: RRHH no corrige ni lo que cargó", !can.editTimeEvent("HR", true));

console.log("=== Rol × ruta (ROUTE_PERMISSIONS) ===");
assert("la matriz cubre exactamente las rutas de ROUTE_PERMISSIONS",
  JSON.stringify(Object.keys(ROUTE_PERMISSIONS).sort()) === JSON.stringify(Object.keys(ROUTES).sort()));
for (const [route, codes] of Object.entries(ROUTES)) {
  for (const r of ROLES) {
    const expected = roles(codes).includes(r);
    assert(`${route} · ${r} → ${expected}`, canAccessRoute(r, route) === expected);
    if (route !== "/") assert(`${route}/x · ${r} → ${expected}`, canAccessRoute(r, `${route}/x`) === expected);
  }
}

console.log("=== Regla: OWNER puede todo lo que puedan ADMIN o SUPERVISOR ===");
for (const [name, fn] of Object.entries(canFns)) {
  for (const flag of [false, true]) {
    const others = fn("ADMIN", flag) || fn("SUPERVISOR", flag);
    assert(`can.${name}: si ADMIN o SUPERVISOR pueden, OWNER también`, !others || fn("OWNER", flag));
  }
}
for (const [route, list] of Object.entries(ROUTE_PERMISSIONS)) {
  const others = list.includes("ADMIN") || list.includes("SUPERVISOR");
  assert(`ruta ${route}: si entra ADMIN o SUPERVISOR, entra OWNER`, !others || list.includes("OWNER"));
}
for (const path of ["/ruta-sin-declarar", "/api/ruta-sin-declarar"]) {
  const others = canAccessRoute("ADMIN", path) || canAccessRoute("SUPERVISOR", path);
  assert(`${path}: OWNER entra donde entren ADMIN o SUPERVISOR`, !others || canAccessRoute("OWNER", path));
}
for (const r of ["ADMIN", "SUPERVISOR"] as UserRole[]) {
  for (const route of MENU_BY_ROLE[r]) {
    assert(`menú: ${route} (de ${r}) está en el de OWNER`, MENU_BY_ROLE.OWNER.includes(route));
  }
  for (const route of visibleMenu(r)) {
    assert(`menú visible: ${route} (de ${r}) lo ve OWNER`, visibleMenu("OWNER").includes(route));
  }
}
for (const route of MENU_BY_ROLE.OWNER) {
  assert(`menú de OWNER: puede entrar a ${route}`, canAccessRoute("OWNER", route));
}
assert("Call Center: OWNER entra por jerarquía", CALL_CENTER_ROLE_ACCESS.includes("OWNER") && canViewCallCenter({ role: "OWNER" }));
assert("Dashboard Ejecutivo: OWNER siempre", canViewExecutive({ role: "OWNER" }));

console.log("=== Lo exclusivo de Dirección sigue exclusivo ===");
for (const r of ROLES.filter((x) => x !== "OWNER")) {
  assert(`/owner: ${r} no entra`, !canAccessRoute(r, "/owner") && !canAccessRoute(r, "/owner/usuarios") && !canAccessRoute(r, "/api/owner/users"));
  assert(`panel de Dirección: ${r} no`, !canAccessOwnerPanel({ role: r }));
  assert(`Dashboard Ejecutivo sin acceso otorgado: ${r} no`, !canViewExecutive({ role: r, executiveAccess: false }));
  assert(`menú: ${r} no tiene /owner`, !MENU_BY_ROLE[r].includes("/owner"));
}
assert("panel de Dirección: OWNER sí", canAccessOwnerPanel({ role: "OWNER" }));

console.log("=== Métricas del Call Center ===");
const CC_METRICS: Record<string, { fn: (u: { role: UserRole } | null | undefined) => boolean; allowed: string }> = {
  canViewCallCenterMetrics: { fn: canViewCallCenterMetrics, allowed: "OAS" },
  canViewCallCenterSales: { fn: canViewCallCenterSales, allowed: "OAS" },
  canConfigureCallCenterMetrics: { fn: canConfigureCallCenterMetrics, allowed: "OAS" },
};
for (const [name, { fn, allowed }] of Object.entries(CC_METRICS)) {
  const ok = roles(allowed);
  for (const r of ROLES) {
    assert(`${name}: ${r} ${ok.includes(r) ? "sí" : "no"}`, fn({ role: r }) === ok.includes(r));
  }
  assert(`${name}: sin usuario no`, !fn(null) && !fn(undefined));
  assert(`${name}: Dirección sí`, fn({ role: "OWNER" }));
}
// Entrar a la bandeja por flag no abre las métricas, las ventas ni la configuración.
for (const r of ROLES.filter((x) => !CALL_CENTER_ROLE_ACCESS.includes(x))) {
  const porFlag = { role: r, callCenterAccess: true };
  assert(`${r} con callCenterAccess: entra a la bandeja`, canViewCallCenter(porFlag));
  assert(`${r} con callCenterAccess: no ve métricas`, !canViewCallCenterMetrics(porFlag));
  assert(`${r} con callCenterAccess: no ve ventas`, !canViewCallCenterSales(porFlag));
  assert(`${r} con callCenterAccess: no configura`, !canConfigureCallCenterMetrics(porFlag));
}
// Ver las ventas del Call Center no abre el Dashboard Ejecutivo, y al revés.
for (const r of ["ADMIN", "SUPERVISOR"] as UserRole[]) {
  assert(`${r} sin executiveAccess: ve ventas del Call Center`, canViewCallCenterSales({ role: r }));
  assert(`${r} sin executiveAccess: no ve el Dashboard Ejecutivo`, !canViewExecutive({ role: r, executiveAccess: false }));
}
for (const r of ["HR", "BRANCH_MANAGER", "MAINTENANCE"] as UserRole[]) {
  assert(`${r} con executiveAccess: no ve ventas del Call Center`, !canViewCallCenterSales({ role: r }));
}
// Quien ve métricas siempre puede entrar a /call-center (si no, el middleware lo frenaría antes).
for (const r of ROLES) {
  if (canViewCallCenterMetrics({ role: r })) {
    assert(`${r}: ve métricas ⇒ entra al Call Center`, canViewCallCenter({ role: r }));
  }
}

console.log("=== Configuración de las métricas: página y API ===");
// El mismo control decide la página y la API (lectura y guardado). Seis roles, con y sin flag.
const CONFIG_OK = roles("OAS");
for (const r of ROLES) {
  for (const flag of [true, false]) {
    const u = { role: r, callCenterAccess: flag };
    const esperado = CONFIG_OK.includes(r) ? 200 : 403;
    assert(`configuración: ${r} flag=${flag} → ${esperado}`, callCenterMetricsConfigAccess(u) === esperado);
    // El flag no cambia nada: con y sin callCenterAccess da lo mismo.
    assert(
      `configuración: ${r} el flag no interviene`,
      callCenterMetricsConfigAccess({ role: r, callCenterAccess: true } as { role: UserRole }) ===
        callCenterMetricsConfigAccess({ role: r, callCenterAccess: false } as { role: UserRole }),
    );
    // Quien puede configurar siempre pasa el middleware de /call-center y de /api/call-center.
    if (esperado === 200) assert(`configuración: ${r} flag=${flag} pasa el gate de Call Center`, canViewCallCenter(u));
  }
}
for (const r of ["HR", "BRANCH_MANAGER", "MAINTENANCE"] as UserRole[]) {
  const soloFlag = { role: r, callCenterAccess: true };
  assert(`${r} con callCenterAccess: entra a la bandeja`, canViewCallCenter(soloFlag));
  assert(`${r} con callCenterAccess: 403 en la configuración`, callCenterMetricsConfigAccess(soloFlag) === 403);
  assert(`${r} con executiveAccess: 403 en la configuración`, callCenterMetricsConfigAccess({ role: r, executiveAccess: true } as { role: UserRole }) === 403);
}
assert("configuración: sin sesión → 401", callCenterMetricsConfigAccess(null) === 401 && callCenterMetricsConfigAccess(undefined) === 401);
// Quien configura también ve las métricas (la pantalla de métricas es la que enlaza a la configuración).
for (const r of ROLES) {
  if (canConfigureCallCenterMetrics({ role: r })) assert(`${r}: configura ⇒ ve métricas`, canViewCallCenterMetrics({ role: r }));
}

console.log("=== Volver a la plataforma desde Call Center ===");
assert("la ruta de vuelta es /dashboard", PLATFORM_HOME_ROUTE === "/dashboard");
for (const r of ROLES) {
  const porJerarquia = CALL_CENTER_ROLE_ACCESS.includes(r);
  // Con el flag: todos entran a la bandeja y todos tienen /dashboard → todos ven el enlace.
  assert(`${r} con callCenterAccess: ve "Volver a la plataforma"`, canSeePlatformLinkFromCallCenter({ role: r, callCenterAccess: true }));
  // Sin el flag: solo quien entra a la bandeja por jerarquía.
  assert(
    `${r} sin callCenterAccess: ${porJerarquia ? "lo ve" : "no lo ve (no entra a la bandeja)"}`,
    canSeePlatformLinkFromCallCenter({ role: r, callCenterAccess: false }) === porJerarquia,
  );
  // Nunca se ofrece a quien no entra a la bandeja, ni a quien no puede entrar a la plataforma.
  for (const flag of [true, false]) {
    const u = { role: r, callCenterAccess: flag };
    assert(
      `${r} flag=${flag}: el enlace equivale a entrar a la bandeja y a /dashboard`,
      canSeePlatformLinkFromCallCenter(u) === (canViewCallCenter(u) && canAccessRoute(r, PLATFORM_HOME_ROUTE)),
    );
  }
  // Hoy los seis roles tienen la plataforma operativa: si esto cambia, el enlace se oculta solo.
  assert(`${r}: tiene acceso a /dashboard`, canAccessRoute(r, PLATFORM_HOME_ROUTE));
}
assert("sin usuario: no se muestra", !canSeePlatformLinkFromCallCenter(null) && !canSeePlatformLinkFromCallCenter(undefined));

console.log(`\n=== Resultado: ${passed} pasaron, ${failed} fallaron ===`);
process.exit(failed === 0 ? 0 : 1);
