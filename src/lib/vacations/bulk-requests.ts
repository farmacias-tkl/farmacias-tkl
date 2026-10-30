// =============================================================================
// Carga en lote de solicitudes de vacaciones recibidas por mail
// (scripts/load-vacation-requests.ts).
//
// Cada fila queda como una solicitud nueva en PENDING_SUPERVISOR, igual que
// si la hubiera creado un encargado desde la pantalla: misma validación
// (validateVacationRequest), mismos bloqueos, mismas advertencias guardadas
// (vacationRequestCreateData). No descuenta saldo: eso pasa al aprobar.
//
// CSV (solicitudes.csv): apellido_nombre, contrato, desde, hasta, nota
//   apellido_nombre + contrato = la clave de la carga de personal.
//   desde / hasta en YYYY-MM-DD o DD/MM/YYYY. nota es opcional (requesterNote).
//
// Plan (lee la base, no escribe) → applyVacationRequests (una transacción
// corta, por lotes; se niega si el plan tiene un solo error).
// =============================================================================

import type { PrismaClient } from "@prisma/client";
import { parseCsv } from "@/lib/personal/csv";
import { splitApellidoNombre } from "@/lib/personal/names";
import { branchIdByCode, parseFlexibleDate } from "@/lib/personal/load-plan";
import { dateRangesOverlap, parseISODate, toISODate } from "@/lib/personal/dates";
import { validateVacationRequest } from "./validation";
import { warningMessages, type ValidationResult } from "./rules";
import { ACTIVE_VACATION_STATUSES, type Db } from "./people";
import { vacationCreatedAuditDetail, vacationRequestCreateData, type CreatableEmployee } from "./create";

export const REQUESTS_FILE = "solicitudes.csv";
const HEADERS = ["apellido_nombre", "contrato", "desde", "hasta", "nota"] as const;
const REQUIRED = ["apellido_nombre", "contrato", "desde", "hasta"] as const;

/** Validaciones simultáneas contra la base (cada una son varias consultas). */
const VALIDATION_CONCURRENCY = 8;

export interface PlannedRequest {
  line: number;
  /** create = se crea · exists = ya hay una igual (no rechazada ni cancelada) · error = no se puede crear */
  action: "create" | "exists" | "error";
  rawName: string;
  employee: CreatableEmployee | null;
  /** Sucursal donde trabaja (para agrupar el informe). */
  branchName: string;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  note: string | null;
  balanceNow: number | null;
  balanceAfter: number | null;
  warnings: string[];
  errors: string[];
  existingId?: string;
  validation?: ValidationResult;
}

export interface RequestsPlan {
  fileErrors: string[];
  rows: PlannedRequest[];
  totals: { create: number; exists: number; error: number };
}

