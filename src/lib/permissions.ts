import type { UserRole } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers de acceso ejecutivo / panel OWNER
// Single source of truth — usar en middleware, layouts y componentes UI.
// ---------------------------------------------------------------------------

/**
 * ¿Puede ver el Dashboard Ejecutivo?
 * Reglas:
 * - OWNER siempre tiene acceso (hardcoded, no revocable).
 * - Cualquier otro rol depende del flag executiveAccess (otorgado por OWNER).
 */
export function canViewExecutive(
  u: { role: UserRole; executiveAccess?: boolean | null } | null | undefined,
): boolean {
  if (!u) return false;
  if (u.role === "OWNER") return true;
  return Boolean(u.executiveAccess);
}

/**
 * Roles con acceso a Call Center por JERARQUÍA (acceso automático, sin flag).
 * FUENTE ÚNICA — usar en canViewCallCenter, el endpoint de grant, el GET de
 * /owner/accesos y la UI. No duplicar esta lista en ningún otro lado.
 * HR NO está acá: entra solo por callCenterAccess = true.
 */
export const CALL_CENTER_ROLE_ACCESS: readonly UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR"];

/**
 * ¿Puede ver el módulo Call Center?
 * Modelo JERARQUÍA + EXCEPCIÓN (NO flag-puro como executiveAccess): Call Center es
 * un área de trabajo diaria, no un dominio excepcional.
 * - OWNER, ADMIN, SUPERVISOR → true SIEMPRE (acceso implícito por rol, sin toggle).
 * - Cualquier otro rol (incluido HR) → depende del flag callCenterAccess (otorgado
 *   por OWNER). HR NO entra por jerarquía: solo por flag. Si en el futuro se decide
 *   que sí, es agregar "HR" a CALL_CENTER_ROLE_ACCESS (un solo lugar).
 *
 * Única fuente de verdad del gate: usar IDÉNTICA en middleware, layout SSR y en el
 * handler de CADA API route bajo /api/call-center (no chequear callCenterAccess solo,
 * o un SUPERVISOR sin flag vería la UI pero comería 403 en las API).
 */
export function canViewCallCenter(
  u: { role: UserRole; callCenterAccess?: boolean | null } | null | undefined,
): boolean {
  if (!u) return false;
  if (CALL_CENTER_ROLE_ACCESS.includes(u.role)) return true;
  return Boolean(u.callCenterAccess);
}

/**
 * ¿Puede OPERAR en Call Center (tomar / reasignar / cerrar conversaciones)?
 * HOY actuar == ver: es un alias de canViewCallCenter (misma fuente única). Existe
 * como función propia para preparar un split futuro (permisos finos por puesto) sin
 * tocar los call sites. NO se construyen permisos por puesto hasta que el dueño lo
 * pida (deuda explícita). El control va server-side en cada handler, no solo en la UI.
 * Como canViewCallCenter, es PURO y recibe el user por parámetro: sirve igual para el
 * predicado de la sesión actual y para filtrar un listado de usuarios.
 */
export function canActOnCallCenter(
  u: { role: UserRole; callCenterAccess?: boolean | null } | null | undefined,
): boolean {
  return canViewCallCenter(u);
}

// ---------------------------------------------------------------------------
// Métricas del Call Center (/call-center/metricas y /api/call-center/metrics)
//
// Gate PROPIO, por rol: entrar a la bandeja (canViewCallCenter, que también abre
// el flag callCenterAccess) NO da acceso a las métricas. Un usuario que entra
// solo por flag ve la bandeja y nada de esto.
//
// Tres funciones separadas aunque hoy dos coincidan: cada una se puede ajustar
// sin tocar los lugares que la usan. Se aplican en el servidor: la página, cada
// ruta de la API y el detalle de casos. El middleware solo deja pasar a quien
// tiene canViewCallCenter; el corte fino va en cada handler.
// ---------------------------------------------------------------------------

/** Roles que ven las métricas del Call Center (atención, demoras, cuentas, detectados). */
export const CALL_CENTER_METRICS_ROLES: readonly UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR"];

