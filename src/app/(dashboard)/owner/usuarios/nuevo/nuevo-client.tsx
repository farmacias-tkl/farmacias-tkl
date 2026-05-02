"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, AlertTriangle } from "lucide-react";
import { ROLE_LABELS } from "@/lib/permissions";
import { ConfirmModal } from "@/components/ConfirmModal";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["OWNER","ADMIN","SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"];

export function NuevoUsuarioClient() {
  const router = useRouter();
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [role,     setRole]     = useState<UserRole>("SUPERVISOR");
  const [branchId, setBranchId] = useState("");
  const [error,    setError]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmOwner, setConfirmOwner] = useState(false);
  const [created, setCreated] = useState<{name: string; email: string; password: string} | null>(null);

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
  });
  const branches = branchRes?.data ?? [];

  const isOwner = role === "OWNER";
  const isAdmin = role === "ADMIN";
  const requiresBranch = role === "BRANCH_MANAGER";

  const submit = async () => {
    setError("");
    if (!name.trim() || name.trim().length < 2) { setError("Nombre obligatorio (min 2 caracteres)"); return; }
    if (!email.trim()) { setError("Email obligatorio"); return; }
    if (requiresBranch && !branchId) { setError("Encargada requiere sucursal"); return; }

    setSubmitting(true);
    const res = await fetch("/api/owner/users", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, email, role, branchId: branchId || null }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) { setError(json.error ?? "Error"); return; }

    setCreated({ name: json.data.name, email: json.data.email, password: json.initialPassword });
  };

  const handleSubmitClick = () => {
    if (isOwner) { setConfirmOwner(true); return; }
    submit();
  };

  // Pantalla de exito: muestra password una sola vez
  if (created) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-4">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 mb-1">
                Usuario creado: {created.name}
              </p>
              <p className="text-xs text-amber-700 mb-2">
                Email: <span className="font-medium">{created.email}</span>
              </p>
              <p className="text-xs text-amber-700 mb-2">
                Contrasena temporal (visible una sola vez). Comunicasela al usuario:
              </p>
              <code className="block bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-amber-900 tracking-wider select-all">
                {created.password}
              </code>
              <p className="text-xs text-amber-600 mt-2">
                El usuario debera cambiarla en su primer ingreso.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/owner/usuarios" className="btn-secondary">Volver al listado</Link>
          <button onClick={() => { setCreated(null); setName(""); setEmail(""); setRole("SUPERVISOR"); setBranchId(""); }} className="btn-primary">
            Crear otro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/owner/usuarios" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-3.5 h-3.5" />Volver
      </Link>

      <div>
        <h2 className="text-base font-semibold text-gray-900">Nuevo usuario</h2>
        <p className="text-sm text-gray-500 mt-0.5">Crear usuario con cualquier rol del sistema.</p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="card p-5 space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Nombre</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="input mt-1" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Rol</label>
          <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="input mt-1 w-full">
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        {(isOwner || isAdmin) && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 leading-relaxed">
              {isOwner
                ? <><strong>Direccion (OWNER):</strong> tendra acceso total al sistema, incluyendo el panel /owner y el Dashboard Ejecutivo. Solo asignar a la persona responsable de la organizacion.</>
                : <><strong>Administrador (ADMIN):</strong> puede crear y gestionar usuarios operativos, puestos y configuracion del sistema. No puede acceder al panel /owner.</>}
            </div>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Sucursal {requiresBranch && <span className="text-red-600">*</span>}
          </label>
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input mt-1 w-full">
            <option value="">Sin sucursal</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {requiresBranch && <p className="text-xs text-gray-500 mt-1">Encargada requiere sucursal asignada.</p>}
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Link href="/owner/usuarios" className="btn-secondary">Cancelar</Link>
        <button onClick={handleSubmitClick} disabled={submitting} className="btn-primary">
          {submitting ? "Creando..." : "Crear usuario"}
        </button>
      </div>

      <ConfirmModal
        open={confirmOwner}
        title="Crear usuario con permisos de Direccion"
        message={`Estas por otorgar permisos de Direccion a ${name || "(sin nombre)"}. Este usuario tendra acceso total al sistema incluyendo el panel de direccion.`}
        variant="danger"
        confirmLabel="Crear OWNER"
        cancelLabel="Cancelar"
        loading={submitting}
        onConfirm={() => { setConfirmOwner(false); submit(); }}
        onCancel={() => setConfirmOwner(false)}
      />
    </div>
  );
}