export function planHasErrors(plan: RequestsPlan): boolean {
  return plan.fileErrors.length > 0 || plan.totals.error > 0;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Lee el CSV y la base y arma el plan. No escribe nada. */
export async function planVacationRequests(db: Db, csvText: string): Promise<RequestsPlan> {
  const fileErrors: string[] = [];
  const csv = parseCsv(csvText);
  const missing = REQUIRED.filter((h) => !csv.headers.includes(h));
  if (missing.length) fileErrors.push(`${REQUESTS_FILE}: faltan columnas: ${missing.join(", ")} (columnas: ${HEADERS.join(", ")}).`);
  const csvRows = missing.length ? [] : csv.rows.filter((r) => Object.values(r.values).some((v) => v.trim() !== ""));

  const branches = await db.branch.findMany({ select: { id: true, name: true, code: true } });

  // 1. Formato de cada fila
  const rows: PlannedRequest[] = csvRows.map((r) => {
    const v = r.values;
    const row: PlannedRequest = {
      line: r.line, action: "create", rawName: (v.apellido_nombre ?? "").trim(), employee: null, branchName: "(sin identificar)",
      startDate: null, endDate: null, days: null, note: (v.nota ?? "").trim() || null,
      balanceNow: null, balanceAfter: null, warnings: [], errors: [],
    };
    if (!splitApellidoNombre(v.apellido_nombre ?? "")) row.errors.push(`apellido_nombre "${v.apellido_nombre ?? ""}" tiene que ser "Apellido, Nombre" (con una coma).`);
    if (!branchIdByCode(branches, v.contrato ?? "", false)) row.errors.push(`Sucursal de contrato desconocida: "${v.contrato ?? ""}".`);
    row.startDate = parseFlexibleDate(v.desde ?? "");
    row.endDate = parseFlexibleDate(v.hasta ?? "");
    if (!row.startDate) row.errors.push(`desde inválida: "${v.desde ?? ""}" (YYYY-MM-DD o DD/MM/YYYY).`);
    if (!row.endDate) row.errors.push(`hasta inválida: "${v.hasta ?? ""}" (YYYY-MM-DD o DD/MM/YYYY).`);
    return row;
  });

  // 2. Empleados por la clave (una consulta)
  const keyOf = (r: (typeof csvRows)[number]) => {
    const name = splitApellidoNombre(r.values.apellido_nombre ?? "");
    const contract = branchIdByCode(branches, r.values.contrato ?? "", false);
    return name && contract ? { nameKey: name.nameKey, contractBranchId: contract } : null;
  };
  const keys = csvRows.map(keyOf);
  const nameKeys = [...new Set(keys.filter((k): k is NonNullable<typeof k> => !!k).map((k) => k.nameKey))];
  const people = nameKeys.length === 0 ? [] : await db.employee.findMany({
    where: { nameKey: { in: nameKeys } },
    include: { position: { select: { name: true } }, currentBranch: { select: { name: true } } },
  });
  const byKey = new Map(people.map((p) => [`${p.nameKey}|${p.contractBranchId}`, p]));

  rows.forEach((row, i) => {
    const k = keys[i];
    if (!k) return;
    const p = byKey.get(`${k.nameKey}|${k.contractBranchId}`);
    if (!p) { row.errors.push(`No existe "${row.rawName}" con contrato en esa sucursal.`); return; }
    if (!p.active) row.errors.push(`${p.firstName} ${p.lastName} está inactivo/a.`);
    if (!p.currentBranchId || !p.currentBranch) row.errors.push("El empleado no tiene sucursal donde trabaja asignada.");
    if (p.currentBranch) row.branchName = p.currentBranch.name;
    if (p.currentBranchId && p.currentBranch) {
      row.employee = {
        id: p.id, firstName: p.firstName, lastName: p.lastName, positionId: p.positionId, position: p.position,
        currentBranchId: p.currentBranchId, currentBranch: p.currentBranch,
      };
    }
  });

  // 3. La misma persona dos veces en el archivo con fechas que se pisan
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (!a.employee || !b.employee || a.employee.id !== b.employee.id) continue;
      if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) continue;
      if (!dateRangesOverlap(parseISODate(a.startDate)!, parseISODate(a.endDate)!, parseISODate(b.startDate)!, parseISODate(b.endDate)!)) continue;
      a.errors.push(`Se superpone con la línea ${b.line} del archivo (misma persona).`);
      b.errors.push(`Se superpone con la línea ${a.line} del archivo (misma persona).`);
    }
  }

  // 4. Ya existentes: mismo empleado, mismas fechas, no rechazada ni cancelada (una consulta)
  const ids = [...new Set(rows.filter((r) => r.employee).map((r) => r.employee!.id))];
  const active = ids.length === 0 ? [] : await db.vacationRequest.findMany({
    where: { employeeId: { in: ids }, status: { in: ACTIVE_VACATION_STATUSES } },
    select: { id: true, employeeId: true, startDate: true, endDate: true },
  });
  for (const row of rows) {
    if (!row.employee || !row.startDate || !row.endDate) continue;
    const same = active.find((v) => v.employeeId === row.employee!.id
      && toISODate(v.startDate) === row.startDate && toISODate(v.endDate) === row.endDate);
    if (same) { row.action = "exists"; row.existingId = same.id; }
  }

  // 5. Validación de la API para las que se crearían (sin errores de formato)
  const toValidate = rows.filter((r) => r.action === "create" && r.employee && r.errors.length === 0);
  const results = await mapLimit(toValidate, VALIDATION_CONCURRENCY, (r) => validateVacationRequest({
    employeeId: r.employee!.id, startDate: parseISODate(r.startDate!)!, endDate: parseISODate(r.endDate!)!,
  }, db));
  toValidate.forEach((r, i) => {
    const v = results[i];
    r.validation = v;
    r.days = v.calculatedDays;
    r.balanceNow = v.balance?.total ?? null;
    r.balanceAfter = v.balance?.totalAfter ?? null;
    if (!v.isValid) {
      r.errors.push(...v.ruleResults.filter((x) => x.status === "BLOCKING").map((x) => x.message));
      r.errors.push(...v.blockingConflicts.map((x) => x.message));
    }
    r.warnings = warningMessages(v);
  });

  for (const r of rows) if (r.errors.length > 0) r.action = "error";
  const totals = {
    create: rows.filter((r) => r.action === "create").length,
    exists: rows.filter((r) => r.action === "exists").length,
    error: rows.filter((r) => r.action === "error").length,
  };
  return { fileErrors, rows, totals };
}