/**
 * Roles que ven las ventas SIAF de los vendedores del Call Center dentro del módulo de
 * métricas. Decisión de Dirección (21/11/2026): incluye a ADMIN y SUPERVISOR aunque no
 * tengan executiveAccess. Vale SOLO para ese bloque: no cambia canViewExecutive ni abre
 * el Dashboard Ejecutivo. Cada vista se registra en AccessLog.
 */
export const CALL_CENTER_SALES_ROLES: readonly UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR"];

/**
 * Roles que ven y cambian la configuración de las métricas (horarios, meta, cuentas,
 * vendedores). Decisión de Dirección (22/11/2026): Dirección, Administrador y Supervisión.
 * La pantalla lista los vendedores de SIAF por sucursal con su nombre. Cada guardado crea
 * una versión nueva (nunca edita ni borra) y queda en AuditLog con el usuario que lo hizo.
 */
export const CALL_CENTER_METRICS_CONFIG_ROLES: readonly UserRole[] = ["OWNER", "ADMIN", "SUPERVISOR"];

/** ¿Puede ver las métricas del Call Center? */
export function canViewCallCenterMetrics(u: { role: UserRole } | null | undefined): boolean {
  return !!u && CALL_CENTER_METRICS_ROLES.includes(u.role);
}

/** ¿Puede ver el bloque de ventas SIAF del Call Center? No implica el Dashboard Ejecutivo. */
export function canViewCallCenterSales(u: { role: UserRole } | null | undefined): boolean {
  return !!u && CALL_CENTER_SALES_ROLES.includes(u.role);
}

/**
 * ¿Puede ver y cambiar la configuración de las métricas del Call Center? Por rol: el flag
 * callCenterAccess no interviene, así que entrar a la bandeja por flag no alcanza.
 */
export function canConfigureCallCenterMetrics(u: { role: UserRole } | null | undefined): boolean {
  return !!u && CALL_CENTER_METRICS_CONFIG_ROLES.includes(u.role);
}

/**
 * Resultado del control de acceso a la configuración de las métricas, igual para la página y
 * para la API (lectura y guardado): 401 sin sesión, 403 sin permiso, 200 si puede. La API
 * responde con ese código; la página manda al login o a "sin acceso".
 */
export function callCenterMetricsConfigAccess(u: { role: UserRole } | null | undefined): 200 | 401 | 403 {
  if (!u) return 401;
  return canConfigureCallCenterMetrics(u) ? 200 : 403;
}

/** Ruta de entrada de la plataforma operativa: adonde lleva "Volver a la plataforma". */
export const PLATFORM_HOME_ROUTE = "/dashboard";

/**
 * ¿Se le muestra "Volver a la plataforma" dentro de Call Center?
 * A todo el que entra a la bandeja Y puede entrar a la plataforma operativa. Hoy los seis
 * roles tienen /dashboard, así que lo ve cualquiera que entre a la bandeja (por jerarquía o
 * por el flag callCenterAccess). La segunda condición lo deja preparado: si algún día
 * existe un rol sin acceso a /dashboard, a ese usuario no se le ofrece un enlace que lo
 * rebotaría.
 */
export function canSeePlatformLinkFromCallCenter(
  u: { role: UserRole; callCenterAccess?: boolean | null } | null | undefined,
): boolean {
  if (!u) return false;
  return canViewCallCenter(u) && canAccessRoute(u.role, PLATFORM_HOME_ROUTE);
}

/** ¿Puede acceder al panel /owner? Solo OWNER. */
export function canAccessOwnerPanel(
  u: { role: UserRole } | null | undefined,
): boolean {
  return u?.role === "OWNER";
}

// ---------------------------------------------------------------------------
// MENU por rol — orden de aparición en el sidebar
// /perfil aparece en todos los roles (al final, antes de logout)
// ---------------------------------------------------------------------------
export const MENU_BY_ROLE: Record<UserRole, string[]> = {
  SUPERVISOR:     ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/banco-horas","/planes-accion","/tareas","/mantenimiento","/whatsapp","/alertas","/perfil"],
  OWNER:          ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/banco-horas","/planes-accion","/tareas","/mantenimiento","/whatsapp","/alertas","/admin","/admin/usuarios","/puestos","/owner","/perfil"],
  BRANCH_MANAGER: ["/dashboard","/empleados","/ausencias","/vacaciones","/horas-extras","/banco-horas","/planes-accion","/tareas","/mantenimiento","/perfil"],
  HR:             ["/dashboard","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/banco-horas","/planes-accion","/perfil"],
  MAINTENANCE:    ["/dashboard","/mantenimiento","/perfil"],
  ADMIN:          ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/banco-horas","/planes-accion","/tareas","/mantenimiento","/whatsapp","/alertas","/admin","/admin/usuarios","/puestos","/perfil"],
};

