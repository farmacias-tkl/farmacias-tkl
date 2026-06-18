import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { STATUS_META, STATUS_ORDER, parseStatus } from "@/lib/call-center/status-display";
import { formatDateTimeAR } from "@/lib/dates/format";

export const metadata = { title: "Call Center — Conversaciones" };

// Vista read-only del Sprint 1 (fundación conversacional). Lista las
// conversaciones (fixtures) con filtro simple por estado. SIN acciones:
// nada de tomar / derivar / cerrar / responder; eso llega en el Sprint 2.

function StatusBadge({ status }: { status: keyof typeof STATUS_META }) {
  const m = STATUS_META[status];
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

export default async function CallCenterPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status = parseStatus(searchParams.status);

  const conversations = await prisma.conversation.findMany({
    where: status ? { status } : undefined,
    include: {
      customer: true,
      assignedTo: { select: { name: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>Conversaciones</h1>
      <p style={{ marginTop: 6, marginBottom: 20, color: "#6b7280", fontSize: 13 }}>
        Vista de solo lectura · datos de prueba. Las acciones operativas llegan en una fase posterior.
      </p>

      {/* Filtro por estado */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <FilterChip label="Todas" href="/call-center" active={!status} />
        {STATUS_ORDER.map((s) => (
          <FilterChip key={s} label={STATUS_META[s].label} href={`/call-center?status=${s}`} active={status === s} />
        ))}
      </div>

      {conversations.length === 0 ? (
        <p style={{ color: "#9ca3af", fontSize: 14, padding: "32px 0", textAlign: "center" }}>
          No hay conversaciones {status ? `en estado "${STATUS_META[status].label}"` : ""}.
        </p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
          {conversations.map((c, i) => (
            <Link
              key={c.id}
              href={`/call-center/${c.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "14px 16px",
                borderTop: i === 0 ? "none" : "1px solid #f3f4f6",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, color: "#111827", fontSize: 14 }}>
                    {c.customer.displayName ?? c.customerPhoneSnapshot ?? c.customer.phone}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12.5 }}>
                  {c.assignedTo?.name ? `Operador: ${c.assignedTo.name}` : "Sin operador"}
                  {" · "}
                  {c._count.messages} mensaje{c._count.messages === 1 ? "" : "s"}
                  {c.source ? ` · ${c.source}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", color: "#9ca3af", fontSize: 12, whiteSpace: "nowrap" }}>
                {formatDateTimeAR(c.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        padding: "5px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        textDecoration: "none",
        border: active ? "1px solid #111827" : "1px solid #e5e7eb",
        background: active ? "#111827" : "#fff",
        color: active ? "#fff" : "#374151",
      }}
    >
      {label}
    </Link>
  );
}
