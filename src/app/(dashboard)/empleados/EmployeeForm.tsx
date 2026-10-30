"use client";
// Formulario de alta y edición manual de empleados, con los campos de
// personal real: sucursal de contrato y donde trabaja, puesto secundario, DT,
// rotativo, horas semanales y tareas adicionales.
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { positionKeyOf } from "@/lib/personal/catalog";

const formSchema = z.object({
  firstName:           z.string().min(1, "Nombre obligatorio"),
  lastName:            z.string().min(1, "Apellido obligatorio"),
  positionId:          z.string().min(1, "Puesto obligatorio"),
  secondaryPositionId: z.string().optional(),
  contractBranchId:    z.string().min(1, "Sucursal de contrato obligatoria"),
  currentBranchId:     z.string().optional(),
  isTechnicalDirector: z.boolean().default(false),
  isRotating:          z.boolean().default(false),
  weeklyHours:         z.string().optional()
    .refine((s) => !s || (/^\d{1,2}([.,]\d)?$/.test(s.trim())), "Horas: número entre 0 y 99,9"),
  extraTasks:          z.string().optional(),
  hireDate:            z.string().optional(),
  workScheduleNotes:   z.string().optional(),
  notes:               z.string().optional(),
}).refine((d) => !d.secondaryPositionId || d.secondaryPositionId !== d.positionId, {
  path: ["secondaryPositionId"], message: "Tiene que ser distinto del principal",
});
type FormValues = z.infer<typeof formSchema>;

export interface EmployeeFormInitial {
  id: string;
  firstName: string;
  lastName: string;
  positionId: string | null;
  secondaryPositionId: string | null;
  contractBranchId: string | null;
  currentBranchId: string | null;
  isTechnicalDirector: boolean;
  isRotating: boolean;
  weeklyHours: number | null;
  extraTasks: string | null;
  hireDate: string | null;
  workScheduleNotes: string | null;
  notes: string | null;
}

/** Puestos del catálogo; si todavía no hay ninguno (antes de la carga), todos. Conserva el actual. */
function selectablePositions(positions: any[], keepIds: Array<string | null | undefined>) {
  const catalog = positions.filter((p) => positionKeyOf(p.name) !== null);
  if (catalog.length === 0) return positions;
  return positions.filter((p) => positionKeyOf(p.name) !== null || keepIds.includes(p.id));
}

