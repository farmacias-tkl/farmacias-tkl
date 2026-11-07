import {
  LayoutDashboard, CalendarDays, Users, Wrench, ClipboardList,
  MessageSquare, BellDot, Settings, MapPin, UserMinus, RotateCcw, Clock,
  FileWarning, ShieldCheck, Briefcase, Crown, User,
} from "lucide-react";

export const ROUTE_META: Record<string, { label: string; icon: React.ElementType }> = {
  "/dashboard":      { label: "Dashboard",        icon: LayoutDashboard },
  "/sucursales":     { label: "Sucursales",        icon: MapPin          },
  "/empleados":      { label: "Empleados",         icon: Users           },
  "/ausencias":      { label: "Asistencia",        icon: UserMinus       },
  "/planes-accion":  { label: "Planes de accion",  icon: FileWarning     },
  "/horas-extras":   { label: "Horas extras",      icon: Clock           },
  "/vacaciones":     { label: "Vacaciones",        icon: CalendarDays    },
  "/rotativas":      { label: "Rotativas",         icon: RotateCcw       },
  "/mantenimiento":  { label: "Mantenimiento",     icon: Wrench          },
  "/tareas":         { label: "Tareas",            icon: ClipboardList   },
  "/whatsapp":       { label: "WhatsApp",          icon: MessageSquare   },
  "/alertas":        { label: "Alertas",           icon: BellDot         },
  "/puestos":        { label: "Puestos",           icon: Briefcase       },
  "/admin":          { label: "Administracion",    icon: Settings        },
  "/admin/usuarios": { label: "Usuarios",          icon: ShieldCheck     },
  "/owner":          { label: "Panel Direccion",   icon: Crown           },
  "/perfil":         { label: "Mi perfil",         icon: User            },
};

/** ¿Este ítem del menú corresponde a la pantalla actual? */
export function isRouteActive(route: string, pathname: string): boolean {
  return route === "/dashboard"
    ? pathname === "/dashboard"
    : pathname === route || pathname.startsWith(route + "/");
}
