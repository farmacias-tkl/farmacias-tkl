/**
 * Tests de los mappers de ingesta Emozion (Sprint 4B, commit 2/4). PUROS, sin DB, sin
 * red, sin token. Fixtures inline SANITIZADOS (teléfonos/nombres ficticios; nada real).
 *
 * El repo no tiene runner de tests (vitest/jest) y agregarlo está fuera de scope de este
 * commit, así que el archivo se autoejecuta con node:assert:
 *   npx tsx src/lib/call-center/emozion-mappers.test.ts
 * (Los upserts de ingest.ts tocan Prisma y se validan contra DB recién en el commit 4/4.)
 */
import assert from "node:assert/strict";
import {
  normalizeConversation,
  normalizeMessage,
  normalizeStatusEvent,
  mapAuthor,
  readEnvelope,
} from "./emozion-mappers";

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

// 1. message con source_id
test("1. message con source_id → externalMessageId = source_id", () => {
  const r = normalizeMessage({ id: 555, source_id: "wamid.ABC", message_type: 0, content: "hola", created_at: 1700000000 });
  assert.equal(r.outcome, "processed");
  assert.equal(r.data?.externalMessageId, "wamid.ABC");
});

// 2. message sin source_id → fallback prefijado
test("2. message sin source_id → fallback emozion-message:<id>", () => {
  const r = normalizeMessage({ id: 555, message_type: 0, content: "hola", created_at: 1700000000 });
  assert.equal(r.data?.externalMessageId, "emozion-message:555");
});

// 3. BOT sender.id=1
test("3. outgoing sender.id=1 → BOT", () => {
  const r = normalizeMessage({ id: 1, source_id: "m1", message_type: 1, content: "soy el bot", sender: { id: 1, type: "user" }, created_at: 1700000001 });
  assert.equal(r.data?.author, "BOT");
  assert.equal(r.authorFallbackCount, 0);
});

// 4. OPERATOR sender.id distinto
test("4. outgoing sender.type=user id!=1 → OPERATOR", () => {
  const r = normalizeMessage({ id: 2, source_id: "m2", message_type: 1, content: "soy operador", sender: { id: 42, type: "user" }, created_at: 1700000002 });
  assert.equal(r.data?.author, "OPERATOR");
  assert.equal(r.authorFallbackCount, 0);
});

// 5. author fallback raro → warning
test("5. outgoing con sender raro/ausente → OPERATOR + authorFallbackCount=1", () => {
  const r = normalizeMessage({ id: 3, source_id: "m3", message_type: 1, content: "raro", sender: { id: null, type: "weird" }, created_at: 1700000003 });
  assert.equal(r.data?.author, "OPERATOR");
  assert.equal(r.authorFallbackCount, 1);
  assert.ok(r.warnings.some((w) => w.includes("fallback")));
  // y un outgoing sin sender:
  const r2 = normalizeMessage({ id: 4, source_id: "m4", message_type: 1, content: "x", created_at: 1700000004 });
  assert.equal(r2.authorFallbackCount, 1);
});

// 6. activity (message_type 2) ignorado
test("6. message_type=2 (activity) → ignored, no se persiste", () => {
  const r = normalizeMessage({ id: 9, message_type: 2, content: "Conversation resolved", created_at: 1700000005 });
  assert.equal(r.outcome, "ignored");
  assert.equal(r.data, null);
});

// 7. private message preservado
test("7. private=true → isPrivate=true", () => {
  const r = normalizeMessage({ id: 7, source_id: "m7", message_type: 1, private: true, content: "nota interna", sender: { id: 42, type: "user" }, created_at: 1700000006 });
  assert.equal(r.data?.isPrivate, true);
  // default false
  const r2 = normalizeMessage({ id: 8, source_id: "m8", message_type: 0, content: "publico", created_at: 1700000007 });
  assert.equal(r2.data?.isPrivate, false);
});

// 8. labels crudas en externalLabels
test("8. labels crudas → externalLabels (sin unificar)", () => {
  const r = normalizeConversation({
    uuid: "uuid-1", status: "open", labels: ["cronico_mensual", "consulta", ""],
    meta: { sender: { phone_number: "+5491100000001", name: "Cliente Ficticio" }, assignee: { id: 3 } },
    first_reply_created_at: 1700000010, created_at: 1700000000,
  });
  assert.equal(r.outcome, "processed");
  assert.deepEqual(r.data?.externalLabels, ["cronico_mensual", "consulta"]); // filtra vacíos, no unifica
});

