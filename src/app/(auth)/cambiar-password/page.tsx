"use client";
import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({
  currentPassword: z.string().min(1, "Obligatoria"),
  newPassword: z.string()
    .min(8, "Minimo 8 caracteres")
    .regex(/[A-Z]/, "Mayuscula requerida")
    .regex(/[0-9]/, "Numero requerido"),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "No coinciden",
  path: ["confirmPassword"],
});
type F = z.infer<typeof schema>;

function ChangePasswordForm() {
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [step,    setStep]    = useState<"form"|"relogging">("form");

  const { register, handleSubmit, getValues, formState: { errors } } = useForm<F>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: F) {
    setLoading(true);
    setError("");

    // 1. Cambiar contraseña en BD y borrar cookie de sesión actual
    const res  = await fetch("/api/me/change-password", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        currentPassword: data.currentPassword,
        newPassword:     data.newPassword,
      }),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error || "Error al cambiar la contrasena");
      setLoading(false);
      return;
    }

    // 2. Reautenticar automáticamente con la nueva contraseña
    // Esto genera un JWT nuevo con mustChangePassword = false
    setStep("relogging");

    // Necesitamos el email — lo leemos del campo actual de sesión
    // Como la cookie fue borrada, usamos el email del formulario de login
    // Para no pedírselo de nuevo, lo guardamos en sessionStorage al hacer login
    const email = sessionStorage.getItem("tkl_last_email") ?? "";

    const result = await signIn("credentials", {
      email,
      password:    data.newPassword,
      redirect:    false,
    });

    if (result?.ok) {
      window.location.href = "/dashboard";
    } else {
      // Si falla el re-login automático, mandamos al login manual
      window.location.href = "/login";
    }
  }

  if (step === "relogging") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f5f7" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: "3px solid #1d4ed8", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 1rem" }} />
          <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>Iniciando sesion...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f5f7" }}>
      <div style={{ background: "white", padding: "2rem", borderRadius: "1rem", width: "100%", maxWidth: "420px", border: "1px solid #e3e6ea" }}>
        <h1 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.5rem" }}>Cambia tu contrasena</h1>
        <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "1.5rem" }}>Obligatorio en el primer ingreso.</p>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>
              Contrasena actual
            </label>
            <input {...register("currentPassword")} type="password"
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", boxSizing: "border-box" }} />
            {errors.currentPassword && <p style={{ color: "red", fontSize: "0.75rem", marginTop: "0.25rem" }}>{errors.currentPassword.message}</p>}
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>
              Nueva contrasena
            </label>
            <input {...register("newPassword")} type="password"
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", boxSizing: "border-box" }} />
            {errors.newPassword && <p style={{ color: "red", fontSize: "0.75rem", marginTop: "0.25rem" }}>{errors.newPassword.message}</p>}
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>
              Confirmar contrasena
            </label>
            <input {...register("confirmPassword")} type="password"
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", boxSizing: "border-box" }} />
            {errors.confirmPassword && <p style={{ color: "red", fontSize: "0.75rem", marginTop: "0.25rem" }}>{errors.confirmPassword.message}</p>}
          </div>

          {error && (
            <p style={{ color: "red", background: "#fef2f2", padding: "0.5rem", borderRadius: "0.5rem", fontSize: "0.85rem" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}
            style={{ padding: "0.75rem", background: "#1d4ed8", color: "white", border: "none", borderRadius: "0.5rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Guardando..." : "Guardar contrasena"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f4f5f7" }} />}>
      <ChangePasswordForm />
    </Suspense>
  );
}
