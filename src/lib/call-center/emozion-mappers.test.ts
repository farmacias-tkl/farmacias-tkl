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

console.log(`\nemozion-mappers: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
