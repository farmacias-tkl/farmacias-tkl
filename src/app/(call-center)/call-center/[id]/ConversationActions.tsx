"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConversationStatus } from "@prisma/client";

/**
 * Isla de acciones del detalle de conversación (Sprint 2): tomar / reasignar / cerrar.
 *
 * DIVERGENCIA DELIBERADA del patrón canónico (Vacaciones/TimeEvent usan client DetailModal
 * + TanStack Query con refetch). Call Center nació en Sprint 1 como vista server-component
 * read-only y ya está en prod; en vez de reescribirla a client+useQuery, mantenemos la
 * página SSR intacta y agregamos esta única isla client. Tras mutar, router.refresh()
 * re-ejecuta el server component y trae el estado nuevo. Es expand additive, no reescritura.
 * El control de permisos es server-side en cada endpoint; estos botones solo son UI.
 */

type Operator = { id: string; name: string; role: string };
type Panel = null | "reassign" | "close";

const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: bg,
  color: fg,
});

export default function ConversationActions({
  conversationId,
  status,
  assignedToUserId,
}: {
  conversationId: string;
  status: ConversationStatus;
  assignedToUserId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState("");
  const [targetId, setTargetId] = useState("");
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);

  async function act(action: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-center/conversations/${conversationId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Error al procesar la acción");
      setPanel(null);
      setNote("");
      setTargetId("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function openReassign() {
    setPanel("reassign");
    setError(null);
    setTargetId("");
    setLoadingOps(true);
    try {
      const res = await fetch("/api/call-center/operators");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Error al cargar operadores");
      setOperators(((json.data ?? []) as Operator[]).filter((o) => o.id !== assignedToUserId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setLoadingOps(false);
    }
  }

  const canTake = status === "SIN_ASIGNAR";
  const canManage = status === "ASIGNADA";
  if (!canTake && !canManage) {
    return (
      <p style={{ fontSize: 12.5, color: "#9ca3af", margin: "16px 0 0" }}>
        No hay acciones disponibles para una conversación en estado {status}.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 20, padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canTake && (
          <button style={btn("#2563eb")} disabled={busy} onClick={() => act("take")}>
            {busy ? "Procesando…" : "Tomar"}
          </button>
        )}
        {canManage && (
          <>
            <button
              style={btn(panel === "reassign" ? "#1e40af" : "#2563eb")}
              disabled={busy}
              onClick={() => (panel === "reassign" ? setPanel(null) : openReassign())}
            >
              Reasignar
            </button>
            <button
              style={btn(panel === "close" ? "#047857" : "#059669")}
              disabled={busy}
              onClick={() => {
                setError(null);
                setNote("");
                setPanel(panel === "close" ? null : "close");
              }}
            >
              Cerrar
            </button>
          </>
        )}
      </div>

      {panel === "reassign" && (
        <div style={{ marginTop: 14 }}>
          {loadingOps ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>Cargando operadores…</p>
          ) : operators.length === 0 ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>No hay otros operadores disponibles.</p>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, minWidth: 220 }}
              >
                <option value="">Elegí un operador…</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.role})
                  </option>
                ))}
              </select>
              <button
                style={{ ...btn("#2563eb"), opacity: !targetId || busy ? 0.5 : 1 }}
                disabled={!targetId || busy}
                onClick={() => act("reassign", { toAssignedToUserId: targetId })}
              >
                {busy ? "Procesando…" : "Confirmar reasignación"}
              </button>
            </div>
          )}
        </div>
      )}

      {panel === "close" && (
        <div style={{ marginTop: 14 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota de cierre (opcional)"
            rows={3}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
          />
          <button
            style={{ ...btn("#059669"), marginTop: 8, opacity: busy ? 0.5 : 1 }}
            disabled={busy}
            onClick={() => act("close", note.trim() ? { note: note.trim() } : {})}
          >
            {busy ? "Procesando…" : "Confirmar cierre"}
          </button>
        </div>
      )}

      {error && <p style={{ marginTop: 12, color: "#b91c1c", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
