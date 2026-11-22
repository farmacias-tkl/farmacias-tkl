import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { STATUS_META, STATUS_ORDER, parseStatus } from "@/lib/call-center/status-display";
import { formatDateTimeAR } from "@/lib/dates/format";
import { INBOX_PAGE_SIZE, inboxHref, inboxPageInfo, parsePage } from "@/lib/call-center/inbox-pagination";

export const metadata = { title: "Call Center — Conversaciones" };

// Bandeja: conversaciones de la más reciente a la más antigua, con filtro por estado.
// Paginada: trae INBOX_PAGE_SIZE filas por página y solo las columnas que muestra. Antes
// traía y dibujaba todas las conversaciones (más de 22.000) y la página pesaba decenas de MB.

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
  searchParams: { status?: string; page?: string };
}) {
  // El layout ya exige sesión y acceso al Call Center; acá solo se decide si se ofrece el
  // acceso a las métricas. La pantalla de métricas vuelve a comprobar el permiso por su cuenta.
  const session = await auth();
  const showMetricsLink = !!session?.user && canViewCallCenterMetrics(session.user);

  const status = parseStatus(searchParams.status);
  const where = status ? { status } : undefined;

  const total = await prisma.conversation.count({ where });
  const pageInfo = inboxPageInfo(total, parsePage(searchParams.page));

  const conversations = await prisma.conversation.findMany({
    where,
    select: {
      id: true,
      status: true,
      source: true,
      updatedAt: true,
      customerPhoneSnapshot: true,
      customer: { select: { displayName: true, phone: true } },
      assignedTo: { select: { name: true } },
      _count: { select: { messages: true } },
    },
    // id como desempate: sin él, dos conversaciones con el mismo updatedAt podrían repetirse
    // o saltearse entre una página y la siguiente.
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: INBOX_PAGE_SIZE,
    skip: pageInfo.skip,
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>Conversaciones</h1>
        {showMetricsLink && (
          <Link
            href="/call-center/metricas"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#1E2D5A] px-3 text-xs font-semibold text-[#1E2D5A] hover:bg-[#1E2D5A] hover:text-white transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5 shrink-0" />
            <span>Métricas</span>
          </Link>
        )}
      </div>
      <p style={{ marginTop: 6, marginBottom: 20, color: "#6b7280", fontSize: 13 }}>
        Conversaciones de WhatsApp que llegan por Emozion, de la más reciente a la más antigua. Para responderle al cliente, usá Emozion.
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

      {/* Paginación */}
      {total > 0 && (
        <nav aria-label="Paginación" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 16, fontSize: 13, color: "#6b7280" }}>
          <span>
            Mostrando {pageInfo.from.toLocaleString("es-AR")} a {pageInfo.to.toLocaleString("es-AR")} de {total.toLocaleString("es-AR")}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <PageLink label="← Anterior" href={inboxHref(status, pageInfo.page - 1)} enabled={pageInfo.hasPrev} />
            <PageLink label="Siguiente →" href={inboxHref(status, pageInfo.page + 1)} enabled={pageInfo.hasNext} />
          </span>
        </nav>
      )}
    </main>
  );
}

function PageLink({ label, href, enabled }: { label: string; href: string; enabled: boolean }) {
  const style = {
    padding: "5px 14px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: enabled ? "#374151" : "#d1d5db",
  } as const;
  // Deshabilitado: texto sin enlace, para no ofrecer una página que no existe.
  return enabled ? <Link href={href} style={style}>{label}</Link> : <span aria-disabled="true" style={style}>{label}</span>;
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
