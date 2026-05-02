"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, KeyRound, CheckCircle2, XCircle, Copy } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["SUPERVISOR","OWNER","BRANCH_MANAGER","HR","MAINTENANCE","ADMIN"];

const editSchema = z.object({
  name:       z.string().min(2, "Nombre obligatorio"),
  email:      z.string().email("Email invalido"),
  role:       z.enum(["ADMIN","OWNER","SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"] as const),
  branchId:   z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
});
type EditForm = z.infer<typeof editSchema>;

export default function UsuarioDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);
  const [saveOk,      setSaveOk]      = useState(false);

  const { data: userData, isLoading } = useQuery({
    queryKey: ["admin-user", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${params.id}`);
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
  });

  const { data: empRes } = useQuery({
    queryKey: ["employees-all"],
    queryFn:  () => fetch("/api/employees?limit=200&active=any").then(r => r.json()),
  });

  const user      = userData?.data;
  const branches  = branchRes?.data ?? [];
  const employees = empRes?.data    ?? [];

  const { register, handleSubmit, watch, formState: { errors, isDirty, isSubmitting } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    values: user ? {
      name:       user.name,
      email:      user.email,
      role:       user.role,
      branchId:   user.branchId   ?? null,
      employeeId: user.employeeId ?? null,
    } : undefined,
  });

  const selectedRole = watch("role");
  const needsBranch  = selectedRole === "BRANCH_MANAGER";

  const saveMut = useMutation({
    mutationFn: async (data: EditForm) => {
      const res  = await fetch(`/api/admin/users/${params.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user", params.id] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    },
  });

  const toggleActive = async () => {
    await fetch(`/api/admin/users/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    qc.invalidateQueries({ queryKey: ["admin-user", params.id] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const resetPassword = async () => {
    const res  = await fetch(`/api/admin/users/${params.id}/reset-password`, { method: "POST" });
    const json = await res.json();
    if (res.ok) setResetResult(json.temporaryPassword);
  };

  const copyPassword = () => {
    if (resetResult) {
      navigator.clipboard.writeText(resetResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;
  if (!user)     return <div className="card p-10 text-center text-sm text-gray-400">Usuario no encontrado.</div>;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <Link href="/admin/usuarios"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4" />Usuarios
        </Link>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">{user.name}</h2>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", ROLE_COLORS[user.role as UserRole])}>
            {ROLE_LABELS[user.role as UserRole]}
          </span>
          {!user.active && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Inactivo</span>
          )}
        </div>
        <p className="text-sm text-gray-400 mt-0.5">{user.email}</p>
      </div>

      {/* Resultado de reset */}
      {resetResult && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-4">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-4 h-4 text-amber-600" />
            <p className="text-xs font-semibold text-amber-800">Contraseña temporal (visible una sola vez)</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-amber-900 tracking-wider select-all">
              {resetResult}
            </code>
            <button onClick={copyPassword}
              className={cn("btn-secondary text-xs py-2 px-3", copied && "text-green-700 border-green-300")}>
              {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-amber-600 mt-2">El usuario deberá cambiarla en su próximo ingreso.</p>
          <button onClick={() => setResetResult(null)} className="text-xs text-amber-500 underline mt-1">Cerrar</button>
        </div>
      )}

      {/* Formulario de edición */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Datos del usuario</h3>
        <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Nombre completo *</label>
              <input {...register("name")} className={cn("input", errors.name && "input-error")} />
              {errors.name && <p className="error-msg">{errors.name.message}</p>}
            </div>

            <div className="sm:col-span-2">
              <label className="label">Email *</label>
              <input {...register("email")} type="email" className={cn("input", errors.email && "input-error")} />
              {errors.email && <p className="error-msg">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Rol *</label>
              <select {...register("role")} className="input">
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Sucursal {needsBranch ? "*" : <span className="text-gray-400 font-normal">(opcional)</span>}</label>
              <select {...register("branchId")} className="input">
                <option value="">Sin sucursal</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="label">Empleado vinculado <span className="text-gray-400 font-normal">(opcional)</span></label>
              <select {...register("employeeId")} className="input">
                <option value="">Sin vincular</option>
                {employees.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} — {e.position?.name}
                    {e.currentBranch ? ` (${e.currentBranch.name})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {saveMut.isError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {(saveMut.error as Error).message}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            {saveOk && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />Guardado</span>}
            <button type="submit" disabled={!isDirty || isSubmitting} className="btn-primary disabled:opacity-50">
              {isSubmitting ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>

      {/* Acciones */}
      <div className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Acciones</h3>

        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <div>
            <p className="text-sm text-gray-700">Resetear contraseña</p>
            <p className="text-xs text-gray-400">Genera una contraseña temporal. El usuario deberá cambiarla.</p>
          </div>
          <button onClick={resetPassword} disabled={!user.active}
            className="btn-secondary text-sm text-amber-700 border-amber-300 hover:bg-amber-50 disabled:opacity-40">
            <KeyRound className="w-4 h-4" />Resetear
          </button>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm text-gray-700">
              {user.active ? "Desactivar usuario" : "Activar usuario"}
            </p>
            <p className="text-xs text-gray-400">
              {user.active
                ? "El usuario no podrá iniciar sesión. El historial se conserva."
                : "Permite al usuario volver a iniciar sesión."}
            </p>
          </div>
          <button onClick={toggleActive}
            className={cn("btn-secondary text-sm",
              user.active
                ? "text-red-600 border-red-300 hover:bg-red-50"
                : "text-green-700 border-green-300 hover:bg-green-50")}>
            {user.active
              ? <><XCircle className="w-4 h-4" />Desactivar</>
              : <><CheckCircle2 className="w-4 h-4" />Activar</>
            }
          </button>
        </div>
      </div>

      {/* Info vinculación a empleado */}
      {user.employee && (
        <div className="card p-4 bg-blue-50 border-blue-100">
          <p className="text-xs font-semibold text-blue-700 mb-1">Empleado vinculado</p>
          <p className="text-sm text-blue-900 font-medium">
            {user.employee.firstName} {user.employee.lastName}
          </p>
          <p className="text-xs text-blue-600">
            {user.employee.position?.name}
            {user.employee.currentBranch ? ` · ${user.employee.currentBranch.name}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

