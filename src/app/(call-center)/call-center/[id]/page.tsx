import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConversationMessageAuthor } from "@prisma/client";
import { STATUS_META } from "@/lib/call-center/status-display";
import { formatDateTimeAR } from "@/lib/dates/format";
import { formatAttachmentMeta, groupAttachmentsByMessage } from "@/lib/call-center/attachment-display";
import ConversationActions from "./ConversationActions";

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
      // B5: metadata de adjuntos a NIVEL CONVERSACIÓN (no anidada bajo messages), para poder
      // detectar huérfanos (messageId null por SetNull, o que no matchea ningún mensaje) y NO
      // tragárnoslos en silencio. SELECT WHITELIST: solo metadata; sin sourceExternalId/URLs/
      // mimeType/originalFileName/source/columnas de storage futuras (B6). Es metadata-only.
      attachments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, messageId: true, mediaType: true, sizeBytes: true, documentType: true, status: true, createdAt: true },
      },
    },
  });

  if (!conv) notFound();

  const m = STATUS_META[conv.status];

  // B5: anclar cada adjunto a su mensaje vía messageId; los huérfanos van a un bloque al pie.
  const messageIds = new Set(conv.messages.map((msg) => msg.id));
  const { byMessage: attachmentsByMessage, orphans: orphanAttachments } = groupAttachmentsByMessage(conv.attachments, messageIds);

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

      {/* Metadatos */}
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 24px", marginTop: 20, padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <Meta label="Teléfono (snapshot)" value={conv.customerPhoneSnapshot ?? conv.customer.phone} />
        <Meta label="Operador asignado" value={conv.assignedTo?.name ?? "—"} />
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
// NO preview, NO thumbnail, NO link, NO descarga — ver/bajar el archivo es B3-B/B6 (storage).
// El módulo no usa emojis → prefijo textual "Adjunto:".
function AttachmentLine({
  att,
}: {
  att: { mediaType: string | null; sizeBytes: number | null; documentType: string | null; status: string | null };
}) {
  return (
    <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>
      <span style={{ fontWeight: 600 }}>Adjunto:</span> {formatAttachmentMeta(att)}
    </div>
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
