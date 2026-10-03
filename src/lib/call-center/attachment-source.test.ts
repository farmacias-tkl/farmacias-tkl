/**
 * Tests de la captura de origen de adjuntos (B6.3-C2). PUROS: sin DB, sin red, sin env real
 * (el env se pasa como objeto; la validez R2 se inyecta). Captura console.log/warn para verificar
 * que nunca salen URLs/valores.
 *   npx tsx src/lib/call-center/attachment-source.test.ts
 */
import assert from "node:assert/strict";
import {
  getConfiguredCaptureMode,
  getAllowedHosts,
  resolveCaptureMode,
  isHostAllowed,
  validateSourceUrl,
  buildTransientSourceUrls,
  transientSourceUrlsForWebhook,
  parseTransientSourceUrls,
  initialStorageFields,
  describeSourceUrlShape,
  isProbeActive,
  maybeProbeSourceUrls,
  __resetAttachmentSourceStateForTests,
  MAX_SOURCE_URL_LENGTH,
} from "./attachment-source";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  __resetAttachmentSourceStateForTests();
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Ejecuta fn capturando console.log/warn (no se imprimen); devuelve lo capturado. */
function captureConsole(fn: () => void): { logs: string[]; warns: string[] } {
  const logs: string[] = [], warns: string[] = [];
  const ol = console.log, ow = console.warn;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
  try { fn(); } finally { console.log = ol; console.warn = ow; }
  return { logs, warns };
}

const HOST = "files.example";
const R2_OK = () => true;
const R2_BAD = () => false;
const ON_ENV = { ATTACHMENT_SOURCE_CAPTURE: "on", ATTACHMENT_COPY_JOB_ENABLED: "true", ATTACHMENT_SOURCE_ALLOWED_HOSTS: HOST };
const url = (path = "/rails/active_storage/blobs/redirect/SENTINEL_SIGNEDID/SENTINEL_FILENAME.jpg") => `https://${HOST}${path}`;
const FUTURE = "2999-01-01T00:00:00Z";
const NOW = new Date("2026-10-03T12:00:00Z");

// ── Modos ────────────────────────────────────────────────────────────────────────────
test("1. modo configurado: ausente/inválido → off; off/probe/on reconocidos", () => {
  assert.equal(getConfiguredCaptureMode({}), "off");
  assert.equal(getConfiguredCaptureMode({ ATTACHMENT_SOURCE_CAPTURE: "yes" }), "off");
  assert.equal(getConfiguredCaptureMode({ ATTACHMENT_SOURCE_CAPTURE: "true" }), "off");
  assert.equal(getConfiguredCaptureMode({ ATTACHMENT_SOURCE_CAPTURE: "off" }), "off");
  assert.equal(getConfiguredCaptureMode({ ATTACHMENT_SOURCE_CAPTURE: "probe" }), "probe");
  assert.equal(getConfiguredCaptureMode({ ATTACHMENT_SOURCE_CAPTURE: " ON " }), "on");
});

test("2. 'on' efectivo con las 3 condiciones; sin aviso", () => {
  const { warns } = captureConsole(() => {
    const r = resolveCaptureMode(ON_ENV, R2_OK);
    assert.equal(r.mode, "on");
    assert.deepEqual(r.allowedHosts, [HOST]);
    assert.deepEqual(r.missing, []);
  });
  assert.equal(warns.length, 0);
});

test("3. 'on' NO efectivo sin ATTACHMENT_COPY_JOB_ENABLED → off + aviso con el nombre", () => {
  const { warns } = captureConsole(() => {
    const r = resolveCaptureMode({ ...ON_ENV, ATTACHMENT_COPY_JOB_ENABLED: "1" }, R2_OK);
    assert.equal(r.mode, "off");
    assert.deepEqual(r.missing, ["ATTACHMENT_COPY_JOB_ENABLED"]);
  });
  assert.equal(warns.length, 1);
  assert.ok(warns[0].includes("ATTACHMENT_COPY_JOB_ENABLED"));
});

test("4. 'on' NO efectivo sin config R2 válida (incluido checker que lanza) → off", () => {
  const { warns } = captureConsole(() => {
    assert.equal(resolveCaptureMode(ON_ENV, R2_BAD).mode, "off");
    assert.deepEqual(resolveCaptureMode(ON_ENV, () => { throw new Error("x"); }).missing, ["R2_CONFIG"]);
  });
  assert.equal(warns.length, 1, "aviso como máximo una vez por instancia");
  assert.ok(warns[0].includes("R2_CONFIG"));
});

test("5. 'on' NO efectivo con allowlist vacía → off; aviso solo con nombres, sin valores", () => {
  const env = { ...ON_ENV, ATTACHMENT_SOURCE_ALLOWED_HOSTS: " , ", ATTACHMENT_COPY_JOB_ENABLED: "SENTINEL_VALUE" };
  const { warns } = captureConsole(() => {
    const r = resolveCaptureMode(env, R2_BAD);
    assert.equal(r.mode, "off");
    assert.deepEqual(r.missing, ["ATTACHMENT_COPY_JOB_ENABLED", "R2_CONFIG", "ATTACHMENT_SOURCE_ALLOWED_HOSTS"]);
  });
  assert.equal(warns.length, 1);
  assert.ok(!warns[0].includes("SENTINEL_VALUE"), "el aviso no incluye valores");
});

