import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { auth } from "@/lib/auth";
import { canViewCallCenterMetrics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { STATUS_META, STATUS_ORDER, parseStatus } from "@/lib/call-center/status-display";
import { formatDateTimeAR } from "@/lib/dates/format";
import { INBOX_PAGE_SIZE, inboxHref, inboxPageInfo, parsePage } from "@/lib/call-center/inbox-pagination";
import { loadLastResponders, loadOperatorDirectory } from "@/lib/call-center/operator-directory";
import { operatorFilterValue, operatorInfo, operatorOptions, operatorWhere, parseOperatorFilter } from "@/lib/call-center/operator-display";

export const metadata = { title: "Call Center — Conversaciones" };

// Bandeja: conversaciones de la más reciente a la más antigua, con filtro por estado y por operador.
// "Operador" es la cuenta de Emozion asignada; el nombre sale de la configuración de métricas.
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
  searchParams: { status?: string; page?: string; operator?: string };
}) {
  // El layout ya exige sesión y acceso al Call Center; acá solo se decide si se ofrece el
  // acceso a las métricas. La pantalla de métricas vuelve a comprobar el permiso por su cuenta.
  const session = await auth();
  const showMetricsLink = !!session?.user && canViewCallCenterMetrics(session.user);

  const status = parseStatus(searchParams.status);
  const { accounts } = await loadOperatorDirectory();
  const operator = parseOperatorFilter(searchParams.operator);
  const operatorValue = operatorFilterValue(operator);
  const where = { ...(status ? { status } : {}), ...operatorWhere(operator, accounts) };

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
      externalAssigneeId: true,
      _count: { select: { messages: true } },
    },
    // id como desempate: sin él, dos conversaciones con el mismo updatedAt podrían repetirse
    // o saltearse entre una página y la siguiente.
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: INBOX_PAGE_SIZE,
    skip: pageInfo.skip,
  });

  // Último operador que respondió (dato detectado), para las filas de esta página.
  const lastResponders = await loadLastResponders(conversations.map((c) => c.id));
  const options = operatorOptions(accounts, operator);

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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <FilterChip label="Todas" href={inboxHref(null, 1, operatorValue)} active={!status} />
        {STATUS_ORDER.map((s) => (
          <FilterChip key={s} label={STATUS_META[s].label} href={inboxHref(s, 1, operatorValue)} active={status === s} />
        ))}
      </div>

      {/* Filtro por operador: formulario GET, funciona sin JavaScript y vuelve a la página 1. */}
      <form method="get" action="/call-center" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 20, fontSize: 13, color: "#374151" }}>
        {status && <input type="hidden" name="status" value={status} />}
        <label htmlFor="operator-filter" style={{ fontWeight: 600 }}>Operador</label>
        <select id="operator-filter" name="operator" defaultValue={operatorValue ?? ""}
          style={{ height: 36, padding: "0 8px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, maxWidth: "100%" }}>
          <option value="">Todos</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="submit" style={{ height: 36, padding: "0 14px", borderRadius: 8, border: "1px solid #111827", background: "#111827", color: "#fff", fontSize: 13, fontWeight: 500 }}>
          Filtrar
        </button>
        {operator && (
          <Link href={inboxHref(status, 1)} style={{ color: "#1E2D5A", textDecoration: "underline" }}>Quitar filtro</Link>
        )}
      </form>

      {conversations.length === 0 ? (
        <p style={{ color: "#9ca3af", fontSize: 14, padding: "32px 0", textAlign: "center" }}>
          No hay conversaciones {status ? `en estado "${STATUS_META[status].label}"` : ""}{operator ? " para ese operador" : ""}.
        </p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
          {conversations.map((c, i) => {
            const last = lastResponders.get(c.id);
            const op = operatorInfo(c.externalAssigneeId, last?.account ?? null, accounts);
            return (
            <Link
              key={c.id}
              href={`/call-center/${c.id}`}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_200px_auto]"
              style={{
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
                  {c._count.messages} mensaje{c._count.messages === 1 ? "" : "s"}
                  {c.source ? ` · ${c.source}` : ""}
                  {c.assignedTo?.name ? ` · tomada en esta plataforma por ${c.assignedTo.name}` : ""}
                </div>
                {/* En el celular el operador va debajo; en pantallas anchas, en su columna. */}
                <div className="sm:hidden" style={{ marginTop: 4, fontSize: 12.5 }}>
                  <OperatorCell op={op} inline />
                </div>
              </div>
              <div className="hidden sm:block" style={{ minWidth: 0, fontSize: 12.5 }}>
                <OperatorCell op={op} />
              </div>
              <div style={{ textAlign: "right", color: "#9ca3af", fontSize: 12, whiteSpace: "nowrap" }}>
                {formatDateTimeAR(c.updatedAt)}
              </div>
            </Link>
            );
          })}
        </div>
      )}

      {/* Paginación */}
      {total > 0 && (
        <nav aria-label="Paginación" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 16, fontSize: 13, color: "#6b7280" }}>
          <span>
            Mostrando {pageInfo.from.toLocaleString("es-AR")} a {pageInfo.to.toLocaleString("es-AR")} de {total.toLocaleString("es-AR")}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <PageLink label="← Anterior" href={inboxHref(status, pageInfo.page - 1, operatorValue)} enabled={pageInfo.hasPrev} />
            <PageLink label="Siguiente →" href={inboxHref(status, pageInfo.page + 1, operatorValue)} enabled={pageInfo.hasNext} />
          </span>
        </nav>
      )}
    </main>
  );
}

// Operador de la fila: el asignado (medido) y, si falta o es otra cuenta, el último en responder (detectado).
function OperatorCell({ op, inline }: { op: { attendedBy: string; hasAssignee: boolean; lastResponder: string | null }; inline?: boolean }) {
  return (
    <>
      <div style={{ color: op.hasAssignee ? "#111827" : "#6b7280", fontWeight: op.hasAssignee ? 600 : 400 }}>
        {inline ? "Operador: " : ""}{op.attendedBy}
      </div>
      {op.lastResponder && (
        <div style={{ color: "#6b7280", marginTop: 2 }}>
          <span style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "0 4px", fontSize: 11, fontWeight: 600, marginRight: 4 }}>Detectado</span>
          último en responder: {op.lastResponder}
        </div>
      )}
    </>
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
