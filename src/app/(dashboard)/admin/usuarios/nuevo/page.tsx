"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, KeyRound, Copy, CheckCircle2 } from "lucide-react";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["SUPERVISOR","CO_SUPERVISOR","OWNER","BRANCH_MANAGER","HR","MAINTENANCE","ADMIN"];

const schema = z.object({
  name:       z.string().min(2, "Nombre obligatorio"),
  email:      z.string().email("Email invalido"),
  role:       z.enum(["ADMIN","OWNER","SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"] as const),
  branchId:   z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
});
type F = z.infer<typeof schema>;

export default function NuevoUsuarioPage() {
  const router = useRouter();
  const [error,         setError]         = useState("");
  const [createdResult, setCreatedResult] = useState<{name: string; email: string; password: string} | null>(null);
  const [copied,        setCopied]        = useState(false);

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
  });

  const { data: empRes } = useQuery({
    queryKey: ["employees-all"],
    queryFn:  () => fetch("/api/employees?limit=200&active=any").then(r => r.json()),
  });

  const branches  = branchRes?.data ?? [];
  const employees = empRes?.data    ?? [];

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<F>({
    resolver: zodResolver(schema),
    defaultValues: { role: "BRANCH_MANAGER" },
  });

  const selectedRole = watch("role");
  const needsBranch  = selectedRole === "BRANCH_MANAGER";

  async function onSubmit(data: F) {
    setError("");
    const res  = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Error al crear usuario");
      return;
    }
    setCreatedResult({
      name:     json.data.name,
      email:    json.data.email,
      password: json.initialPassword,
    });
  }

  const copyPassword = () => {
    if (createdResult) {
      navigator.clipboard.writeText(createdResult.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Pantalla de éxito con contraseña
  if (createdResult) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <div className="card p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Usuario creado</h2>
          <p className="text-sm text-gray-500 mb-4">{createdResult.name} · {createdResult.email}</p>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left mb-4">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-4 h-4 text-amber-600" />
              <p className="text-xs font-semibold text-amber-800">Contraseña inicial (visible una sola vez)</p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-amber-900 tracking-wider select-all">
                {createdResult.password}
              </code>
              <button onClick={copyPassword}
                className={cn("btn-secondary text-xs py-2 px-3 shrink-0",
                  copied && "text-green-700 border-green-300")}>
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-amber-600 mt-2">
              El usuario deberá cambiarla en su primer ingreso.
              Comunícasela por un canal seguro.
            </p>
          </div>

          <div className="flex gap-2 justify-center">
            <button onClick={() => setCreatedResult(null)} className="btn-secondary text-sm">
              Crear otro usuario
            </button>
            <Link href="/admin/usuarios" className="btn-primary text-sm">
              Volver a la lista
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <Link href="/admin/usuarios"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4" />Usuarios
        </Link>
        <h2 className="text-base font-semibold text-gray-900">Nuevo usuario</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Se generará una contraseña inicial automáticamente.
        </p>
      </div>

      <div className="card p-5">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Nombre completo *</label>
              <input {...register("name")}
                className={cn("input", errors.name && "input-error")}
                placeholder="Nombre y apellido" />
              {errors.name && <p className="error-msg">{errors.name.message}</p>}
            </div>

            <div className="sm:col-span-2">
              <label className="label">Email *</label>
              <input {...register("email")} type="email"
                className={cn("input", errors.email && "input-error")}
                placeholder="usuario@farmaciastkl.com" />
              {errors.email && <p className="error-msg">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Rol *</label>
              <select {...register("role")} className={cn("input", errors.role && "input-error")}>
                {ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
              {errors.role && <p className="error-msg">{errors.role.message}</p>}
            </div>

            <div>
              <label className="label">
                Sucursal {needsBranch ? "*" : <span className="text-gray-400 font-normal">(opcional)</span>}
              </label>
              <select {...register("branchId")}
                className={cn("input", errors.branchId && "input-error")}>
                <option value="">Sin sucursal</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {needsBranch && (
                <p className="text-xs text-amber-600 mt-0.5">Obligatorio para el rol Encargada.</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="label">
                Empleado vinculado <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <select {...register("employeeId")} className="input">
                <option value="">Sin vincular</option>
                {employees.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} — {e.position?.name}
                    {e.currentBranch ? ` (${e.currentBranch.name})` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-0.5">
                Vincula este usuario a un empleado existente del sistema.
              </p>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 justify-end">
            <Link href="/admin/usuarios" className="btn-secondary">Cancelar</Link>
            <button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