// 9. status open con/sin assignee
test("9. status open + assignee → ASIGNADA; open sin assignee → SIN_ASIGNAR; pending/resolved", () => {
  const base = { uuid: "u9", meta: { sender: { phone_number: "+5491100000002" } } };
  assert.equal(normalizeConversation({ ...base, status: "open", meta: { sender: base.meta.sender, assignee: { id: 5 } } }).data?.status, "ASIGNADA");
  assert.equal(normalizeConversation({ ...base, status: "open" }).data?.status, "SIN_ASIGNAR");
  assert.equal(normalizeConversation({ ...base, status: "pending" }).data?.status, "PENDIENTE");
  assert.equal(normalizeConversation({ ...base, status: "resolved", resolved_at: 1700000099 }).data?.status, "RESUELTA");
  // snoozed → conservador + warning
  const sn = normalizeConversation({ ...base, status: "snoozed" });
  assert.equal(sn.data?.status, "SIN_ASIGNAR");
  assert.ok(sn.warnings.some((w) => w.includes("no mapeado")));
});

// 10. payload incompleto → insufficientData (sin inventar)
test("10. payload incompleto → insufficientData (sin inventar)", () => {
  assert.equal(normalizeConversation({ status: "open", meta: { sender: { phone_number: "+549110" } } }).outcome, "insufficientData"); // sin uuid
  assert.equal(normalizeConversation({ uuid: "u", status: "open", meta: { sender: {} } }).outcome, "insufficientData"); // sin phone
  assert.equal(normalizeMessage({ message_type: 1, content: "x" }).outcome, "insufficientData"); // sin id ni source_id
  assert.equal(normalizeStatusEvent({ status: "resolved" }).outcome, "insufficientData"); // sin uuid
});

// Extra: CUSTOMER por message_type 0 / sender.type contact + epoch
test("extra. message_type=0 / sender.type=contact → CUSTOMER; epoch→Date", () => {
  assert.equal(mapAuthor({ message_type: 0 }).author, "CUSTOMER");
  assert.equal(mapAuthor({ message_type: 1, sender: { type: "contact" } }).author, "CUSTOMER");
  const r = normalizeMessage({ id: 11, source_id: "m11", message_type: 0, content: "h", created_at: 1700000000 });
  assert.ok(r.data?.sentAt instanceof Date && r.data.sentAt.getTime() === 1700000000 * 1000);
});

// Extra: readEnvelope ubica conversation/message según el evento
test("extra. readEnvelope: message_created vs conversation_*", () => {
  const mc = readEnvelope({ event: "message_created", account: { id: 22 }, id: 1, content: "x", conversation: { uuid: "c1" } });
  assert.equal(mc.event, "message_created");
  assert.equal(mc.accountId, 22);
  assert.equal(mc.message?.id, 1);
  assert.equal(mc.conversation?.uuid, "c1");
  const cc = readEnvelope({ event: "conversation_created", account_id: 22, uuid: "c2", status: "open" });
  assert.equal(cc.conversation?.uuid, "c2");
  assert.equal(cc.message, null);
});

// 11. MINIMIZACIÓN DE PII — propiedad de la función pura (sin DB): entrada CON DNI/
//     custom_attributes/data_url → Normalized* SIN ellos. Solo phone+name+file_type sobreviven.
test("11. payload con DNI/custom_attributes/data_url → Normalized* NO los contiene", () => {
  // RAW trae campos PII que NO tipamos a propósito → fixture untyped (como el dato externo real).
  const rawConv = {
    uuid: "u-pii", status: "open", labels: ["cronico_mensual"],
    first_reply_created_at: 1700000000, created_at: 1700000000,
    meta: {
      sender: {
        phone_number: "+5491100000003", name: "Cliente Ficticio PII",
        custom_attributes: { dni: "30123456", obra_social: "OSX", numero_afiliado: "A-1", domicilio: "Calle Falsa 123" },
        additional_attributes: { city: "Ciudad", browser: "x" },
      },
      assignee: { id: 2 },
    },
  } as unknown as Parameters<typeof normalizeConversation>[0];
  const cr = normalizeConversation(rawConv);
  const convJson = JSON.stringify(cr.data);
  assert.ok(!convJson.includes("30123456"), "DNI no debe aparecer");
  assert.ok(!/dni|custom_attributes|additional_attributes|obra_social|numero_afiliado|domicilio|browser/i.test(convJson), "ningún atributo PII estructurado");
  assert.equal(cr.data?.contact.displayName, "Cliente Ficticio PII"); // name SÍ (whitelist phone+name)
  assert.deepEqual(cr.data?.externalLabels, ["cronico_mensual"]);

  const rawMsg = {
    id: 1, source_id: "m-pii", message_type: 0, content: "consulta general", created_at: 1700000000,
    attachments: [{ file_type: "image", data_url: "https://signed.example/secret.jpg", thumb_url: "https://signed.example/thumb.jpg" }],
  } as unknown as Parameters<typeof normalizeMessage>[0];
  const mr = normalizeMessage(rawMsg);
  const msgJson = JSON.stringify(mr.data);
  assert.ok(!/signed\.example|data_url|thumb_url/i.test(msgJson), "ninguna URL de adjunto");
  assert.equal(mr.data?.mediaType, "image"); // file_type SÍ (solo presencia/tipo)
  assert.equal(mr.data?.body, "consulta general"); // el body del mensaje es contenido, se ingiere por diseño
});

console.log(`\nemozion-mappers: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
