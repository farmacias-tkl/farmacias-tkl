/**
 * Tests de los mappers de ingesta Emozion. PUROS, sin DB/red/token. Fixtures inline con la
 * FORMA REAL del fork (capturada en prod): message_type STRING, created_at ISO, id de
 * conversación NUMÉRICO (no uuid), account en account.id (message_created) o
 * messages[0].account_id (conversation_*). Todo SANITIZADO (teléfonos/nombres ficticios).
 *
 * El repo no tiene runner de tests; se autoejecuta con node:assert:
 *   npx tsx src/lib/call-center/emozion-mappers.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeConversation,
  normalizeMessage,
  normalizeStatusEvent,
  normalizeUpdateEvent,
  normalizeLabels,
  labelsIfPresent,
  LABELS_MAX,
  SUPPORTED_EVENTS,
  normalizeClosure,
  normalizeExternalAssigneeId, normalizeExternalAssigneeType,
  CLOSURE_TYPE_NAME_MAX,
  mapAuthor,
  readEnvelope,
  conversationExternalId,
} from "./emozion-mappers";

const ISO = "2026-06-17T19:15:45.621-03:00";
const ISO2 = "2026-06-17T19:20:00.000-03:00";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// 1. message con source_id (incoming) → externalMessageId = source_id
test("1. message con source_id → externalMessageId = source_id", () => {
  const r = normalizeMessage({ id: 25003330, source_id: "wamid.ABC", message_type: "incoming", content: "hola", created_at: ISO });
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.externalMessageId, "wamid.ABC");
});

// 2. message sin source_id (outgoing) → fallback prefijado
test("2. message sin source_id → fallback emozion-message:<id>", () => {
  const r = normalizeMessage({ id: 25003331, message_type: "outgoing", content: "respuesta", sender: { id: 1, type: "user" }, created_at: ISO });
  assert.equal(r.data?.externalMessageId, "emozion-message:25003331");
});

// 3. BOT sender.id=1 (outgoing)
test("3. outgoing sender.id=1 → BOT", () => {
  const r = normalizeMessage({ id: 1, source_id: "m1", message_type: "outgoing", content: "soy el bot", sender: { id: 1, type: "user" }, created_at: ISO });
  assert.equal(r.data?.author, "BOT");
  assert.equal(r.authorFallbackCount, 0);
});

// 4. OPERATOR sender.id distinto (outgoing)
test("4. outgoing sender.type=user id!=1 → OPERATOR", () => {
  const r = normalizeMessage({ id: 2, source_id: "m2", message_type: "outgoing", content: "soy operador", sender: { id: 42, type: "user" }, created_at: ISO });
  assert.equal(r.data?.author, "OPERATOR");
  assert.equal(r.authorFallbackCount, 0);
});

// 5. author fallback raro → warning
test("5. outgoing con sender raro/ausente → OPERATOR + authorFallbackCount=1", () => {
  const r = normalizeMessage({ id: 3, source_id: "m3", message_type: "outgoing", content: "raro", sender: { id: null, type: "weird" }, created_at: ISO });
  assert.equal(r.data?.author, "OPERATOR");
  assert.equal(r.authorFallbackCount, 1);
  assert.ok(r.warnings.some((w) => w.includes("fallback")));
  const r2 = normalizeMessage({ id: 4, source_id: "m4", message_type: "outgoing", content: "x", created_at: ISO });
  assert.equal(r2.authorFallbackCount, 1);
});

// 6. activity (message_type "activity") ignorado
test('6. message_type="activity" → ignored, no se persiste', () => {
  const r = normalizeMessage({ id: 9, message_type: "activity", content: "Conversation was marked resolved", created_at: ISO });
  assert.equal(r.outcome, "ignored");
  assert.equal(r.data, null);
});

// 7. private message preservado
test("7. private=true → isPrivate=true", () => {
  const r = normalizeMessage({ id: 7, source_id: "m7", message_type: "outgoing", private: true, content: "nota interna", sender: { id: 42, type: "user" }, created_at: ISO });
  assert.equal(r.data?.isPrivate, true);
  const r2 = normalizeMessage({ id: 8, source_id: "m8", message_type: "incoming", content: "publico", created_at: ISO });
  assert.equal(r2.data?.isPrivate, false);
});

// 8. labels crudas + id NUMÉRICO → externalConversationId String(id)
test("8. labels crudas + id numérico → externalLabels + externalConversationId String(id)", () => {
  const r = normalizeConversation({
    id: 39099, status: "open", labels: ["cronico_mensual", "consulta", ""],
    meta: { sender: { phone_number: "+5491100000001", name: "Cliente Ficticio" }, assignee: { id: 3 } },
    first_reply_created_at: ISO2, created_at: ISO,
  });
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.externalConversationId, "39099"); // numérico → string, NO uuid
  assert.deepEqual(r.data?.externalLabels, ["cronico_mensual", "consulta"]); // filtra vacíos, no unifica
  assert.ok(r.data?.firstResponseAt instanceof Date); // ISO parseado
});

// 9. status open con/sin assignee + pending/resolved/snoozed
test("9. status open + assignee → ASIGNADA; open sin assignee → SIN_ASIGNAR; pending/resolved/snoozed", () => {
  const sender = { phone_number: "+5491100000002" };
  assert.equal(normalizeConversation({ id: 91, status: "open", meta: { sender, assignee: { id: 5 } } }).data?.status, "ASIGNADA");
  assert.equal(normalizeConversation({ id: 92, status: "open", meta: { sender } }).data?.status, "SIN_ASIGNAR");
  assert.equal(normalizeConversation({ id: 93, status: "pending", meta: { sender } }).data?.status, "PENDIENTE");
  assert.equal(normalizeConversation({ id: 94, status: "resolved", resolved_at: ISO, meta: { sender } }).data?.status, "RESUELTA");
  const sn = normalizeConversation({ id: 95, status: "snoozed", meta: { sender } });
  assert.equal(sn.data?.status, "SIN_ASIGNAR");
  assert.ok(sn.warnings.some((w) => w.includes("no mapeado")));
});

// 10. payload incompleto → insufficientData (sin inventar)
test("10. payload incompleto → insufficientData (sin inventar)", () => {
  assert.equal(normalizeConversation({ status: "open", meta: { sender: { phone_number: "+549110" } } }).outcome, "insufficientData"); // sin id
  assert.equal(normalizeConversation({ id: 5, status: "open", meta: { sender: {} } }).outcome, "insufficientData"); // sin phone
  assert.equal(normalizeMessage({ message_type: "incoming", content: "x" }).outcome, "insufficientData"); // sin id ni source_id
  assert.equal(normalizeStatusEvent({ status: "resolved" }).outcome, "insufficientData"); // sin id
});

// 11. MINIMIZACIÓN DE PII (propiedad de la función pura, sin DB)
test("11. payload con DNI/custom_attributes/data_url → Normalized* NO los contiene", () => {
  const rawConv = {
    id: 700, status: "open", labels: ["cronico_mensual"], first_reply_created_at: ISO, created_at: ISO,
    meta: {
      sender: {
        phone_number: "+5491100000003", name: "Cliente Ficticio PII", identifier: "5491100000003",
        custom_attributes: { dni: "30123456", obra_social: "OSX", numero_afiliado: "A-1", domicilio: "Calle Falsa 123" },
        additional_attributes: { city: "Ciudad", browser: "x" },
      },
      assignee: { id: 2 },
    },
  } as unknown as Parameters<typeof normalizeConversation>[0];
  const cr = normalizeConversation(rawConv);
  const convJson = JSON.stringify(cr.data);
  assert.ok(!convJson.includes("30123456"), "DNI no debe aparecer");
  assert.ok(!/dni|custom_attributes|additional_attributes|obra_social|numero_afiliado|domicilio|browser|identifier/i.test(convJson), "ningún atributo PII estructurado");
  assert.equal(cr.data?.contact.displayName, "Cliente Ficticio PII"); // name SÍ (whitelist phone+name)

  const rawMsg = {
    id: 1, source_id: "m-pii", message_type: "incoming", content: "consulta general", created_at: ISO,
    attachments: [{ id: 88001, file_type: "image", file_size: 2048, data_url: "https://signed.example/secret.jpg", thumb_url: "https://signed.example/thumb.jpg" }],
  } as unknown as Parameters<typeof normalizeMessage>[0];
  const mr = normalizeMessage(rawMsg);
  const msgJson = JSON.stringify(mr.data);
  assert.ok(!/signed\.example|data_url|thumb_url/i.test(msgJson), "ninguna URL de adjunto");
  assert.equal(mr.data?.mediaType, "image"); // file_type SÍ (solo presencia/tipo)
  assert.equal(mr.data?.body, "consulta general"); // el body es contenido, se ingiere por diseño
});

// 12. VALIDACIÓN DE CONSISTENCIA: ids de conversación discrepantes → insufficientData (no elegir a ciegas)
test("12. ids de conversación discrepantes → insufficientData", () => {
  const conv = {
    id: 39099, status: "open", meta: { sender: { phone_number: "+5491100000004" } },
    messages: [{ conversation_id: 88888, account_id: 22 }], // ≠ id top-level
  } as unknown as Parameters<typeof normalizeConversation>[0];
  const r = normalizeConversation(conv);
  assert.equal(r.outcome, "insufficientData");
  assert.ok(r.warnings.some((w) => w.toLowerCase().includes("discrepant")));
  // coincidentes → OK
  const ok = normalizeConversation({ id: 39099, status: "open", meta: { sender: { phone_number: "+5491100000004" } }, messages: [{ conversation_id: 39099, account_id: 22 }] });
  assert.equal(ok.outcome, "processed");
  assert.equal(ok.data?.externalConversationId, "39099");
});

// 13. DEFENSA CONSERVADORA: message_created sin conversation embebida → conversation null
//     (el processor lo deja en needsRetry; acá validamos que el mapper no inventa la conversación)
test("13. message_created sin conversation embebida → readEnvelope.conversation null; normalizeConversation(null) insufficientData", () => {
  const env = readEnvelope({ event: "message_created", account: { id: 22 }, id: 5, source_id: "wamid.X", message_type: "incoming", content: "hola", created_at: ISO });
  assert.equal(env.conversation, null);
  assert.equal(normalizeConversation(env.conversation).outcome, "insufficientData");
});

// Extra A: mapAuthor incoming / sender contacto → CUSTOMER; sentAt desde ISO
test("extra. incoming / sender.type=contact → CUSTOMER; created_at ISO → sentAt Date", () => {
  assert.equal(mapAuthor({ message_type: "incoming" }).author, "CUSTOMER");
  assert.equal(mapAuthor({ message_type: "outgoing", sender: { type: "contact" } }).author, "CUSTOMER");
  const r = normalizeMessage({ id: 11, source_id: "m11", message_type: "incoming", content: "h", created_at: ISO });
  assert.ok(r.data?.sentAt instanceof Date && r.data.sentAt.getTime() === new Date(ISO).getTime());
});

// Extra B: readEnvelope con la FORMA REAL — message_created (raíz=mensaje) y conversation_created (raíz=conversación)
test("extra. readEnvelope forma real: account.id vs messages[0].account_id", () => {
  // message_created: raíz = mensaje; conversación embebida; account.id = 22
  const mc = readEnvelope({ event: "message_created", account: { id: 22 }, id: 25003330, source_id: "wamid.ABC", message_type: "incoming", content: "x", conversation: { id: 39099, status: "open" } });
  assert.equal(mc.accountId, 22);
  assert.equal(mc.message?.id, 25003330);
  assert.equal(mc.conversation?.id, 39099);
  assert.equal(conversationExternalId(mc.conversation), "39099");
  // conversation_created: raíz = conversación; account en messages[0].account_id
  const cc = readEnvelope({ event: "conversation_created", id: 39099, status: "open", messages: [{ account_id: 22, conversation_id: 39099 }] });
  assert.equal(cc.accountId, 22);
  assert.equal(cc.conversation?.id, 39099);
  assert.equal(cc.message, null);
});

// Extra C: body whitespace-only → null; contenido real con espacios → preservado sin trim
test("extra. body: vacío/whitespace → null; contenido real preserva texto original (sin trim)", () => {
  const mk = (content: unknown) => normalizeMessage({ id: 30, source_id: "m-body", message_type: "incoming", content, created_at: ISO } as any).data?.body;
  assert.equal(mk(""), null);
  assert.equal(mk("   "), null);
  assert.equal(mk("\n\t "), null);
  assert.equal(mk(123), null);       // no string → null
  assert.equal(mk(undefined), null); // ausente → null
  assert.equal(mk("hola"), "hola");
  assert.equal(mk("  hola  "), "  hola  "); // contenido real → texto ORIGINAL, no recortado
});

// ── Tipo de cierre y asignado (datos inventados) ─────────────────────────────────────
test("cierre. resolved con closure_type_id numérico + nombre → id string + nombre", () => {
  const r = normalizeStatusEvent({
    id: 501, status: "resolved", closure_type_id: 7, closure_type_name: "Tipo inventado A",
    meta: { assignee: { id: 42 } },
  });
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.status, "RESUELTA");
  assert.equal(r.data?.closureTypeId, "7");
  assert.equal(r.data?.closureTypeName, "Tipo inventado A");
  assert.equal(r.data?.externalAssigneeId, "42");
  assert.deepEqual(r.warnings, []);
});

test("cierre. closure_comment NUNCA aparece en el normalizado", () => {
  const raw = {
    id: 502, status: "resolved", closure_type_id: "c-3", closure_type_name: "Tipo inventado B",
    closure_comment: "COMENTARIO-LIBRE-QUE-NO-DEBE-GUARDARSE",
  };
  const r = normalizeStatusEvent(raw as never);
  const json = JSON.stringify(r);
  assert.ok(!json.includes("COMENTARIO-LIBRE"), "el comentario de cierre no se ingiere");
  assert.ok(!/closure_comment|closureComment/i.test(json), "ni siquiera la clave");
  assert.equal(r.data?.closureTypeId, "c-3");
});

test("cierre. sin claves de cierre ni asignado → los tres en null, sin warnings", () => {
  const r = normalizeStatusEvent({ id: 503, status: "open" });
  assert.equal(r.data?.closureTypeId, null);
  assert.equal(r.data?.closureTypeName, null);
  assert.equal(r.data?.externalAssigneeId, null);
  assert.deepEqual(r.warnings, []);
});

test("cierre. formas inesperadas → null + warning sin valores", () => {
  const c = normalizeClosure({ closure_type_id: { x: 1 }, closure_type_name: 99 } as never);
  assert.equal(c.closureTypeId, null);
  assert.equal(c.closureTypeName, null);
  assert.equal(c.warnings.length, 2);
  const idConEspacios = normalizeClosure({ closure_type_id: "texto libre con espacios" });
  assert.equal(idConEspacios.closureTypeId, null);
  assert.ok(!idConEspacios.warnings.join(" ").includes("texto libre"), "el warning no lleva el valor");
  assert.equal(normalizeClosure({ closure_type_name: "   " }).closureTypeName, null);
});

test("cierre. nombre más largo que el tope → recortado + warning sin el valor", () => {
  const largo = "N".repeat(CLOSURE_TYPE_NAME_MAX + 50);
  const c = normalizeClosure({ closure_type_id: 1, closure_type_name: `  ${largo}  ` });
  assert.equal(c.closureTypeName?.length, CLOSURE_TYPE_NAME_MAX);
  assert.equal(c.warnings.length, 1);
  assert.ok(!c.warnings[0].includes("NNN"));
});

test("asignado. meta.assignee.id número o string corto → string; ausente o raro → null", () => {
  assert.equal(normalizeExternalAssigneeId({ meta: { assignee: { id: 9 } } }), "9");
  assert.equal(normalizeExternalAssigneeId({ meta: { assignee: { id: "ag-9" } } } as never), "ag-9");
  assert.equal(normalizeExternalAssigneeId({ meta: { assignee: null } }), null);
  assert.equal(normalizeExternalAssigneeId({ meta: {} }), null);
  assert.equal(normalizeExternalAssigneeId(null), null);
  assert.equal(normalizeExternalAssigneeId({ meta: { assignee: { id: "con espacios" } } } as never), null);
});

test("asignado. tipo: assignee_type o assignee.type; sin asignado o con un valor desconocido → null", () => {
  const t = (meta: unknown) => normalizeExternalAssigneeType({ meta } as never);
  assert.equal(t({ assignee: { id: 9 }, assignee_type: "AgentBot" }), "AGENT_BOT");
  assert.equal(t({ assignee: { id: 9 }, assignee_type: "User" }), "USER");
  assert.equal(t({ assignee: { id: 9, type: "agent_bot" } }), "AGENT_BOT");
  assert.equal(t({ assignee: { id: 9, type: "user" } }), "USER");
  // assignee_type manda sobre assignee.type.
  assert.equal(t({ assignee: { id: 9, type: "user" }, assignee_type: "AgentBot" }), "AGENT_BOT");
  assert.equal(t({ assignee: { id: 9 } }), null, "el evento no lo dice: no se adivina");
  assert.equal(t({ assignee: { id: 9 }, assignee_type: "Otro" }), null);
  assert.equal(t({ assignee: null, assignee_type: "User" }), null, "sin asignado no hay tipo");
  assert.equal(normalizeExternalAssigneeType(null), null);
  // Los tres eventos de conversación lo exponen.
  const conv = { id: 611, status: "open", meta: { sender: { phone_number: "+5491100000009" }, assignee: { id: 9 }, assignee_type: "AgentBot" } };
  assert.equal(normalizeConversation(conv).data?.externalAssigneeType, "AGENT_BOT");
  assert.equal(normalizeStatusEvent(conv).data?.externalAssigneeType, "AGENT_BOT");
  assert.equal(normalizeUpdateEvent(conv).data?.externalAssigneeType, "AGENT_BOT");
});

test("asignado. abierta con un BOT asignado es SIN_ASIGNAR: nadie la tomó; con una persona o sin tipo, ASIGNADA", () => {
  const sender = { phone_number: "+5491100000011" };
  const st = (meta: object) => [normalizeConversation({ id: 621, status: "open", meta: { sender, ...meta } } as never).data?.status, normalizeStatusEvent({ id: 621, status: "open", meta } as never).data?.status];
  assert.deepEqual(st({ assignee: { id: 9 }, assignee_type: "AgentBot" }), ["SIN_ASIGNAR", "SIN_ASIGNAR"]);
  assert.deepEqual(st({ assignee: { id: 9 }, assignee_type: "User" }), ["ASIGNADA", "ASIGNADA"]);
  assert.deepEqual(st({ assignee: { id: 9 } }), ["ASIGNADA", "ASIGNADA"]);
  // El id y el tipo del bot se siguen guardando.
  const bot = normalizeStatusEvent({ id: 621, status: "open", meta: { assignee: { id: 9 }, assignee_type: "AgentBot" } } as never).data;
  assert.deepEqual([bot?.externalAssigneeId, bot?.externalAssigneeType], ["9", "AGENT_BOT"]);
});

test("asignado. normalizeConversation lo expone y no cambia el mapeo de estado", () => {
  const sender = { phone_number: "+5491100000002" };
  const con = normalizeConversation({ id: 601, status: "open", meta: { sender, assignee: { id: 5 } } });
  assert.equal(con.data?.status, "ASIGNADA");
  assert.equal(con.data?.externalAssigneeId, "5");
  const sin = normalizeConversation({ id: 602, status: "open", meta: { sender } });
  assert.equal(sin.data?.status, "SIN_ASIGNAR");
  assert.equal(sin.data?.externalAssigneeId, null);
});

// ── conversation_updated ─────────────────────────────────────────────────────────────

test("updated. está en la lista de eventos y lee SOLO tipo de cierre, asignado y si el evento dice resuelta", () => {
  assert.ok((SUPPORTED_EVENTS as readonly string[]).includes("conversation_updated"));
  const r = normalizeUpdateEvent({
    id: 701, status: "resolved", closure_type_id: 9, closure_type_name: "Tipo inventado C",
    closure_comment: "COMENTARIO-LIBRE-QUE-NO-DEBE-GUARDARSE", labels: ["etiqueta"],
    meta: { sender: { phone_number: "+5491100000003", name: "Nombre Ficticio" }, assignee: { id: 12 } },
  } as never);
  assert.equal(r.outcome, "processed");
  assert.deepEqual(r.data, {
    externalConversationId: "701", resolved: true, assigneePresent: true, externalAssigneeId: "12", externalAssigneeType: null, closureTypeId: "9", closureTypeName: "Tipo inventado C", eventAt: null, labels: ["etiqueta"],
  });
  // Hora del evento: updated_at (ISO o epoch) o, si no viene, resolved_at.
  assert.equal(normalizeUpdateEvent({ id: 707, updated_at: ISO2, resolved_at: ISO }).data?.eventAt?.toISOString(), new Date(ISO2).toISOString());
  assert.equal(normalizeUpdateEvent({ id: 708, resolved_at: ISO }).data?.eventAt?.toISOString(), new Date(ISO).toISOString());
  assert.equal(normalizeUpdateEvent({ id: 709, updated_at: 1781735745 }).data?.eventAt?.getTime(), 1781735745000);
  const json = JSON.stringify(r);
  assert.ok(!/COMENTARIO|closure_comment|5491100000003|Nombre Ficticio/.test(json), "ni comentario, ni teléfono, ni nombre");
});

test("updated. sin meta.assignee el asignado no se toca; con null queda sin asignado; sin id no se mapea", () => {
  const sinMeta = normalizeUpdateEvent({ id: 702, status: "open" });
  assert.deepEqual([sinMeta.data?.assigneePresent, sinMeta.data?.externalAssigneeId, sinMeta.data?.resolved], [false, null, false]);
  const conNull = normalizeUpdateEvent({ id: 703, status: "open", meta: { assignee: null } });
  assert.deepEqual([conNull.data?.assigneePresent, conNull.data?.externalAssigneeId], [true, null]);
  assert.deepEqual([conNull.data?.closureTypeId, conNull.data?.closureTypeName], [null, null]);
  assert.equal(normalizeUpdateEvent({ status: "resolved" }).outcome, "insufficientData");
  assert.equal(normalizeUpdateEvent({ id: 704, messages: [{ conversation_id: 705 }] }).outcome, "insufficientData");
});

test("etiquetas: solo nombres de etiqueta; el texto libre, lo repetido y lo que no es texto se descartan", () => {
  const conv = { id: 710, labels: ["solo_consulta", "tkl_san_miguel", "dr-app", "  a_mi_domicilio ", "texto libre con espacios", "", 7, null, { x: 1 }, "solo_consulta", "x".repeat(65)] };
  assert.deepEqual(normalizeLabels(conv as never), ["solo_consulta", "tkl_san_miguel", "dr-app", "a_mi_domicilio"]);
  assert.equal(normalizeLabels({ id: 711, labels: Array.from({ length: 80 }, (_, i) => `etiqueta_${i}`) }).length, LABELS_MAX);
});

test("etiquetas en los eventos: si el evento trae la clave se informan (aunque esté vacía); si no la trae, null", () => {
  assert.deepEqual(normalizeUpdateEvent({ id: 712, status: "resolved", labels: ["solo_consulta"] }).data?.labels, ["solo_consulta"]);
  assert.deepEqual(normalizeUpdateEvent({ id: 713, status: "resolved", labels: [] }).data?.labels, []);
  assert.equal(normalizeUpdateEvent({ id: 714, status: "resolved" }).data?.labels, null);
  assert.deepEqual(normalizeStatusEvent({ id: 715, status: "resolved", labels: ["venta_concretada", "retiro_en_sucursal"] }).data?.labels, ["venta_concretada", "retiro_en_sucursal"]);
  assert.equal(normalizeStatusEvent({ id: 716, status: "open" }).data?.labels, null);
  assert.equal(labelsIfPresent({ id: 717, labels: "no-es-lista" } as never), null);
});

console.log(`\nemozion-mappers: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
