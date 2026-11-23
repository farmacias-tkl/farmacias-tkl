import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConversationMessageAuthor } from "@prisma/client";
import { STATUS_META } from "@/lib/call-center/status-display";
import { formatDateTimeAR } from "@/lib/dates/format";
import { formatAttachmentMeta, groupAttachmentsByMessage, STORAGE_DISPLAY_META, type StorageDisplay } from "@/lib/call-center/attachment-display";
import { loadAttachmentsForDetail } from "@/lib/call-center/attachment-detail-read";
import ConversationActions from "./ConversationActions";
import { loadOperatorDirectory } from "@/lib/call-center/operator-directory";
import { agoLabel, operatorInfo, shortHistory } from "@/lib/call-center/operator-display";
import { accountDisplay, accountRef, assigneeAccount } from "@/lib/call-center/metrics/account-label";

export const metadata = { title: "Call Center — Conversación" };

// Detalle read-only (Sprint 1): estado actual, operador asignado, timestamps,
// timeline de mensajes e historial de estado. SIN acciones de ningún tipo.
// Timestamps con hora real → formatDateTimeAR (zona America/Argentina/Buenos_Aires).

const AUTHOR_LABEL: Record<ConversationMessageAuthor, string> = {
  CUSTOMER: "Cliente",
  BOT: "Bot",
  OPERATOR: "Operador",
};