export function formatRequestsReport(plan: RequestsPlan): string {
  const out: string[] = [];
  for (const e of plan.fileErrors) out.push(`ERROR ${e}`);
  const byBranch = new Map<string, PlannedRequest[]>();
  for (const r of plan.rows) byBranch.set(r.branchName, [...(byBranch.get(r.branchName) ?? []), r]);
  const label = { create: "crear", exists: "ya existe", error: "ERROR" } as const;
  const fmtBal = (n: number | null) => (n === null ? "—" : String(n));
  for (const [branch, rs] of [...byBranch.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    out.push(`\n== ${branch} (${rs.length}) ==`);
    for (const r of rs.sort((a, b) => a.line - b.line)) {
      const who = r.employee ? `${r.employee.lastName}, ${r.employee.firstName}` : r.rawName || "(sin nombre)";
      const days = r.days ?? (r.startDate && r.endDate ? Math.round((parseISODate(r.endDate)!.getTime() - parseISODate(r.startDate)!.getTime()) / 86_400_000) + 1 : null);
      out.push(`  línea ${r.line} · ${label[r.action]} · ${who} · ${r.startDate ?? "?"} → ${r.endDate ?? "?"} · ${days ?? "?"} días · saldo ${fmtBal(r.balanceNow)} → ${fmtBal(r.balanceAfter)}`);
      for (const e of r.errors) out.push(`      error: ${e}`);
      for (const w of r.warnings) out.push(`      advertencia: ${w}`);
    }
  }
  out.push(`\n== Totales ==\n  a crear: ${plan.totals.create} · ya existentes: ${plan.totals.exists} · con error: ${plan.totals.error}`);
  out.push("  (Las solicitudes quedan Solicitadas: el saldo no se toca hasta aprobar.)");
  return out.join("\n");
}

export interface ApplyRequestsResult { created: number; existing: number }

/**
 * Crea las solicitudes del plan en una sola transacción, por lotes: el
 * re-chequeo de superposición, createMany de solicitudes, una lectura de sus
 * ids, createMany del historial y de la auditoría. Unas pocas consultas sin
 * importar cuántas filas haya.
 */
export async function applyVacationRequests(
  db: PrismaClient,
  plan: RequestsPlan,
  actor: { userId: string },
  opts: { onProgress?: (msg: string) => void; timeoutMs?: number } = {},
): Promise<ApplyRequestsResult> {
  if (planHasErrors(plan)) throw new Error("El plan tiene errores: no se escribe nada.");
  const progress = opts.onProgress ?? (() => {});
  const toCreate = plan.rows.filter((r) => r.action === "create");
  const existing = plan.totals.exists;
  if (toCreate.length === 0) return { created: 0, existing };

  const items = toCreate.map((r) => ({
    row: r,
    start: parseISODate(r.startDate!)!,
    end: parseISODate(r.endDate!)!,
  }));

  await db.$transaction(async (tx) => {
    // Desde la validación pudo aparecer otra solicitud activa de la misma persona.
    const employeeIds = [...new Set(items.map((x) => x.row.employee!.id))];
    const activeNow = await tx.vacationRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: { in: ACTIVE_VACATION_STATUSES } },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    for (const x of items) {
      const clash = activeNow.find((v) => v.employeeId === x.row.employee!.id && dateRangesOverlap(v.startDate, v.endDate, x.start, x.end));
      if (clash) {
        throw new Error(`Línea ${x.row.line}: apareció otra solicitud activa superpuesta (${toISODate(clash.startDate)} → ${toISODate(clash.endDate)}). No se escribió nada; volvé a correr el dry-run.`);
      }
    }

    progress(`solicitudes: creando ${items.length}...`);
    await tx.vacationRequest.createMany({
      data: items.map((x) => vacationRequestCreateData({
        employee: x.row.employee!, startDate: x.start, endDate: x.end,
        requesterNote: x.row.note, validation: x.row.validation!, requestedByUserId: actor.userId,
      })),
    });
    const created = await tx.vacationRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "PENDING_SUPERVISOR", requestedByUserId: actor.userId },
      select: { id: true, employeeId: true, startDate: true, endDate: true },
    });
    const idOf = (x: (typeof items)[number]) => {
      const c = created.find((v) => v.employeeId === x.row.employee!.id
        && toISODate(v.startDate) === x.row.startDate && toISODate(v.endDate) === x.row.endDate);
      if (!c) throw new Error(`Línea ${x.row.line}: no se encontró la solicitud recién creada.`);
      return c.id;
    };
    const withIds = items.map((x) => ({ ...x, id: idOf(x) }));

    // POST /api/vacations no deja historial al crear; acá queda una entrada
    // (Solicitada → Solicitada) que dice que llegó por la carga en lote.
    await tx.vacationStateHistory.createMany({
      data: withIds.map((x) => ({
        vacationId: x.id, fromStatus: "PENDING_SUPERVISOR" as const, toStatus: "PENDING_SUPERVISOR" as const,
        changedByUserId: actor.userId, note: "Alta por carga en lote (solicitud recibida por mail)",
      })),
    });
    await tx.auditLog.createMany({
      data: withIds.map((x) => ({
        userId: actor.userId, action: "VACATION_REQUEST_CREATED", entity: "VacationRequest", entityId: x.id,
        detail: { ...(vacationCreatedAuditDetail(x.row.employee!, x.start, x.end, x.row.validation!) as object), source: "carga-lote", line: x.row.line },
      })),
    });
    progress(`solicitudes: listo (${withIds.length} creadas, con historial y auditoría).`);
  }, { timeout: opts.timeoutMs ?? 120_000, maxWait: 30_000 });

  return { created: toCreate.length, existing };
}
