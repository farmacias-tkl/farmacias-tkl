"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { User, Lock, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

const pwSchema = z.object({
  currentPassword: z.string().min(1, "Obligatoria"),
  newPassword: z.string()
    .min(8, "Minimo 8 caracteres")
    .regex(/[A-Z]/, "Requiere mayuscula")
    .regex(/[0-9]/, "Requiere numero"),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});
type PwForm = z.infer<typeof pwSchema>;

export default function PerfilPage() {
  const { data: session } = useSession();
  const [pwError,   setPwError]   = useState("");
  const [pwOk,      setPwOk]      = useState(false);
  const [showCur,   setShowCur]   = useState(false);
  const [showNew,   setShowNew]   = useState(false);
  const [showConf,  setShowConf]  = useState(false);

  const { data: profileData, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn:  () => fetch("/api/profile").then(r => r.json()),
    enabled:  !!session,
  });

  const profile = profileData?.data;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PwForm>({
    resolver: zodResolver(pwSchema),
  });

  async function onSubmitPw(data: PwForm) {
    setPwError(""); setPwOk(false);
    const res  = await fetch("/api/me/change-password", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
    });
    const json = await res.json();
    if (!res.ok) {
      setPwError(json.error ?? "Error al cambiar contraseña");
      return;
    }
    setPwOk(true);
    reset();
    setTimeout(() => setPwOk(false), 3000);
  }

  if (isLoading) return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Mi perfil</h2>

      {/* Datos del usuario */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-gray-900">{profile?.name}</p>
            <p className="text-sm text-gray-500">{profile?.email}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", ROLE_COLORS[profile?.role as UserRole])}>
                {ROLE_LABELS[profile?.role as UserRole]}
              </span>
              {profile?.branch && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {profile.branch.name}
                </span>
              )}
            </div>
          </div>
        </div>

        {profile?.employee && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Empleado vinculado</p>
            <p className="text-sm text-gray-800 font-medium">
              {profile.employee.firstName} {profile.employee.lastName}
            </p>
            <p className="text-xs text-gray-500">
              {profile.employee.position?.name}
              {profile.employee.currentBranch ? ` · ${profile.employee.currentBranch.name}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* Cambiar contraseña */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Cambiar contraseña</h3>
        </div>

        <form onSubmit={handleSubmit(onSubmitPw)} className="space-y-4">
          {/* Contraseña actual */}
          <div>
            <label className="label">Contraseña actual</label>
            <div className="relative">
              <input {...register("currentPassword")} type={showCur ? "text" : "password"}
                className={cn("input pr-10", errors.currentPassword && "input-error")} />
              <button type="button" onClick={() => setShowCur(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.currentPassword && <p className="error-msg">{errors.currentPassword.message}</p>}
          </div>

          {/* Nueva contraseña */}
          <div>
            <label className="label">Nueva contraseña</label>
            <div className="relative">
              <input {...register("newPassword")} type={showNew ? "text" : "password"}
                className={cn("input pr-10", errors.newPassword && "input-error")} />
              <button type="button" onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.newPassword && <p className="error-msg">{errors.newPassword.message}</p>}
            <p className="text-xs text-gray-400 mt-0.5">Mínimo 8 caracteres, una mayúscula y un número.</p>
          </div>

          {/* Confirmar */}
          <div>
            <label className="label">Confirmar nueva contraseña</label>
            <div className="relative">
              <input {...register("confirmPassword")} type={showConf ? "text" : "password"}
                className={cn("input pr-10", errors.confirmPassword && "input-error")} />
              <button type="button" onClick={() => setShowConf(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.confirmPassword && <p className="error-msg">{errors.confirmPassword.message}</p>}
          </div>

          {pwError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{pwError}</p>
          )}

          {pwOk && (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4" />
              <p className="text-sm font-medium">Contraseña actualizada correctamente.</p>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? "Guardando..." : "Cambiar contraseña"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

