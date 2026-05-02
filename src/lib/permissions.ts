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
  SUPERVISOR:     ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/planes-accion","/tareas","/mantenimiento","/whatsapp","/alertas","/perfil"],
  CO_SUPERVISOR:  ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/planes-accion","/tareas","/mantenimiento","/whatsapp","/alertas","/perfil"],
  OWNER:          ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/horas-extras","/planes-accion","/tareas","/mantenimiento","/alertas","/owner","/perfil"],
  BRANCH_MANAGER: ["/dashboard","/empleados","/ausencias","/vacaciones","/horas-extras","/planes-accion","/tareas","/mantenimiento","/perfil"],
  HR:             ["/dashboard","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/planes-accion","/perfil"],
  MAINTENANCE:    ["/dashboard","/mantenimiento","/perfil"],
  ADMIN:          ["/dashboard","/sucursales","/empleados","/ausencias","/vacaciones","/rotativas","/horas-extras","/planes-accion","/tareas","/mantenimiento","/whatsapp","/alertas","/admin","/admin/usuarios","/puestos","/perfil"],
};

// ---------------------------------------------------------------------------
// Permisos por ruta — usado por middleware
// ---------------------------------------------------------------------------
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/":              ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/dashboard":     ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/sucursales":    ["SUPERVISOR","CO_SUPERVISOR","OWNER","ADMIN"],
  "/empleados":     ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/ausencias":     ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/planes-accion": ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","ADMIN"],
  "/horas-extras":  ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/vacaciones":    ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/rotativas":     ["SUPERVISOR","CO_SUPERVISOR","HR","ADMIN"],
  "/mantenimiento": ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","MAINTENANCE","OWNER","ADMIN"],
  "/tareas":        ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","OWNER","ADMIN"],
  "/whatsapp":      ["SUPERVISOR","CO_SUPERVISOR","ADMIN"],
  "/alertas":       ["SUPERVISOR","CO_SUPERVISOR","OWNER","ADMIN"],
  "/puestos":       ["ADMIN"],
  "/admin":         ["ADMIN"],
  "/admin/usuarios":["ADMIN"],
  "/owner":         ["OWNER"],
  "/perfil":        ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/executive":     ["OWNER","ADMIN","SUPERVISOR"],
  "/sin-acceso":    ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  // API routes
  "/api/me":            ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/profile":       ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/branches":      ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/positions":     ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"],
  "/api/employees":     ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/absences":      ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"],
  "/api/action-plans":  ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","ADMIN"],
  "/api/overtime":      ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","ADMIN"],
  "/api/assignments":   ["SUPERVISOR","CO_SUPERVISOR","HR","ADMIN"],
  "/api/admin":         ["ADMIN"],
  "/api/owner":         ["OWNER"],
  "/api/dashboard":     ["OWNER","ADMIN","SUPERVISOR"],
  "/api/sync":          ["OWNER","ADMIN","SUPERVISOR"],
};

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  for (const [prefix, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return roles.includes(role);
    }
  }
  if (pathname.startsWith("/api/")) {
    return ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","MAINTENANCE","OWNER","ADMIN"].includes(role);
  }
  return role === "ADMIN";
}

export const can = {
  // Sucursales
  viewAllBranches:  (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","HR","OWNER","ADMIN"].includes(role),
  manageBranches:   (role: UserRole) => role === "ADMIN",

  // Empleados
  viewAllEmployees: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","HR","OWNER","ADMIN"].includes(role),
  manageEmployees:  (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","ADMIN"].includes(role),
  reassignEmployee: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","HR","ADMIN"].includes(role),

  // Vacaciones
  createVacation:  (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","ADMIN"].includes(role),
  approveVacation: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),
  confirmVacation: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),
  manageCoverage:  (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","HR","ADMIN"].includes(role),

  // Ausencias
  createAbsence:  (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"].includes(role),
  editAbsence:    (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","HR","OWNER","ADMIN"].includes(role),
  justifyAbsence: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","HR","OWNER","ADMIN"].includes(role),

  // Planes de acción
  createActionPlan: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","ADMIN"].includes(role),

  // Horas extras
  createOvertime:  (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","ADMIN"].includes(role),
  approveOvertime: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),

  // Mantenimiento
  viewAllTickets:     (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","MAINTENANCE","OWNER","ADMIN"].includes(role),
  createTicket:       (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","MAINTENANCE","OWNER","ADMIN"].includes(role),
  assignTicket:       (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),
  updateTicketStatus: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","MAINTENANCE","ADMIN"].includes(role),

  // Tareas
  createTask:       (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),
  updateTaskStatus: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","BRANCH_MANAGER","ADMIN"].includes(role),

  // WhatsApp
  accessWhatsApp: (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),

  // Comentarios internos
  viewInternalComments: (role: UserRole) => role !== "OWNER",

  // Admin — gestión de usuarios
  manageUsers:     (role: UserRole) => role === "ADMIN",
  managePositions: (role: UserRole) => role === "ADMIN",
  viewAuditLog:    (role: UserRole) => role === "ADMIN",

  // Helpers
  isFullAccess:           (role: UserRole) => ["SUPERVISOR","CO_SUPERVISOR","ADMIN"].includes(role),
  isReadOnlyInEmployees:  (role: UserRole) => role === "OWNER",
  isReadOnlyInBranches:   (role: UserRole) => role === "OWNER",
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
  SUPERVISOR:     "Supervisor",
  CO_SUPERVISOR:  "Co-supervisora",
  BRANCH_MANAGER: "Encargada",
  HR:             "RRHH",
  MAINTENANCE:    "Mantenimiento",
  OWNER:          "Direccion",
  ADMIN:          "Administrador",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  SUPERVISOR:     "bg-blue-100 text-blue-800",
  CO_SUPERVISOR:  "bg-violet-100 text-violet-800",
  BRANCH_MANAGER: "bg-amber-100 text-amber-800",
  HR:             "bg-emerald-100 text-emerald-800",
  MAINTENANCE:    "bg-pink-100 text-pink-800",
  OWNER:          "bg-slate-100 text-slate-700",
  ADMIN:          "bg-red-100 text-red-800",
};

