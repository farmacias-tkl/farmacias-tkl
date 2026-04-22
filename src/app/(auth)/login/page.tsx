"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, getSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const schema = z.object({
  email:    z.string().email("Email invalido"),
  password: z.string().min(1, "Contrasena obligatoria"),
});
type F = z.infer<typeof schema>;

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get("callbackUrl") || "/dashboard";
  const [showPwd,   setShowPwd]   = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<F>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: F) {
    setServerErr(null);

    // Guardar email para el re-login automático después del cambio de contraseña
    sessionStorage.setItem("tkl_last_email", data.email);

    const result = await signIn("credentials", { ...data, redirect: false });
    if (result?.error) {
      setServerErr("Email o contrasena incorrectos");
      return;
    }

    // OWNER siempre a /executive (ignorando callbackUrl — por spec).
    // Otros roles respetan callbackUrl.
    const sess = await getSession();
    const target = sess?.user?.role === "OWNER" ? "/executive" : callbackUrl;
    router.push(target);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Farmacias TKL</h1>
          <p className="text-sm text-gray-500 mt-1">Supervision operativa</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                {...register("email")}
                type="email"
                autoComplete="email"
                className={cn("input", errors.email && "input-error")}
                placeholder="usuario@farmaciastkl.com"
              />
              {errors.email && (
                <p className="error-msg">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="label">Contrasena</label>
              <div className="relative">
                <input
                  {...register("password")}
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  className={cn("input pr-10", errors.password && "input-error")}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="error-msg">{errors.password.message}</p>
              )}
            </div>

            {serverErr && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-700">{serverErr}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full justify-center"
            >
              {isSubmitting ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