export default async function ConversationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const conv = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      assignedTo: { select: { name: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        include: { senderUser: { select: { name: true } } },
      },
      stateHistory: {
        orderBy: { changedAt: "asc" },
        include: { changedBy: { select: { name: true } } },
      },
    },
  });

  if (!conv) notFound();

  // B5: metadata de adjuntos a NIVEL CONVERSACIÓN (no anidada bajo messages), para poder
  // detectar huérfanos (messageId null por SetNull, o que no matchea ningún mensaje) y NO
  // tragárnoslos en silencio. B6.3-C5: + storageDisplay derivado en el server (whitelist;
  // ninguna columna de storage ni la URL de origen llegan al render). Ver attachment-detail-read.
  const attachments = await loadAttachmentsForDetail(conv.id);

  const m = STATUS_META[conv.status];

  // Operador: cuenta de Emozion asignada (medido) y último operador que respondió (detectado).
  // Los nombres salen de la configuración de métricas vigente; sin alias, "Cuenta N".
  const { accounts, closureMap } = await loadOperatorDirectory();
  const now = new Date();
  const lastOperatorMsg = [...conv.messages].reverse().find((x) => x.author === "OPERATOR" && !x.isPrivate) ?? null;
  const assignee = assigneeAccount(conv.externalAssigneeId, conv.externalAssigneeType);
  const op = operatorInfo(assignee, lastOperatorMsg?.externalSenderId ?? null, accounts);
  // Sin cuenta en el mensaje no se sabe quién respondió, pero sí cuándo.
  const lastResponderText = !lastOperatorMsg || (op.hasAssignee && lastOperatorMsg.externalSenderId === assignee)
    ? null
    : `${op.lastResponder ?? "cuenta no registrada"} · ${agoLabel(lastOperatorMsg.sentAt, now)}`;
  const history = shortHistory(
    conv.stateHistory.map((h) => ({ ...h, externalAssigneeId: assigneeAccount(h.externalAssigneeId, h.externalAssigneeType) })),
    accounts, closureMap,
  );

  // B5: anclar cada adjunto a su mensaje vía messageId; los huérfanos van a un bloque al pie.
  const messageIds = new Set(conv.messages.map((msg) => msg.id));
  const { byMessage: attachmentsByMessage, orphans: orphanAttachments } = groupAttachmentsByMessage(attachments, messageIds);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/call-center" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}>
        ← Volver a conversaciones
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
          {conv.customer.displayName ?? conv.customerPhoneSnapshot ?? conv.customer.phone}
        </h1>
        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: m.bg, color: m.fg }}>
          {m.label}
        </span>
      </div>

      {/* Operador: quién la atiende, quién respondió último y el recorrido corto */}
      <section aria-label="Operador" style={{ marginTop: 20, padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ fontSize: 15, color: "#111827" }}>
          <span style={{ color: "#6b7280" }}>Atendida por: </span>
          <span style={{ fontWeight: 700 }}>{op.attendedBy}</span>
        </div>
        {lastResponderText && (
          <div style={{ fontSize: 13.5, color: "#374151", marginTop: 6 }}>
            <span style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "0 4px", fontSize: 11, fontWeight: 600, marginRight: 6, color: "#6b7280" }}>Detectado</span>
            <span style={{ color: "#6b7280" }}>Último en responder: </span>
            {lastResponderText}
          </div>
        )}
        {history.length > 0 && (
          <ol style={{ listStyle: "none", margin: "10px 0 0", padding: "10px 0 0", borderTop: "1px solid #f3f4f6", display: "flex", flexDirection: "column", gap: 4 }}>
            {history.map((e, i) => (
              <li key={i} style={{ fontSize: 12.5, color: "#374151" }}>
                <span style={{ color: "#9ca3af" }}>{formatDateTimeAR(e.at)}</span>{" · "}{e.text}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Metadatos */}
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 24px", marginTop: 20, padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <Meta label="Teléfono (snapshot)" value={conv.customerPhoneSnapshot ?? conv.customer.phone} />
        <Meta label="Tomada en esta plataforma por" value={conv.assignedTo?.name ?? "—"} />
        <Meta label="Origen" value={conv.source ?? "—"} />
        <Meta label="ID externo" value={conv.externalConversationId ?? "—"} />
        <Meta label="Creada" value={formatDateTimeAR(conv.createdAt)} />
        <Meta label="Primera respuesta" value={formatDateTimeAR(conv.firstResponseAt)} />
        <Meta label="Cerrada" value={formatDateTimeAR(conv.closedAt)} />
        <Meta label="Última actualización" value={formatDateTimeAR(conv.updatedAt)} />
      </dl>

      {/* Acciones (Sprint 2) — isla client; el server component se refresca tras mutar */}
      <ConversationActions
        conversationId={conv.id}
        status={conv.status}
        assignedToUserId={conv.assignedToUserId}
      />

      {/* Timeline de mensajes */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginTop: 28, marginBottom: 12 }}>
        Mensajes ({conv.messages.length})
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {conv.messages.map((msg) => {
          const isCustomer = msg.author === "CUSTOMER";
          const atts = attachmentsByMessage.get(msg.id) ?? [];
          return (
            <div key={msg.id} style={{ display: "flex", justifyContent: isCustomer ? "flex-start" : "flex-end" }}>
              <div style={{ maxWidth: "76%", background: isCustomer ? "#fff" : "#EFF6FF", border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 12px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "#6b7280", marginBottom: 2 }}>
                  {AUTHOR_LABEL[msg.author]}
                  {msg.author === "OPERATOR" && msg.senderUser?.name ? ` · ${msg.senderUser.name}` : ""}
                </div>
                {/* body y/o adjuntos: si hay ambos se muestran los dos; el placeholder mudo
                    queda SOLO cuando no hay ni body ni adjuntos. */}
                {msg.body ? (
                  <div style={{ fontSize: 14, color: "#111827", whiteSpace: "pre-wrap" }}>{msg.body}</div>
                ) : atts.length === 0 ? (
                  <div style={{ fontSize: 14, color: "#111827", whiteSpace: "pre-wrap" }}>
                    <em style={{ color: "#9ca3af" }}>[contenido multimedia]</em>
                  </div>
                ) : null}
                {atts.map((a) => (
                  <AttachmentLine key={a.id} att={a} />
                ))}
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>
                  {msg.author === "OPERATOR" && msg.externalSenderId
                    ? <><span style={{ color: "#4b5563", fontWeight: 600 }}>{accountDisplay(accountRef(msg.externalSenderId, accounts))}</span>{" · "}</>
                    : null}
                  {formatDateTimeAR(msg.sentAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Adjuntos desanclados (Ajuste 3): existen en la conversación pero no cuelgan de ningún
          mensaje del timeline (messageId null o no matchea). NUNCA se omiten. */}
      {orphanAttachments.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginTop: 28, marginBottom: 12 }}>
            Adjuntos de la conversación ({orphanAttachments.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {orphanAttachments.map((a) => (
              <div key={a.id} style={{ padding: "10px 14px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                <AttachmentLine att={a} />
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{formatDateTimeAR(a.createdAt)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Historial de estado */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginTop: 28, marginBottom: 12 }}>
        Historial de estado ({conv.stateHistory.length})
      </h2>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {conv.stateHistory.map((h) => {
          const fromLabel = h.fromStatus ? STATUS_META[h.fromStatus].label : "(inicio)";
          const reassigned = h.fromAssignedToUserId !== h.toAssignedToUserId;
          return (
            <li key={h.id} style={{ padding: "10px 14px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>
              <div style={{ fontSize: 13.5, color: "#111827", fontWeight: 600 }}>
                {fromLabel} → {STATUS_META[h.toStatus].label}
                {h.toStatus === "ASIGNADA" && reassigned && h.fromStatus === "ASIGNADA" ? " (reasignación)" : ""}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>
                {h.changedBy?.name ? `Por ${h.changedBy.name}` : "Sistema (automático)"}
                {" · "}
                {formatDateTimeAR(h.changedAt)}
                {h.note ? ` · ${h.note}` : ""}
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

// Línea de metadata de un adjunto (B5). SOLO texto: tipo · tamaño · clasificación (+ estado).
// NO preview, NO thumbnail, NO link, NO descarga — ver/bajar el archivo es B3-B/B6.5 (storage).
// El módulo no usa emojis → prefijo textual "Adjunto:". B6.3-C5: + badge del estado de copia.
function AttachmentLine({
  att,
}: {
  att: { mediaType: string | null; sizeBytes: number | null; documentType: string | null; status: string | null; storageDisplay: StorageDisplay };
}) {
  return (
    <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>
      <span style={{ fontWeight: 600 }}>Adjunto:</span> {formatAttachmentMeta(att)}{" "}
      <StorageBadge value={att.storageDisplay} />
    </div>
  );
}

// Badge del estado de copia a storage propio (B6.3-C5). El TEXTO lleva el significado (no solo
// el color); mismo estilo de píldora que el badge de estado de la conversación.
function StorageBadge({ value }: { value: StorageDisplay }) {
  const meta = STORAGE_DISPLAY_META[value];
  return (
    <span style={{ display: "inline-block", marginLeft: 4, padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: meta.bg, color: meta.fg, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11.5, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</dt>
      <dd style={{ fontSize: 14, color: "#111827", margin: "2px 0 0" }}>{value}</dd>
    </div>
  );
}
