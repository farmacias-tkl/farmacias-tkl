/**
 * Auth Bearer para endpoints internos disparados por máquinas (B6.3-C4).
 *
 * Compara SHA-256(header recibido) contra SHA-256("Bearer <secret>") con timingSafeEqual: ambos
 * digests miden 32 bytes, así la comparación es de tiempo constante y NO filtra el largo del
 * secreto ni del header. NUNCA loguea el header ni el secreto.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_SECRET_LENGTH = 32;

/** ¿Secreto configurado y con largo mínimo? (si no, el endpoint responde 503 sin tocar la base). */
export function isUsableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

export function verifyBearer(authorizationHeader: string | null, secret: string): boolean {
  const got = createHash("sha256").update(authorizationHeader ?? "", "utf8").digest();
  const want = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(got, want);
}