test("6. 'probe' no requiere la copia (se resuelve probe sin job/R2/allowlist)", () => {
  assert.equal(resolveCaptureMode({ ATTACHMENT_SOURCE_CAPTURE: "probe" }, R2_BAD).mode, "probe");
});

// ── Allowlist / validación ───────────────────────────────────────────────────────────
test("7. allowlist: normaliza (trim/lower/punto inicial); exacto y subdominio sí, sufijo falso no", () => {
  assert.deepEqual(getAllowedHosts({ ATTACHMENT_SOURCE_ALLOWED_HOSTS: " Files.Example , .cdn.example,," }), ["files.example", "cdn.example"]);
  assert.equal(isHostAllowed("files.example", [HOST]), true);
  assert.equal(isHostAllowed("a.b.files.example", [HOST]), true);
  assert.equal(isHostAllowed("evilfiles.example", [HOST]), false);
  assert.equal(isHostAllowed("files.example.evil", [HOST]), false);
});

test("8. validateSourceUrl: exacto/subdominio ok; http, userinfo, >2048, host ajeno, basura → REJECTED; vacío → MISSING", () => {
  assert.deepEqual(validateSourceUrl(url(), [HOST]), { ok: true, url: url() });
  assert.equal(validateSourceUrl(`https://sub.${HOST}/x/y.jpg`, [HOST]).ok, true);
  const rej = (u: unknown) => assert.deepEqual(validateSourceUrl(u, [HOST]), { ok: false, code: "SOURCE_URL_REJECTED" });
  rej(`http://${HOST}/x.jpg`);
  rej(`https://user:pw@${HOST}/x.jpg`);
  rej(`https://user@${HOST}/x.jpg`);
  rej(`https://${HOST}/` + "a".repeat(MAX_SOURCE_URL_LENGTH));
  rej("https://other.example/x.jpg");
  rej("no es una url");
  for (const m of [undefined, null, "", "   ", 123, {}]) {
    assert.deepEqual(validateSourceUrl(m, [HOST]), { ok: false, code: "SOURCE_URL_MISSING" });
  }
});

// ── transientSourceUrls ──────────────────────────────────────────────────────────────
test("9. buildTransientSourceUrls: válidas → urls; rechazadas → rejected; ausentes omitidas; keys = helper del mapper", () => {
  const r = buildTransientSourceUrls([
    { id: 1, data_url: url() },
    { id: " 2 ", data_url: "http://x.example/y" },
    { id: 3 },
    { id: "", data_url: url() },   // id no usable → ignorado
    null,
  ], [HOST]);
  assert.deepEqual(r, { v: 1, urls: { "emozion-attachment:1": url() }, rejected: ["emozion-attachment:2"] });
  assert.equal(buildTransientSourceUrls([], [HOST]), null);
  assert.equal(buildTransientSourceUrls(undefined, [HOST]), null);
  assert.equal(buildTransientSourceUrls([{ data_url: url() }], [HOST]), null);
});

test("10. gate del route: solo on + RECEIVED + message_created + debug off", () => {
  const base = { mode: "on" as const, allowedHosts: [HOST], status: "RECEIVED", eventType: "message_created", debugCaptureOn: false, rawAttachments: [{ id: 1, data_url: url() }] };
  assert.ok(transientSourceUrlsForWebhook(base));
  assert.equal(transientSourceUrlsForWebhook({ ...base, mode: "off" }), null);
  assert.equal(transientSourceUrlsForWebhook({ ...base, mode: "probe" }), null);
  assert.equal(transientSourceUrlsForWebhook({ ...base, status: "ERROR" }), null);
  assert.equal(transientSourceUrlsForWebhook({ ...base, eventType: "conversation_created" }), null);
  assert.equal(transientSourceUrlsForWebhook({ ...base, debugCaptureOn: true }), null);
  assert.equal(transientSourceUrlsForWebhook({ ...base, rawAttachments: [] }), null);
});

test("11. parseTransientSourceUrls: forma válida → ctx; inesperada → null", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  assert.deepEqual(parseTransientSourceUrls({ v: 1, urls: { a: "u", b: 5 }, rejected: ["c", 7] }, at), { urls: { a: "u" }, rejected: ["c"], capturedAt: at });
  for (const bad of [null, undefined, "x", [], { v: 2, urls: {}, rejected: [] }, { v: 1, urls: [], rejected: [] }, { v: 1, urls: {} }]) {
    assert.equal(parseTransientSourceUrls(bad, at), null);
  }
});