/**
 * Secciones que todavía no tienen funcionalidad: la pantalla es solo un aviso de
 * "disponible en la siguiente etapa". No aparecen en el menú ni en el dashboard;
 * el código y la ruta siguen. Para mostrar una, sacarla de esta lista.
 */
export const HIDDEN_MENU_ROUTES: readonly string[] = ["/tareas", "/mantenimiento", "/whatsapp", "/alertas"];

/** La API de la que depende una pantalla, cuando una pantalla sin ella queda vacía. */
const MENU_ROUTE_API: Record<string, string> = {
  "/horas-extras": "/api/overtime",
  "/banco-horas":  "/api/hour-bank",
};

export function isMenuRouteHidden(route: string): boolean {
  return HIDDEN_MENU_ROUTES.includes(route);
}

/**
 * Menú de un rol: sin las secciones ocultas ni los ítems a los que el rol no
 * puede entrar (tocarlos lo mandaría de vuelta al dashboard o mostraría una
 * pantalla vacía).
 */
export function visibleMenu(role: UserRole): string[] {
  return (MENU_BY_ROLE[role] ?? []).filter((route) => {
    if (isMenuRouteHidden(route) || !canAccessRoute(role, route)) return false;
    const api = MENU_ROUTE_API[route];
    return !api || canAccessRoute(role, api);
  });
}

// ---------------------------------------------------------------------------
// Permisos por ruta — usado por middleware
// ---------------------------------------------------------------------------
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/":              ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/dashboard":     ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/sucursales":    ["SUPERVISOR","OWNER","ADMIN"],
  "/empleados":     ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/ausencias":     ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  // Planes de acción y horas extras: RRHH solo lee (las escrituras
  // se cortan en cada handler con can.createActionPlan / can.createOvertime).
  "/planes-accion": ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/horas-extras":  ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  // Banco de horas: RRHH solo lee (las escrituras se cortan en
  // cada handler con can.requestHourBank / authorizeHourBank / adjustHourBank).
  "/banco-horas":   ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/vacaciones":    ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/rotativas":     ["SUPERVISOR","HR","OWNER","ADMIN"],
  "/mantenimiento": ["SUPERVISOR","BRANCH_MANAGER","MAINTENANCE","OWNER","ADMIN"],
  "/tareas":        ["SUPERVISOR","BRANCH_MANAGER","OWNER","ADMIN"],
  "/whatsapp":      ["SUPERVISOR","OWNER","ADMIN"],
  "/alertas":       ["SUPERVISOR","OWNER","ADMIN"],
  "/puestos":       ["ADMIN","OWNER"],
  "/admin":         ["ADMIN","OWNER"],
  "/admin/usuarios":["ADMIN","OWNER"],
  "/owner":         ["OWNER"],
  "/owner/usuarios":["OWNER"],
  "/perfil":        ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  // Nota: /executive y /api/dashboard NO van aquí. Su gate es canViewExecutive
  // (chequea rol OWNER + flag executiveAccess) aplicado directo en el middleware.
  // Nota: /call-center y /api/call-center TAMPOCO van aquí. Su gate es
  // canViewCallCenter (jerarquía OWNER/ADMIN/SUPERVISOR + flag callCenterAccess),
  // aplicado en el middleware, el layout SSR y cada handler del dominio.
  "/sin-acceso":    ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  // API routes
  "/api/me":            ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/profile":       ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/branches":      ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/positions":     ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/employees":     ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/absences":      ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/vacations":     ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/time-events":   ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/action-plans":  ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/action-plan-forms": ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/overtime":      ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/hour-bank":     ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/assignments":   ["SUPERVISOR","HR","OWNER","ADMIN"],
  "/api/admin":         ["ADMIN","OWNER"],
  "/api/owner":         ["OWNER"],
  "/api/permissions":   ["OWNER","ADMIN"],
  // Permisos por usuario (refactor permisos-por-usuario, Fase 2C-B). Árbol neutral
  // que sirve a OWNER y ADMIN; la autorización fina (target, scope, críticos) vive
  // en el servicio user-permissions-admin. Esto es defensa-en-profundidad en el edge.
  "/api/users":         ["OWNER","ADMIN"],
  // /api/dashboard: gate via canViewExecutive en middleware (no por rol).
  "/api/sync":          ["OWNER","ADMIN","SUPERVISOR"],
};

