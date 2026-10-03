/**
 * B6.3-C2b — Códigos de error SEGUROS para los sumideros del camino webhook → processor → ingest
 * (WebhookEvent.error, SyncLog, console.*).
 *
 * Por qué: el `message` de un error de Prisma incluye los ARGUMENTOS de la query (p.ej. el
 * create de ConversationAttachment con sourceFetchUrl completa, o el body de un mensaje de
 * cliente). Persistir/loguear `e.message` filtra URLs tóxicas y PII.
 *
 * safeErrorCode se construye SOLO con:
 *  - stage: literal fijo del código ("route.create", "processor.tx", "ingest.attachment"...),
 *    o el stage etiquetado en el error con tagErrorStage (más preciso que el del caller);
 *  - e.name si es [A-Za-z0-9_]{1,64};
 *  - e.code si es código Prisma (P\d{4}) o código propio/sistema en UPPER_SNAKE;
 *  - meta.target SOLO si e.code es Prisma y target es array de nombres de columna [A-Za-z0-9_].
 * NUNCA e.message, meta completo, cause, stack, args ni valores.
 *
 * PURO: sin Prisma (inspección estructural), sin red.
 */

const STAGE_RE = /^[a-z0-9_.]{1,40}$/;
const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const PRISMA_CODE_RE = /^P\d{4}$/;
const OWN_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const COLUMN_RE = /^[A-Za-z0-9_]{1,64}$/;
const MAX_TARGETS = 10;
const MAX_LEN = 200;

const STAGE_TAG = Symbol.for("tkl.errorStage");

/**
 * Etiqueta el error con el stage donde ocurrió, SIN cambiar su tipo ni su identidad (la
 * lógica que decide por instanceof / e.code — p.ej. P2002 idempotente — no se ve afectada).
 * Propiedad no enumerable: no se serializa.
 */
export function tagErrorStage<T>(e: T, stage: string): T {
  if (e && typeof e === "object" && !(STAGE_TAG in (e as object)) && STAGE_RE.test(stage)) {
    try { Object.defineProperty(e as object, STAGE_TAG, { value: stage, enumerable: false }); } catch { /* objeto congelado: se usa el stage del caller */ }
  }
  return e;
}

function taggedStage(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const s = (e as Record<symbol, unknown>)[STAGE_TAG];
  return typeof s === "string" && STAGE_RE.test(s) ? s : null;
}

/** "<stage>|<name>|<code>|<target>" truncado a 200 chars, sin ningún valor de datos. */
export function safeErrorCode(e: unknown, stage: string): string {
  const st = taggedStage(e) ?? (STAGE_RE.test(stage) ? stage : "unknown");
  const o = e && typeof e === "object" ? (e as Record<string, unknown>) : null;

  const rawName = o?.name;
  const name = typeof rawName === "string" && NAME_RE.test(rawName) ? rawName
    : e instanceof Error ? "Error"
    : "NonError";

  const rawCode = o?.code;
  const code = typeof rawCode === "string" && (PRISMA_CODE_RE.test(rawCode) || OWN_CODE_RE.test(rawCode)) ? rawCode : "";

  let target = "";
  if (PRISMA_CODE_RE.test(code)) {
    const meta = o?.meta;
    const t = meta && typeof meta === "object" ? (meta as Record<string, unknown>).target : undefined;
    if (Array.isArray(t) && t.length > 0 && t.length <= MAX_TARGETS && t.every((x) => typeof x === "string" && COLUMN_RE.test(x))) {
      target = (t as string[]).join(",");
    }
  }

  return [st, name, code, target].join("|").slice(0, MAX_LEN);
}