test("12. initialStorageFields (E5): sin ctx → NO_ORIGIN SOURCE_NOT_CAPTURED; url → PENDING; rechazada/ausente → NO_ORIGIN", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const ctx = { urls: { a: "https://files.example/x" }, rejected: ["b"], capturedAt: at };
  assert.deepEqual(initialStorageFields("a", null), { storageStatus: "NO_ORIGIN", storageLastError: "SOURCE_NOT_CAPTURED" });
  assert.deepEqual(initialStorageFields("a", ctx), { storageStatus: "PENDING", sourceFetchUrl: "https://files.example/x", sourceFetchCapturedAt: at });
  assert.deepEqual(initialStorageFields("b", ctx), { storageStatus: "NO_ORIGIN", storageLastError: "SOURCE_URL_REJECTED" });
  assert.deepEqual(initialStorageFields("c", ctx), { storageStatus: "NO_ORIGIN", storageLastError: "SOURCE_URL_MISSING" });
});

// ── Probe: forma enmascarada (E4) ────────────────────────────────────────────────────
test("13. describeSourceUrlShape: solo tokens técnicos literales; sin filename/signed id/nombres/valores de query", () => {
  const u = `https://${HOST}/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTIzfX0--SENTINELsig/juanperez/12345/abcdef/receta%20SENTINEL_FILENAME.pdf?disposition=inline&X-AMZ-SIGNATURE=SENTINEL_QVAL&token=SENTINEL_TOKVAL&juanperez=1`;
  const s = describeSourceUrlShape(u);
  assert.equal(s.valid, true);
  if (!s.valid) return;
  assert.equal(s.scheme, "https");
  assert.equal(s.hostname, HOST);
  assert.equal(s.pathPattern, "/rails/active_storage/blobs/redirect/{b64:44}/{b64:9}/{num:5}/{hex:6}/{file}");
  assert.deepEqual(s.queryKeys, ["disposition", "X-Amz-Signature", "{param}"]);
  assert.equal(s.length, u.length);
  const json = JSON.stringify(s);
  for (const leak of ["SENTINEL", "juanperez", "receta", "eyJ", "inline", "token"]) {
    assert.ok(!json.includes(leak), `no debe filtrar ${leak}`);
  }
});

test("13b. describeSourceUrlShape: URL inválida → {valid:false,length} sin contenido", () => {
  assert.deepEqual(describeSourceUrlShape("SENTINEL no url"), { valid: false, length: 15 });
});

test("14. probe: activo solo con modo probe + PROBE_UNTIL futuro; vencido/ausente/inválido → inactivo", () => {
  const p = { ATTACHMENT_SOURCE_CAPTURE: "probe", ATTACHMENT_SOURCE_PROBE_UNTIL: FUTURE };
  assert.equal(isProbeActive(p, NOW), true);
  assert.equal(isProbeActive({ ...p, ATTACHMENT_SOURCE_PROBE_UNTIL: "2026-10-03T11:59:59Z" }, NOW), false);
  assert.equal(isProbeActive({ ATTACHMENT_SOURCE_CAPTURE: "probe" }, NOW), false);
  assert.equal(isProbeActive({ ...p, ATTACHMENT_SOURCE_PROBE_UNTIL: "mañana" }, NOW), false);
  assert.equal(isProbeActive({ ...p, ATTACHMENT_SOURCE_CAPTURE: "on" }, NOW), false);
});

test("15. probe: loguea forma enmascarada (sin URL) y respeta el tope por instancia (default 5 y custom)", () => {
  const p = { ATTACHMENT_SOURCE_CAPTURE: "probe", ATTACHMENT_SOURCE_PROBE_UNTIL: FUTURE };
  const atts = [{ id: 1, data_url: url() }, { id: 2 }];
  const { logs } = captureConsole(() => {
    for (let i = 0; i < 7; i++) maybeProbeSourceUrls(`ev${i}`, atts, p, NOW);
  });
  assert.equal(logs.length, 5, "default PROBE_MAX=5");
  for (const l of logs) {
    assert.ok(l.startsWith("[attachment-source-probe]"));
    assert.ok(!/SENTINEL|https:\/\//.test(l), "el log no contiene la URL ni partes sensibles");
  }
  __resetAttachmentSourceStateForTests();
  const c = captureConsole(() => {
    for (let i = 0; i < 4; i++) maybeProbeSourceUrls(`ev${i}`, atts, { ...p, ATTACHMENT_SOURCE_PROBE_MAX: "2" }, NOW);
  });
  assert.equal(c.logs.length, 2, "PROBE_MAX=2");
});

test("16. probe inactivo con PROBE_UNTIL vencido o modo off/on: no loguea", () => {
  const atts = [{ id: 1, data_url: url() }];
  const { logs } = captureConsole(() => {
    assert.equal(maybeProbeSourceUrls("e", atts, { ATTACHMENT_SOURCE_CAPTURE: "probe", ATTACHMENT_SOURCE_PROBE_UNTIL: "2020-01-01T00:00:00Z" }, NOW), false);
    assert.equal(maybeProbeSourceUrls("e", atts, { ATTACHMENT_SOURCE_CAPTURE: "on", ATTACHMENT_SOURCE_PROBE_UNTIL: FUTURE }, NOW), false);
    assert.equal(maybeProbeSourceUrls("e", atts, { ATTACHMENT_SOURCE_PROBE_UNTIL: FUTURE }, NOW), false);
  });
  assert.equal(logs.length, 0);
});

console.log(`\nattachment-source: ${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