/** Validar una solicitud de un empleado: el encargado, solo los de su sucursal. */
export function canValidateVacationFor(
  user: { role: UserRole; branchId?: string | null },
  employeeBranchId: string | null,
): boolean {
  if (!can.viewVacationDetail(user.role)) return false;
  if (user.role !== "BRANCH_MANAGER") return true;
  return !!user.branchId && employeeBranchId === user.branchId;
}

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  for (const [prefix, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return roles.includes(role);
    }
  }
  if (pathname.startsWith("/api/")) {
    return ["SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"].includes(role);
  }
  return role === "ADMIN" || role === "OWNER";
}

/**
 * Qué hace el middleware con una ruta según el rol. Una API sin permiso responde
 * 403: quien llama es código, y un redirect le devolvería el HTML del dashboard.
 * Una página sin permiso sigue yendo al dashboard.
 */
export function routeDecision(role: UserRole, pathname: string): "allow" | "forbidden" | "redirect" {
  if (canAccessRoute(role, pathname)) return "allow";
  return pathname.startsWith("/api/") ? "forbidden" : "redirect";
}

// Regla: Dirección (OWNER) tiene el máximo nivel. Toda acción que pueda
// Administrador (ADMIN) o Supervisión (SUPERVISOR) la puede OWNER; lo controla
// src/lib/permissions-owner.test.ts, que falla si un permiso nuevo se lo olvida.
export const can = {
  // Sucursales
  viewAllBranches:  (role: UserRole) => ["SUPERVISOR","HR","OWNER","ADMIN"].includes(role),
  manageBranches:   (role: UserRole) => role === "ADMIN" || role === "OWNER",

  // Empleados
  viewAllEmployees: (role: UserRole) => ["SUPERVISOR","HR","OWNER","ADMIN"].includes(role),
  manageEmployees:  (role: UserRole) => ["SUPERVISOR","HR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),
  reassignEmployee: (role: UserRole) => ["SUPERVISOR","HR","ADMIN","OWNER"].includes(role),

  // Vacaciones
  // Saldo y horario de una persona (detalle del día, validar). Encargado/a: su sucursal.
  viewVacationDetail: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER","HR","BRANCH_MANAGER"].includes(role),
  // RRHH (HR) solo ve: no crea, aprueba, rechaza, deshace, cancela ni cambia cobertura.
  createVacation:  (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),
  // Aprobar, rechazar y deshacer la aprobación (decisión final de supervisión).
  approveVacation: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  // Paso 2 (solo con VACATIONS_RRHH_STEP=true). RRHH (HR) solo revisa: ve lista,
  // calendario, detalle y saldos, pero no aprueba, rechaza, deshace ni cambia
  // la cobertura; por eso HR no está acá ni en approveVacation.
  confirmVacation: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  // Cambiar o quitar el rotativo de una solicitud (también desde Rotativas).
  changeVacationCoverage: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  cancelVacation:  (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),
  // Cancelar una ya aprobada (reversión excepcional, motivo obligatorio). Encargado/a no.
  cancelApprovedVacation: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  manageCoverage:  (role: UserRole) => ["SUPERVISOR","HR","ADMIN","OWNER"].includes(role),

  // Ausencias
  createAbsence:  (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"].includes(role),
  editAbsence:    (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"].includes(role),
  justifyAbsence: (role: UserRole) => ["SUPERVISOR","HR","OWNER","ADMIN"].includes(role),

  // Asistencia y novedades (TimeEvent)
  viewAttendance:    (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"].includes(role),
  // RRHH (HR) solo ve: no carga, no autoriza, no resuelve ni compensa.
  createTimeEvent:   (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),
  // Autoriza un retiro anticipado (operativo, PENDING_AUTHORIZATION → PENDING_REVIEW)
  authorizeTimeEvent:(role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  // Decide cómo se resuelve la deuda (compensación, payroll, condonar)
  resolveTimeEvent:  (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  // Registra una compensación
  addCompensation:   (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  // Corrige un registro todavía abierto: supervisión siempre; el encargado solo
  // el que cargó él (y de su sucursal, que se valida en la API).
  editTimeEvent:     (role: UserRole, isReporter: boolean) =>
    ["SUPERVISOR","ADMIN","OWNER"].includes(role) || (role === "BRANCH_MANAGER" && isReporter),

  // Planes de acción
  createActionPlan: (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),

  // Horas extras
  createOvertime:  (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),
  // Aprobar (eligiendo destino: Pagar o Banco de horas) y rechazar.
  approveOvertime: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),

  // Banco de horas. Encargado/a: solo su sucursal. RRHH solo lee.
  viewHourBank:      (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"].includes(role),
  // Pedir un día o una franja contra el banco.
  requestHourBank:   (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),
  // Autorizar o rechazar el pedido, y cancelar uno ya autorizado.
  authorizeHourBank: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  // Saldo inicial, compensaciones y ajustes.
  adjustHourBank:    (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),

  // Mantenimiento
  viewAllTickets:     (role: UserRole) => ["SUPERVISOR","MAINTENANCE","OWNER","ADMIN"].includes(role),
  createTicket:       (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","MAINTENANCE","OWNER","ADMIN"].includes(role),
  assignTicket:       (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  updateTicketStatus: (role: UserRole) => ["SUPERVISOR","MAINTENANCE","ADMIN","OWNER"].includes(role),

  // Tareas
  createTask:       (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
  updateTaskStatus: (role: UserRole) => ["SUPERVISOR","BRANCH_MANAGER","ADMIN","OWNER"].includes(role),

  // WhatsApp
  accessWhatsApp: (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),

  // Comentarios internos
  viewInternalComments: (_role: UserRole) => true,

  // Admin — gestión de usuarios
  manageUsers:     (role: UserRole) => role === "ADMIN" || role === "OWNER",
  managePositions: (role: UserRole) => role === "ADMIN" || role === "OWNER",
  // Asignar/revocar permisos operativos a puestos. OWNER + ADMIN por ahora.
  // Si Direccion en el futuro pide restringir solo a OWNER, cambiar 1 linea.
  managePositionPermissions: (role: UserRole) => role === "ADMIN" || role === "OWNER",
  viewAuditLog:    (role: UserRole) => role === "ADMIN" || role === "OWNER",

  // Helpers
  isFullAccess:           (role: UserRole) => ["SUPERVISOR","ADMIN","OWNER"].includes(role),
};

export function requireCan(
  check: (role: UserRole) => boolean,
  session: { user: { role: UserRole } } | null
): { error: string; status: number } | null {
  if (!session?.user) return { error: "No autenticado", status: 401 };
  if (!check(session.user.role)) return { error: "Sin permisos", status: 403 };
  return null;
}

export function requireAuth(
  session: { user?: any } | null
): { error: string; status: number } | null {
  if (!session?.user) return { error: "No autenticado", status: 401 };
  return null;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPERVISOR:     "Supervisor/a",
  BRANCH_MANAGER: "Encargado/a",
  HR:             "RRHH",
  MAINTENANCE:    "Mantenimiento",
  OWNER:          "Dirección",
  ADMIN:          "Administrador",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  SUPERVISOR:     "bg-blue-100 text-blue-800",
  BRANCH_MANAGER: "bg-amber-100 text-amber-800",
  HR:             "bg-emerald-100 text-emerald-800",
  MAINTENANCE:    "bg-pink-100 text-pink-800",
  OWNER:          "bg-slate-100 text-slate-700",
  ADMIN:          "bg-red-100 text-red-800",
};
