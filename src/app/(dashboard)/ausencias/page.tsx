"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, UserMinus, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, RotateCcw, Users, Info,
} from "lucide-react";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

function ClockIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

// Catálogo completo de labels. Se usa solo para mostrar registros históricos
// (incluido LATE_NOTICE que ya no se carga desde la UI nueva).
const ABSENCE_TYPES = [
  { value: "SICKNESS",        label: "Enfermedad" },
  { value: "PERSONAL_REASON", label: "Razon personal" },
  { value: "NO_SHOW",         label: "No se presento" },
  { value: "LATE_NOTICE",     label: "Aviso tarde" },
  { value: "LATE_ARRIVAL",    label: "Llegó tarde" },
  { value: "MEDICAL_LEAVE",   label: "Licencia medica" },
  { value: "SPECIAL_LEAVE",   label: "Licencia especial" },
  { value: "SUSPENSION",      label: "Suspension disciplinaria" },
  { value: "OTHER",           label: "Otro" },
];

// Tipos visibles en el formulario de Ausencia / licencia. Se excluye
// LATE_ARRIVAL (tiene flujo dedicado) y LATE_NOTICE (deprecado en la UI).
const ABSENCE_FORM_TYPES = ABSENCE_TYPES.filter(
  t => t.value !== "LATE_NOTICE" && t.value !== "LATE_ARRIVAL"
);

// Combina una fecha (YYYY-MM-DD) con una hora (HH:mm) en un Date local
function combineDateAndTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(dateStr);
  d.setHours(h, m, 0, 0);
  return d;
}

