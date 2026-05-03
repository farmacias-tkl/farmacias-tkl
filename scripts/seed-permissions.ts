/**
 * Seed idempotente del catalogo de permisos operativos.
 *
 * Universo B (operativos) - SIN permisos de sistema (acceso ejecutivo,
 * panel owner, gestion de usuarios sensibles). Esos quedan en role +
 * executiveAccess, no en esta tabla.
 *
 * Uso:
 *   npx dotenv-cli -e .env.neon -- npx tsx scripts/seed-permissions.ts
 *
 * Idempotente: corre N veces sin duplicar. Hace upsert por key.
 * Si una key existente cambia su module o description, se actualiza.
 * Permisos que ya estan en DB pero no en este array NO se eliminan
 * automaticamente (soft-delete manual: poner active=false via SQL).
 *
 * Para agregar un permiso nuevo: editar PERMISSIONS, commitear, correr el seed.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PermissionDef {
  key:         string;
  module:      string;
  description: string;
}

const PERMISSIONS: PermissionDef[] = [
  // === VENCIDOS ===
  { key: "vencidos.view",                module: "vencidos",  description: "Ver listado de vencidos" },
  { key: "vencidos.upload_remito",       module: "vencidos",  description: "Subir remito de devolucion a drogueria" },
  { key: "vencidos.upload_nota_credito", module: "vencidos",  description: "Subir nota de credito recibida" },
  { key: "vencidos.view_conciliacion",   module: "vencidos",  description: "Ver tablero de conciliacion remito-NC" },
  { key: "vencidos.export",              module: "vencidos",  description: "Exportar reportes de vencidos" },

  // === CAJA ===
  { key: "caja.view",          module: "caja",  description: "Ver cierres de caja" },
  { key: "caja.create_close",  module: "caja",  description: "Crear cierre del dia" },
  { key: "caja.attach_doc",    module: "caja",  description: "Adjuntar comprobantes" },
  { key: "caja.export",        module: "caja",  description: "Exportar planillas de caja" },
  { key: "caja.edit_close",    module: "caja",  description: "Editar un cierre post-creacion" },

  // === EMPLEADOS ===
  { key: "empleados.view",            module: "empleados",  description: "Ver listado de empleados de la sucursal" },
  { key: "empleados.view_all",        module: "empleados",  description: "Ver empleados de todas las sucursales" },
  { key: "empleados.create",          module: "empleados",  description: "Alta de empleados" },
  { key: "empleados.edit",            module: "empleados",  description: "Editar datos basicos" },
  { key: "empleados.assign_branch",   module: "empleados",  description: "Reasignar a otra sucursal" },
  { key: "empleados.view_sensitive",  module: "empleados",  description: "Ver datos sensibles (notas, salario)" },

  // === AUSENCIAS ===
  { key: "ausencias.view",                module: "ausencias",  description: "Ver ausencias" },
  { key: "ausencias.create",              module: "ausencias",  description: "Reportar ausencia" },
  { key: "ausencias.justify",             module: "ausencias",  description: "Justificar ausencia" },
  { key: "ausencias.upload_certificate",  module: "ausencias",  description: "Subir certificado medico" },
  { key: "ausencias.delete",              module: "ausencias",  description: "Eliminar ausencia" },

  // === VACACIONES ===
  { key: "vacaciones.view",     module: "vacaciones",  description: "Ver vacaciones" },
  { key: "vacaciones.create",   module: "vacaciones",  description: "Solicitar vacaciones" },
  { key: "vacaciones.approve",  module: "vacaciones",  description: "Aprobar vacaciones" },
  { key: "vacaciones.confirm",  module: "vacaciones",  description: "Confirmar vacaciones" },
  { key: "vacaciones.cancel",   module: "vacaciones",  description: "Cancelar vacaciones" },

  // === MANTENIMIENTO ===
  { key: "mantenimiento.view",            module: "mantenimiento",  description: "Ver tickets de mantenimiento" },
  { key: "mantenimiento.create_ticket",   module: "mantenimiento",  description: "Crear ticket" },
  { key: "mantenimiento.assign",          module: "mantenimiento",  description: "Asignar ticket" },
  { key: "mantenimiento.update_status",   module: "mantenimiento",  description: "Actualizar estado del ticket" },
  { key: "mantenimiento.close",           module: "mantenimiento",  description: "Cerrar ticket" },

  // === TAREAS ===
  { key: "tareas.view",          module: "tareas",  description: "Ver tareas" },
  { key: "tareas.create",        module: "tareas",  description: "Crear tarea" },
  { key: "tareas.update_status", module: "tareas",  description: "Actualizar estado de tarea" },
  { key: "tareas.delete",        module: "tareas",  description: "Eliminar tarea" },

  // === PLANES DE ACCION ===
  { key: "planes.view",   module: "planes",  description: "Ver planes de accion" },
  { key: "planes.create", module: "planes",  description: "Crear plan de accion" },
  { key: "planes.close",  module: "planes",  description: "Cerrar plan de accion" },

  // === WHATSAPP ===
  { key: "whatsapp.view",   module: "whatsapp",  description: "Ver conversaciones" },
  { key: "whatsapp.send",   module: "whatsapp",  description: "Enviar mensaje" },
  { key: "whatsapp.review", module: "whatsapp",  description: "Revisar mensajes pendientes" },

  // === ROTATIVAS ===
  { key: "rotativas.view",   module: "rotativas",  description: "Ver rotativas y coberturas" },
  { key: "rotativas.assign", module: "rotativas",  description: "Asignar rotativa" },
  { key: "rotativas.cancel", module: "rotativas",  description: "Cancelar asignacion" },
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/]+)/)?.[1] ?? "(unknown)";
  console.log(`[db] host=${host}`);
  console.log(`[seed] permisos a procesar: ${PERMISSIONS.length}`);

  let created = 0;
  let updated = 0;
  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { key: p.key } });
    if (existing) {
      // Update solo si module o description cambiaron (key es la fuente de verdad).
      // No tocamos active aqui — soft-delete se hace manualmente.
      if (existing.module !== p.module || existing.description !== p.description) {
        await prisma.permission.update({
          where: { key: p.key },
          data:  { module: p.module, description: p.description },
        });
        updated++;
      }
    } else {
      await prisma.permission.create({
        data: { key: p.key, module: p.module, description: p.description, active: true },
      });
      created++;
    }
  }

  const totalActive   = await prisma.permission.count({ where: { active: true } });
  const totalInactive = await prisma.permission.count({ where: { active: false } });

  console.log(`[seed] created=${created}  updated=${updated}`);
  console.log(`[seed] total_active=${totalActive}  total_inactive=${totalInactive}`);
  console.log("[done] OK");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
