"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { ROLE_LABELS } from "@/lib/permissions";
import { ConfirmModal } from "@/components/ConfirmModal";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["OWNER","ADMIN","SUPERVISOR","CO_SUPERVISOR","HR","BRANCH_MANAGER","MAINTENANCE"];

interface UserDetail {
  id:              string;
  name:            string;
  email:           string;
  role:            UserRole;
  active:          boolean;
  branchId:        string | null;
  branch:          { id: string; name: string } | null;
}

type ConfirmKind = null | "promote-owner" | "demote-owner";

export function EditarUsuarioClient({ userId, currentUserId }: { userId: string; currentUserId: string }) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: UserDetail }>({
    queryKey: ["owner-user", userId],
    queryFn:  () => fetch(`/api/owner/users/${userId}`).then(r => r.json()),
  });

  const { data: branchRes } = useQuery({
    queryKey: ["branches"],
    queryFn:  () => fetch("/api/branches").then(r => r.json()),
  });
  const branches = branchRes?.data ?? [];

  const u = data?.data;
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [role,     setRole]     = useState<UserRole>("SUPERVISOR");
  const [branchId, setBranchId] = useState("");
  const [error,    setError]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirm,  setConfirm]  = useState<ConfirmKind>(null);

  useEffect(() => {
    if (u) {
      setName(u.name); setEmail(u.email); setRole(u.role); setBranchId(u.branchId ?? "");
    }
  }, [u]);

  if (isLoading || !u) return <div className="card p-10 text-center text-sm text-gray-400">Cargando...</div>;

  const isSelf  = u.id === currentUserId;
  const wasOwner= u.role === "OWNER";
  const isOwner = role === "OWNER";
  const requiresBranch = role === "BRANCH_MANAGER";

  // Cambios sensibles
  const promotingToOwner = !wasOwner && isOwner;
  const demotingFromOwner = wasOwner && !isOwner;

  const submit = async () => {
    setError("");
    if (!name.trim() || name.trim().length < 2) { setError("Nombre obligatorio"); return; }
    if (!email.trim()) { setError("Email obligatorio"); return; }
    if (requiresBranch && !branchId) { setError("Encargada requiere sucursal"); return; }

    setSubmitting(true);
    const res = await fetch(`/api/owner/users/${userId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, email, role, branchId: branchId || null }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) { setError(json.error ?? "Error"); setConfirm(null); return; }

    qc.invalidateQueries({ queryKey: ["owner-user", userId] });
    qc.invalidateQueries({ queryKey: ["owner-users"] });
    router.push("/owner/usuarios");
  };

  const handleSubmitClick = () => {
    if (promotingToOwner) { setConfirm("promote-owner"); return; }
    if (demotingFromOwner) { setConfirm("demote-owner"); return; }
    submit();
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/owner/usuarios" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-3.5 h-3.5" />Volver
      </Link>

      <div>
        <h2 className="text-base font-semibold text-gray-900">Editar usuario: {u.name}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{u.email} · {ROLE_LABELS[u.role]}</p>
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
          <select
            value={role}
            onChange={e => setRole(e.target.value as UserRole)}
            disabled={isSelf}
            className="input mt-1 w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {isSelf && <p className="text-xs text-gray-500 mt-1">No podes cambiar tu propio rol.</p>}
        </div>

        {promotingToOwner && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 leading-relaxed">
              <strong>Promocion a Direccion (OWNER):</strong> este usuario tendra acceso total al sistema, incluyendo el panel /owner y el Dashboard Ejecutivo.
            </div>
          </div>
        )}
        {demotingFromOwner && (
          <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="text-xs text-orange-800 leading-relaxed">
              <strong>Revocacion de Direccion:</strong> {u.name} perdera acceso al panel /owner y al Dashboard Ejecutivo (a menos que sigas teniendo executiveAccess otorgado).
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
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Link href="/owner/usuarios" className="btn-secondary">Cancelar</Link>
        <button onClick={handleSubmitClick} disabled={submitting} className="btn-primary">
          {submitting ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>

      <ConfirmModal
        open={confirm === "promote-owner"}
        title="Promocionar a Direccion (OWNER)"
        message={`Estas por otorgar permisos de Direccion a ${u.name}. Este usuario tendra acceso total al sistema incluyendo el panel de direccion.`}
        variant="danger"
        confirmLabel="Confirmar promocion"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === "demote-owner"}
        title="Revocar permisos de Direccion"
        message={`Estas por revocar los permisos de Direccion de ${u.name}. Este usuario perdera acceso al panel de direccion y al Dashboard Ejecutivo.`}
        variant="warning"
        confirmLabel="Revocar"
        loading={submitting}
        onConfirm={submit}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