export default function EmployeeForm({ initial, branches, positions, lockBranchId, onDone, onCancel }: {
  /** Sin initial = alta. */
  initial?: EmployeeFormInitial;
  branches: any[];
  positions: any[];
  /** Encargado/a: la sucursal donde trabaja queda fija en la suya. */
  lockBranchId?: string | null;
  onDone: (json: any) => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName:           initial?.firstName ?? "",
      lastName:            initial?.lastName ?? "",
      positionId:          initial?.positionId ?? "",
      secondaryPositionId: initial?.secondaryPositionId ?? "",
      contractBranchId:    initial?.contractBranchId ?? lockBranchId ?? "",
      currentBranchId:     initial?.currentBranchId ?? lockBranchId ?? "",
      isTechnicalDirector: initial?.isTechnicalDirector ?? false,
      isRotating:          initial?.isRotating ?? false,
      weeklyHours:         initial?.weeklyHours != null ? String(initial.weeklyHours) : "",
      extraTasks:          initial?.extraTasks ?? "",
      hireDate:            initial?.hireDate ? initial.hireDate.slice(0, 10) : "",
      workScheduleNotes:   initial?.workScheduleNotes ?? "",
      notes:               initial?.notes ?? "",
    },
  });

  const mut = useMutation({
    mutationFn: async (d: FormValues) => {
      const body = {
        firstName:           d.firstName.trim(),
        lastName:            d.lastName.trim(),
        positionId:          d.positionId,
        secondaryPositionId: d.secondaryPositionId || null,
        contractBranchId:    d.contractBranchId,
        isTechnicalDirector: d.isTechnicalDirector,
        isRotating:          d.isRotating,
        weeklyHours:         d.weeklyHours?.trim() ? Number(d.weeklyHours.trim().replace(",", ".")) : null,
        extraTasks:          d.extraTasks?.trim() || null,
        hireDate:            d.hireDate || null,
        workScheduleNotes:   d.workScheduleNotes?.trim() || null,
        notes:               d.notes?.trim() || null,
        // Encargado/a no cambia la sucursal donde trabaja (queda la suya).
        ...(lockBranchId ? (isEdit ? {} : { currentBranchId: lockBranchId }) : { currentBranchId: d.currentBranchId || null }),
      };
      const res = await fetch(isEdit ? `/api/employees/${initial!.id}` : "/api/employees", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? (isEdit ? "Error al guardar" : "Error al crear empleado"));
      return json;
    },
    onSuccess: onDone,
  });

  const posOptions = selectablePositions(positions, [initial?.positionId, initial?.secondaryPositionId]);

  return (
    <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Apellido *</label>
          <input {...register("lastName")} className={cn("input", errors.lastName && "input-error")} placeholder="Apellido" />
          {errors.lastName && <p className="error-msg">{errors.lastName.message}</p>}
        </div>
        <div>
          <label className="label">Nombre *</label>
          <input {...register("firstName")} className={cn("input", errors.firstName && "input-error")} placeholder="Nombre" />
          {errors.firstName && <p className="error-msg">{errors.firstName.message}</p>}
        </div>
        <div>
          <label className="label">Puesto *</label>
          <select {...register("positionId")} className={cn("input", errors.positionId && "input-error")}>
            <option value="">Seleccioná un puesto</option>
            {posOptions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.positionId && <p className="error-msg">{errors.positionId.message}</p>}
        </div>
        <div>
          <label className="label">Puesto secundario</label>
          <select {...register("secondaryPositionId")} className={cn("input", errors.secondaryPositionId && "input-error")}>
            <option value="">Ninguno</option>
            {posOptions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.secondaryPositionId && <p className="error-msg">{errors.secondaryPositionId.message}</p>}
        </div>
        <div>
          <label className="label">Sucursal de contrato *</label>
          <select {...register("contractBranchId")} className={cn("input", errors.contractBranchId && "input-error")}>
            <option value="">Seleccioná una sucursal</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {errors.contractBranchId && <p className="error-msg">{errors.contractBranchId.message}</p>}
        </div>
        <div>
          <label className="label">Sucursal donde trabaja</label>
          <select {...register("currentBranchId")} className="input" disabled={!!lockBranchId}>
            <option value="">Sin sucursal fija</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Horas semanales</label>
          <input {...register("weeklyHours")} inputMode="decimal" className={cn("input", errors.weeklyHours && "input-error")} placeholder="Ej: 45" />
          {errors.weeklyHours && <p className="error-msg">{errors.weeklyHours.message}</p>}
        </div>
        <div>
          <label className="label">Fecha de ingreso</label>
          <input type="date" {...register("hireDate")} className="input" />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" {...register("isTechnicalDirector")} id="empDT" className="rounded" />
          <label htmlFor="empDT" className="text-sm text-gray-600 cursor-pointer">Director/a técnico/a (DT)</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" {...register("isRotating")} id="empRot" className="rounded" />
          <label htmlFor="empRot" className="text-sm text-gray-600 cursor-pointer">Personal rotativo</label>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Tareas adicionales</label>
          <input {...register("extraTasks")} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Horario habitual (texto)</label>
          <input {...register("workScheduleNotes")} className="input" placeholder="Ej: Lunes a viernes, turno mañana" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Observaciones</label>
          <textarea {...register("notes")} rows={2} className="input resize-none" />
        </div>
      </div>
      {mut.isError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{(mut.error as Error).message}</p>
      )}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
        <button type="submit" disabled={mut.isPending} className="btn-primary">
          {mut.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear empleado"}
        </button>
      </div>
    </form>
  );
}