function diffMinutes(expectedTime: string, actualTime: string): number | null {
  if (!expectedTime || !actualTime) return null;
  const [eh, em] = expectedTime.split(":").map(Number);
  const [ah, am] = actualTime.split(":").map(Number);
  if (isNaN(eh) || isNaN(em) || isNaN(ah) || isNaN(am)) return null;
  return (ah * 60 + am) - (eh * 60 + em);
}

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  REPORTED:     { label: "Reportada",     color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: ClockIcon },
  JUSTIFIED:    { label: "Justificada",   color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  UNJUSTIFIED:  { label: "Injustificada", color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
  UNDER_REVIEW: { label: "En revision",   color: "bg-blue-50 text-blue-800 border-blue-200",      icon: ClockIcon },
  CLOSED:       { label: "Cerrada",       color: "bg-gray-50 text-gray-600 border-gray-200",      icon: CheckCircle2 },
};

const todayStr = new Date().toISOString().split("T")[0];

const baseSchema = {
  startDate:           z.string().min(1, "Obligatoria"),
  endDate:             z.string().min(1, "Obligatoria"),
  absenceType:         z.string().min(1, "Obligatorio"),
  notes:               z.string().optional(),
  reasonDetail:        z.string().optional(),
  hasCertificate:      z.boolean().default(false),
  certificateUntil:    z.string().optional(),
  notifiedAt:          z.string().optional(),
  // Solo completos cuando absenceType === LATE_ARRIVAL
  expectedArrivalTime: z.string().optional(),
  actualArrivalTime:   z.string().optional(),
};

const fixedSchema = z.object({
  ...baseSchema,
  branchId:   z.string().min(1, "Selecciona una sucursal"),
  employeeId: z.string().min(1, "Selecciona un empleado"),
  branchDetectedFromAssignment: z.literal(false).default(false),
});

const rotatingSchema = z.object({
  ...baseSchema,
  employeeId: z.string().min(1, "Selecciona una rotativa"),
  branchId:   z.string().min(1, "Indica la sucursal impactada"),
  branchDetectedFromAssignment: z.boolean().default(false),
});

type FixedForm    = z.infer<typeof fixedSchema>;
type RotatingForm = z.infer<typeof rotatingSchema>;

export default function AusenciasPage() {
  const { data: session, status } = useSession();
  const qc   = useQueryClient();
  const role = session?.user?.role as UserRole;
  const userBranchId = session?.user?.branchId;

  const [showForm,    setShowForm]    = useState(false);
  // Tipo de evento que se está cargando. null = aún no eligió en el chooser.
  const [flow,        setFlow]        = useState<"absence"|"lateness"|null>(null);
  const [formMode,    setFormMode]    = useState<"fixed"|"rotating">("fixed");
  const [branchFilter,setBranchFilter]= useState("");
  const [statusFilter,setStatusFilter]= useState("");
  const [activeOnly,  setActiveOnly]  = useState(false);
  const [alert,       setAlert]       = useState<string | null>(null);

  // Estado del formulario fijo
  const [formBranchId,  setFormBranchId]  = useState(role === "BRANCH_MANAGER" ? (userBranchId ?? "") : "");
  const [formDate,      setFormDate]      = useState(todayStr);

  // Estado del formulario rotativo
  const [selectedRotId,   setSelectedRotId]   = useState("");
  const [rotStartDate,    setRotStartDate]     = useState(todayStr);
  const [rotEndDate,      setRotEndDate]       = useState(todayStr);
  const [suggestedBranch, setSuggestedBranch]  = useState<{id:string;name:string;fromAssignment:boolean}|null>(null);
  const [overrideBranch,  setOverrideBranch]   = useState(false);

  const sessionReady    = status === "authenticated";
  const canCreate       = role ? can.createAbsence(role) : false;
  const canJustify      = role ? can.justifyAbsence(role) : false;
  const isBranchManager = role === "BRANCH_MANAGER";

  // Lista de ausencias
  const { data: absData, isLoading } = useQuery({
    queryKey: ["absences", { branchFilter, statusFilter, activeOnly }],
    queryFn: async () => {
      const p = new URLSearchParams({
        limit: "50",
        ...(isBranchManager && userBranchId ? { branchId: userBranchId }
          : branchFilter ? { branchId: branchFilter } : {}),
        ...(statusFilter && { status: statusFilter }),
        ...(activeOnly   && { activeOnly: "true" }),
      });
      const res = await fetch(`/api/absences?${p}`);
      if (!res.ok) throw new Error("Error al cargar ausencias");
      return res.json();
    },
    enabled: sessionReady,
  });

  // Sucursales
  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
    enabled:  sessionReady,
  });

  // PLANTEL REAL del día para el formulario fijo
  // Se recalcula cuando cambia la sucursal o la fecha seleccionada
  const { data: plantillaRes, isLoading: plantillaLoading } = useQuery({
    queryKey: ["plantilla", formBranchId, formDate],
    queryFn: async () => {
      if (!formBranchId) return null;
      const p = new URLSearchParams({ plantilla: "true", branchId: formBranchId, date: formDate });
      const res = await fetch(`/api/employees?${p}`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: sessionReady && formMode === "fixed" && !!formBranchId,
  });

  // Rotativos para el flujo rotativo
  const { data: rotRes } = useQuery({
    queryKey: ["rotativos"],
    queryFn:  () => fetch("/api/employees?isRotating=true&limit=50").then(r => r.json()),
    enabled:  sessionReady && formMode === "rotating",
  });

  // Detección de asignación activa del rotativo
  const { data: activeAssignRes, isLoading: detectingAssign } = useQuery({
    queryKey: ["active-assignments", selectedRotId, rotStartDate, rotEndDate],
    queryFn: async () => {
      if (!selectedRotId) return null;
      const p = new URLSearchParams({ startDate: rotStartDate, endDate: rotEndDate });
      const res = await fetch(`/api/employees/${selectedRotId}/active-assignments?${p}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: sessionReady && formMode === "rotating" && !!selectedRotId,
  });

  const branches  = branchRes?.data   ?? [];
  const fijos     = plantillaRes?.fijos    ?? [];
  const rotativos = plantillaRes?.rotativos ?? [];
  const allRotativos = rotRes?.data ?? [];
  const absences  = absData?.data    ?? [];
  const total     = absData?.meta?.total ?? 0;

  const suggestedFromAPI = activeAssignRes?.suggested;

  const fixedForm = useForm<FixedForm>({
    resolver: zodResolver(fixedSchema),
    defaultValues: {
      startDate: todayStr, endDate: todayStr,
      branchId: isBranchManager ? (userBranchId ?? "") : "",
    },
  });
  const rotForm = useForm<RotatingForm>({
    resolver: zodResolver(rotatingSchema),
    defaultValues: { startDate: todayStr, endDate: todayStr, branchDetectedFromAssignment: false },
  });

  const handleBranchChange = (bid: string) => {
    setFormBranchId(bid);
    fixedForm.setValue("branchId", bid);
    fixedForm.setValue("employeeId", "");
  };

  const handleFormDateChange = (value: string) => {
    setFormDate(value);
    fixedForm.setValue("startDate", value);
    fixedForm.setValue("endDate", value);
    fixedForm.setValue("employeeId", "");
  };

  const handleRotChange = (empId: string) => {
    setSelectedRotId(empId);
    rotForm.setValue("employeeId", empId);
    rotForm.setValue("branchId", "");
    setSuggestedBranch(null);
    setOverrideBranch(false);
  };

  const applySuggestion = () => {
    if (suggestedFromAPI) {
      rotForm.setValue("branchId", suggestedFromAPI.branchId);
      rotForm.setValue("branchDetectedFromAssignment", true);
      setSuggestedBranch({ id: suggestedFromAPI.branchId, name: suggestedFromAPI.branchName, fromAssignment: true });
      setOverrideBranch(false);
    }
  };

  const createMut = useMutation({
    mutationFn: async (data: FixedForm | RotatingForm) => {
      // Si es LATE_ARRIVAL, combinar startDate + horas en ISO timestamps
      const payload: any = { ...data };
      if (data.absenceType === "LATE_ARRIVAL") {
        const expectedDt = combineDateAndTime(data.startDate, data.expectedArrivalTime ?? "");
        const actualDt   = combineDateAndTime(data.startDate, data.actualArrivalTime ?? "");
        if (!expectedDt || !actualDt) {
          throw new Error("Llegó tarde requiere hora esperada y hora real");
        }
        if (actualDt <= expectedDt) {
          throw new Error("La hora real debe ser posterior a la hora esperada");
        }
        payload.expectedArrivalTime = expectedDt.toISOString();
        payload.actualArrivalTime   = actualDt.toISOString();
      } else {
        delete payload.expectedArrivalTime;
        delete payload.actualArrivalTime;
      }
      const res = await fetch("/api/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      return json;
    },
    onSuccess: (json) => {
      qc.invalidateQueries({ queryKey: ["absences"] });
      qc.invalidateQueries({ queryKey: ["plantilla"] });
      if (json.alert) setAlert(json.alert);
      fixedForm.reset({ startDate: todayStr, endDate: todayStr, branchId: isBranchManager ? (userBranchId ?? "") : "" });
      rotForm.reset({ startDate: todayStr, endDate: todayStr, branchDetectedFromAssignment: false });
      setFormBranchId(isBranchManager ? (userBranchId ?? "") : "");
      setFormDate(todayStr);
      setSelectedRotId(""); setSuggestedBranch(null); setOverrideBranch(false);
      setShowForm(false);
      setFlow(null);
    },
  });

  // Sincroniza valores derivados del flujo elegido para que pasen la validación
  // de Zod sin que el usuario tenga que tipearlos.
  //
  //   lateness → absenceType = LATE_ARRIVAL, endDate = startDate
  //   absence  → absenceType vacío para que el usuario lo elija
  //
  // Cambios posteriores de startDate dentro de lateness ya se sincronizan por
  // los onChange de los inputs de fecha (handleFormDateChange y el del rotativo).
  useEffect(() => {
    if (flow === "lateness") {
      const fixedStart = fixedForm.getValues("startDate") || todayStr;
      const rotStart   = rotForm.getValues("startDate")   || todayStr;
      fixedForm.setValue("absenceType", "LATE_ARRIVAL", { shouldValidate: false });
      fixedForm.setValue("endDate",     fixedStart,     { shouldValidate: false });
      rotForm.setValue("absenceType",   "LATE_ARRIVAL", { shouldValidate: false });
      rotForm.setValue("endDate",       rotStart,       { shouldValidate: false });
    } else if (flow === "absence") {
      fixedForm.setValue("absenceType", "", { shouldValidate: false });
      rotForm.setValue("absenceType",   "", { shouldValidate: false });
    }
    // flow === null: no tocar — el panel muestra el chooser
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const updateStatus = async (id: string, newStatus: string) => {
    await fetch(`/api/absences/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    qc.invalidateQueries({ queryKey: ["absences"] });
  };

  if (status === "loading") {
    return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Ausencias y licencias</h2>
          <p className="text-sm text-gray-500 mt-0.5">{total} registros</p>
        </div>
        {canCreate && (
          <button
            onClick={() => {
              setShowForm(v => {
                const next = !v;
                if (next) setFlow(null);
                return next;
              });
            }}
            className="btn-primary">
            <Plus className="w-4 h-4" />Registrar evento
          </button>
        )}
      </div>

      {alert && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 flex-1">{alert}</p>
          <button onClick={() => setAlert(null)} className="text-red-400 text-lg leading-none">×</button>
        </div>
      )}

      {/* Formulario */}
      {showForm && (
        <div className="card p-5">
          {/* Paso 1 — Chooser de tipo de evento */}
          {flow === null && (
            <div className="space-y-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">¿Qué necesitás registrar?</h3>
                <p className="text-xs text-gray-500 mt-0.5">Elegí el tipo de evento.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFlow("absence")}
                  className="text-left rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 active:bg-blue-50 transition-colors p-4 group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="rounded-lg bg-blue-50 group-hover:bg-blue-100 p-2">
                      <UserMinus className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">Ausencia / licencia</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug">
                    El empleado no asistió al turno o estará ausente por un período.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setFlow("lateness")}
                  className="text-left rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50/40 active:bg-orange-50 transition-colors p-4 group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="rounded-lg bg-orange-50 group-hover:bg-orange-100 p-2">
                      <ClockIcon className="w-5 h-5 text-orange-600" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">Llegada tarde</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug">
                    El empleado asistió, pero llegó después del horario esperado.
                  </p>
                </button>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Paso 2 — Header del flujo elegido + tabs fijo/rotativa */}
          {flow !== null && (
          <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setFlow(null)}
                className="text-xs text-gray-500 hover:text-gray-800 underline"
                aria-label="Cambiar tipo de evento">
                ← Cambiar
              </button>
              <h3 className="text-sm font-semibold text-gray-900">
                {flow === "absence" ? "Ausencia / licencia" : "Llegada tarde"}
              </h3>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
            <button type="button" onClick={() => setFormMode("fixed")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                formMode === "fixed" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
              <Users className="w-4 h-4" />Empleado fijo
            </button>
            <button type="button" onClick={() => setFormMode("rotating")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                formMode === "rotating" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
              <RotateCcw className="w-4 h-4" />Rotativa
            </button>
          </div>

          {/* FLUJO FIJO */}
          {formMode === "fixed" && (
            <form
              onSubmit={fixedForm.handleSubmit(d => {
                if (flow === "lateness") {
                  d.absenceType = "LATE_ARRIVAL";
                  d.endDate = d.startDate;
                }
                createMut.mutate(d);
              })}
              className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                {/* Sucursal */}
                {!isBranchManager ? (
                  <div>
                    <label className="label">Sucursal *</label>
                    <select
                      className={cn("input", fixedForm.formState.errors.branchId && "input-error")}
                      value={formBranchId}
                      onChange={e => handleBranchChange(e.target.value)}>
                      <option value="">Selecciona sucursal</option>
                      {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {fixedForm.formState.errors.branchId && (
                      <p className="error-msg">{fixedForm.formState.errors.branchId.message}</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="label">Sucursal</label>
                    <input className="input bg-gray-50 text-gray-500" disabled
                      value={branches.find((b: any) => b.id === userBranchId)?.name ?? "Tu sucursal"} />
                    <input type="hidden" {...fixedForm.register("branchId")} value={userBranchId ?? ""} />
                  </div>
                )}

                {/* Fecha — determina qué rotativos aparecen */}
                <div>
                  <label className="label">
                    {flow === "lateness" ? "Fecha *" : "Fecha de ausencia *"}
                  </label>
                  <input type="date"
                    value={formDate}
                    onChange={e => handleFormDateChange(e.target.value)}
                    className="input" />
                  <p className="text-xs text-gray-400 mt-0.5">
                    Determina qué rotativas están asignadas ese día.
                  </p>
                </div>

                {/* Selector de empleado — plantel real del día */}
                <div className="sm:col-span-2">
                  <label className="label">
                    Empleado *
                    {plantillaLoading && <span className="ml-1 text-xs text-gray-400">(cargando plantel...)</span>}
                  </label>
                  <select
                    {...fixedForm.register("employeeId")}
                    className={cn("input", fixedForm.formState.errors.employeeId && "input-error")}
                    disabled={!formBranchId || plantillaLoading}>
                    <option value="">
                      {!formBranchId ? "Primero selecciona una sucursal"
                        : plantillaLoading ? "Cargando plantel del dia..."
                        : (fijos.length === 0 && rotativos.length === 0) ? "Sin empleados en esta sucursal"
                        : "Selecciona empleado"}
                    </option>

                    {/* Grupo: Fijos */}
                    {fijos.length > 0 && (
                      <optgroup label={`— Fijos (${fijos.length})`}>
                        {fijos.map((e: any) => (
                          <option key={e.id} value={e.id}>
                            {e.firstName} {e.lastName} — {e.position?.name}
                            {e.statusHoy !== "ACTIVE" ? ` (${e.statusHoy === "ON_LEAVE" ? "licencia" : "ausente"})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}

                    {/* Grupo: Rotativas asignadas hoy */}
                    {rotativos.length > 0 && (
                      <optgroup label={`— Rotativas asignadas hoy (${rotativos.length})`}>
                        {rotativos.map((e: any) => (
                          <option key={e.id} value={e.id}>
                            {e.firstName} {e.lastName} — {e.position?.name}
                            {e.zone ? ` (${e.zone})` : ""}
                            {e.statusHoy !== "ACTIVE" ? ` (${e.statusHoy === "ON_LEAVE" ? "licencia" : "ausente"})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {fixedForm.formState.errors.employeeId && (
                    <p className="error-msg">{fixedForm.formState.errors.employeeId.message}</p>
                  )}
                  {formBranchId && !plantillaLoading && fijos.length === 0 && rotativos.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      No hay empleados en el plantel de esta sucursal para la fecha seleccionada.
                    </p>
                  )}
                  {rotativos.length > 0 && (
                    <p className="text-xs text-blue-600 mt-1">
                      {rotativos.length} rotativa{rotativos.length > 1 ? "s" : ""} asignada{rotativos.length > 1 ? "s" : ""} a esta sucursal hoy.
                    </p>
                  )}
                </div>

                {/* Fecha fin — solo para Ausencia / licencia */}
                {flow === "absence" && (
                  <div>
                    <label className="label">Fecha fin *</label>
                    <input type="date" {...fixedForm.register("endDate")}
                      className={cn("input", fixedForm.formState.errors.endDate && "input-error")} />
                    <p className="text-xs text-gray-400 mt-0.5">Igual al inicio si es un día. Rango si es licencia.</p>
                  </div>
                )}

                {/* Selector de tipo — solo para Ausencia / licencia */}
                {flow === "absence" && (
                  <div>
                    <label className="label">Tipo *</label>
                    <select {...fixedForm.register("absenceType")} className="input">
                      <option value="">Selecciona tipo</option>
                      {ABSENCE_FORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="label">{flow === "lateness" ? "Motivo / observación" : "Motivo / detalle"}</label>
                  <input {...fixedForm.register("reasonDetail")} className="input" placeholder="Opcional..." />
                </div>

                {/* Campos LATE_ARRIVAL — siempre visibles en flujo lateness */}
                {flow === "lateness" && (
                  <LateArrivalFields form={fixedForm} />
                )}

                <div>
                  <label className="label">Hora de aviso{flow === "lateness" ? " (opcional)" : ""}</label>
                  <input type="datetime-local" {...fixedForm.register("notifiedAt")} className="input" />
                </div>

                <div className="sm:col-span-2">
                  <label className="label">Observaciones</label>
                  <textarea {...fixedForm.register("notes")} rows={2} className="input resize-none" />
                </div>

                {/* Certificado — atributo opcional de Ausencia / licencia */}
                {flow === "absence" && (
                  <>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" {...fixedForm.register("hasCertificate")} id="cert-f" className="rounded" />
                      <label htmlFor="cert-f" className="text-sm text-gray-600 cursor-pointer">Tiene certificado</label>
                    </div>
                    {fixedForm.watch("hasCertificate") && (
                      <div>
                        <label className="label">Certificado hasta</label>
                        <input type="date" {...fixedForm.register("certificateUntil")} className="input" />
                      </div>
                    )}
                  </>
                )}
              </div>

              {createMut.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {(createMut.error as Error).message}
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <button type="button"
                  onClick={() => { setShowForm(false); setFlow(null); fixedForm.reset({ startDate: todayStr, endDate: todayStr }); setFormBranchId(""); setFormDate(todayStr); }}
                  className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={createMut.isPending} className="btn-primary">
                  {createMut.isPending ? "Guardando..." : "Registrar"}
                </button>
              </div>
            </form>
          )}

          {/* FLUJO ROTATIVO */}
          {formMode === "rotating" && (
            <form
              onSubmit={rotForm.handleSubmit(d => {
                if (flow === "lateness") {
                  d.absenceType = "LATE_ARRIVAL";
                  d.endDate = d.startDate;
                }
                createMut.mutate(d);
              })}
              className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Rotativa *</label>
                  <select
                    className={cn("input", rotForm.formState.errors.employeeId && "input-error")}
                    value={selectedRotId}
                    onChange={e => handleRotChange(e.target.value)}>
                    <option value="">Selecciona una rotativa</option>
                    {allRotativos.map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}{e.zone ? ` (${e.zone})` : ""}
                      </option>
                    ))}
                  </select>
                  {rotForm.formState.errors.employeeId && (
                    <p className="error-msg">{rotForm.formState.errors.employeeId.message}</p>
                  )}
                </div>

                <div>
                  <label className="label">{flow === "lateness" ? "Fecha *" : "Fecha inicio *"}</label>
                  <input type="date" value={rotStartDate}
                    onChange={e => {
                      setRotStartDate(e.target.value);
                      rotForm.setValue("startDate", e.target.value);
                      // En lateness, sincronizar endDate con startDate
                      if (flow === "lateness") {
                        setRotEndDate(e.target.value);
                        rotForm.setValue("endDate", e.target.value);
                      }
                    }}
                    className="input" />
                </div>
                {flow === "absence" && (
                  <div>
                    <label className="label">Fecha fin *</label>
                    <input type="date" value={rotEndDate}
                      onChange={e => { setRotEndDate(e.target.value); rotForm.setValue("endDate", e.target.value); }}
                      className="input" />
                  </div>
                )}

                {/* Sucursal impactada con detección automática */}
                <div className="sm:col-span-2">
                  <label className="label">Sucursal impactada *</label>

                  {selectedRotId && !detectingAssign && suggestedFromAPI && !overrideBranch && (
                    <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 mb-2">
                      <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-blue-800 font-medium">
                          Asignacion detectada: <strong>{suggestedFromAPI.branchName}</strong>
                        </p>
                        <p className="text-xs text-blue-600 mt-0.5">Tiene asignacion activa en ese período.</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button type="button" onClick={applySuggestion}
                          className="btn-secondary text-xs py-1 px-2.5 text-blue-700 border-blue-300">
                          Confirmar
                        </button>
                        <button type="button" onClick={() => setOverrideBranch(true)}
                          className="btn-secondary text-xs py-1 px-2.5">Cambiar</button>
                      </div>
                    </div>
                  )}

                  {selectedRotId && !detectingAssign && !suggestedFromAPI && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-800">Sin asignacion detectada. Selecciona la sucursal manualmente.</p>
                    </div>
                  )}

                  {detectingAssign && selectedRotId && (
                    <p className="text-xs text-gray-400 mb-2">Buscando asignacion activa...</p>
                  )}

                  {rotForm.watch("branchId") && !overrideBranch && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        {branches.find((b: any) => b.id === rotForm.watch("branchId"))?.name}
                      </span>
                      {rotForm.watch("branchDetectedFromAssignment") && (
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                          Detectada automaticamente
                        </span>
                      )}
                      <button type="button"
                        onClick={() => { setOverrideBranch(true); rotForm.setValue("branchDetectedFromAssignment", false); }}
                        className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">Cambiar</button>
                    </div>
                  )}

                  {(!rotForm.watch("branchId") || overrideBranch) && (
                    <select
                      className={cn("input", rotForm.formState.errors.branchId && "input-error")}
                      onChange={e => { rotForm.setValue("branchId", e.target.value); rotForm.setValue("branchDetectedFromAssignment", false); setOverrideBranch(false); }}>
                      <option value="">Selecciona sucursal impactada</option>
                      {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  )}
                  {rotForm.formState.errors.branchId && (
                    <p className="error-msg">{rotForm.formState.errors.branchId.message}</p>
                  )}
                </div>

                {/* Selector de tipo — solo para Ausencia / licencia */}
                {flow === "absence" && (
                  <div>
                    <label className="label">Tipo *</label>
                    <select {...rotForm.register("absenceType")} className="input">
                      <option value="">Selecciona tipo</option>
                      {ABSENCE_FORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="label">{flow === "lateness" ? "Motivo / observación" : "Motivo"}</label>
                  <input {...rotForm.register("reasonDetail")} className="input" placeholder="Opcional..." />
                </div>

                {/* Campos LATE_ARRIVAL — siempre visibles en flujo lateness */}
                {flow === "lateness" && (
                  <LateArrivalFields form={rotForm} />
                )}

                {flow === "lateness" && (
                  <div>
                    <label className="label">Hora de aviso (opcional)</label>
                    <input type="datetime-local" {...rotForm.register("notifiedAt")} className="input" />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="label">Observaciones</label>
                  <textarea {...rotForm.register("notes")} rows={2} className="input resize-none" />
                </div>

                {/* Certificado — atributo opcional de Ausencia / licencia */}
                {flow === "absence" && (
                  <>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" {...rotForm.register("hasCertificate")} id="cert-r" className="rounded" />
                      <label htmlFor="cert-r" className="text-sm text-gray-600 cursor-pointer">Tiene certificado</label>
                    </div>
                    {rotForm.watch("hasCertificate") && (
                      <div>
                        <label className="label">Certificado hasta</label>
                        <input type="date" {...rotForm.register("certificateUntil")} className="input" />
                      </div>
                    )}
                  </>
                )}
              </div>

              {createMut.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {(createMut.error as Error).message}
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <button type="button"
                  onClick={() => { setShowForm(false); setFlow(null); rotForm.reset({ startDate: todayStr, endDate: todayStr }); setSelectedRotId(""); setSuggestedBranch(null); setOverrideBranch(false); }}
                  className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={createMut.isPending} className="btn-primary">
                  {createMut.isPending ? "Guardando..." : "Registrar"}
                </button>
              </div>
            </form>
          )}
          </>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {!isBranchManager && (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto">
            <option value="">Todas las sucursales</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="rounded" />
          Solo activas hoy
        </label>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />)}</div>
      ) : absences.length === 0 ? (
        <div className="card p-10 text-center">
          <UserMinus className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No hay ausencias con los filtros aplicados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {absences.map((a: any) => (
            <AbsenceCard key={a.id} absence={a} canJustify={canJustify} onUpdate={updateStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function AbsenceCard({ absence: a, canJustify, onUpdate }: {
  absence: any; canJustify: boolean;
  onUpdate: (id: string, status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[a.status] ?? STATUS_META.REPORTED;
  const SI   = meta.icon;

  const start = new Date(a.startDate);
  const end   = new Date(a.endDate);
  const isSameDay = start.toDateString() === end.toDateString();
  const fmt = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });

  return (
    <div className={cn("card overflow-hidden",
      a.isActiveToday && "border-red-200",
      a.absenceType === "SUSPENSION" && "border-orange-200")}>
      <div className="px-4 py-3 cursor-pointer flex items-start gap-3" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {a.employee.firstName} {a.employee.lastName}
            </p>
            {a.employee.isRotating && (
              <span className="inline-flex items-center gap-1 text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded font-medium">
                <RotateCcw className="w-2.5 h-2.5" />Rotativa
              </span>
            )}
            <span className="text-xs text-gray-500">{a.employee.position?.name}</span>
            {a.isActiveToday && <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Hoy</span>}
            {a.absenceType === "SUSPENSION" && <span className="text-xs font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">Suspension</span>}
            {a.employee.position?.requiresCoverage && <span className="text-xs font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">critico</span>}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-gray-500">
            <span>{isSameDay ? fmt(start) : `${fmt(start)} → ${fmt(end)} (${a.totalDays}d)`}</span>
            <span>·</span><span>{a.branch?.name}</span>
            {a.branchDetectedFromAssignment && (
              <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded">asignacion detectada</span>
            )}
            <span>·</span>
            <span>{ABSENCE_TYPES.find(t => t.value === a.absenceType)?.label ?? a.absenceType}</span>
            {a.hasCertificate && <span className="text-blue-600 font-medium">Con certificado</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
            <SI className="w-3 h-3" />{meta.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 bg-gray-50/50">
          {a.absenceType === "LATE_ARRIVAL" && (a.expectedArrivalTime || a.actualArrivalTime) && (
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
              {a.expectedArrivalTime && (
                <span className="text-gray-600">
                  Esperada:{" "}
                  <span className="font-medium text-gray-800">
                    {new Date(a.expectedArrivalTime).toLocaleTimeString("es-AR",
                      { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
              )}
              {a.actualArrivalTime && (
                <span className="text-gray-600">
                  Real:{" "}
                  <span className="font-medium text-gray-800">
                    {new Date(a.actualArrivalTime).toLocaleTimeString("es-AR",
                      { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
              )}
              {typeof a.lateMinutes === "number" && (
                <span className="font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">
                  {a.lateMinutes} min de demora
                </span>
              )}
            </div>
          )}
          {a.reasonDetail && <p className="text-xs text-gray-600 mb-1">Motivo: {a.reasonDetail}</p>}
          {a.notes && <p className="text-xs text-gray-600 italic mb-3">{a.notes}</p>}
          {canJustify && a.status !== "CLOSED" && (
            <div className="flex flex-wrap gap-2">
              {a.status !== "JUSTIFIED" && (
                <button onClick={() => onUpdate(a.id, "JUSTIFIED")}
                  className="btn-secondary text-xs py-1.5 px-3 text-green-700 border-green-300 hover:bg-green-50">
                  Justificar
                </button>
              )}
              {a.status !== "UNJUSTIFIED" && (
                <button onClick={() => onUpdate(a.id, "UNJUSTIFIED")}
                  className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-300 hover:bg-red-50">
                  Injustificada
                </button>
              )}
              {a.status !== "UNDER_REVIEW" && (
                <button onClick={() => onUpdate(a.id, "UNDER_REVIEW")}
                  className="btn-secondary text-xs py-1.5 px-3">En revision</button>
              )}
              <button onClick={() => onUpdate(a.id, "CLOSED")}
                className="btn-secondary text-xs py-1.5 px-3">Cerrar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LateArrivalFields({ form }: { form: any }) {
  const expected = form.watch("expectedArrivalTime") ?? "";
  const actual   = form.watch("actualArrivalTime") ?? "";
  const minutes  = diffMinutes(expected, actual);
  const valid    = minutes !== null && minutes > 0;
  const invalid  = expected && actual && minutes !== null && minutes <= 0;

  return (
    <>
      <div>
        <label className="label">Hora esperada *</label>
        <input
          type="time"
          {...form.register("expectedArrivalTime")}
          className={cn("input", invalid && "input-error")}
        />
      </div>
      <div>
        <label className="label">Hora real de llegada *</label>
        <input
          type="time"
          {...form.register("actualArrivalTime")}
          className={cn("input", invalid && "input-error")}
        />
      </div>
      <div className="sm:col-span-2">
        {valid && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
            <ClockIcon className="w-4 h-4 text-orange-600" />
            <span className="text-sm font-semibold text-orange-800">
              {minutes} {minutes === 1 ? "minuto" : "minutos"} de demora
            </span>
          </div>
        )}
        {invalid && (
          <p className="error-msg">La hora real debe ser posterior a la hora esperada.</p>
        )}
        {!expected && !actual && (
          <p className="text-xs text-gray-400">Cargá ambas horas para calcular la demora.</p>
        )}
      </div>
    </>
  );
}
