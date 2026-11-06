/**
 * Tests PUROS de la normalización del email.
 *
 *   npx tsx src/lib/users/email.test.ts
 *
 * exit 0 si todos pasan, exit 1 si alguno falla.
 */
import { emailEquals, emailField, normalizeEmail } from "./email";

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

assert("saca espacios y pasa a minúsculas", normalizeEmail("  Ana.Prueba@Example.TEST ") === "ana.prueba@example.test");
assert("uno ya normalizado queda igual", normalizeEmail("ana@example.test") === "ana@example.test");
const f = emailField("Email invalido");
assert("el campo normaliza antes de validar", f.parse(" Ana@Example.test ") === "ana@example.test");
const bad = f.safeParse("no-es-un-email");
assert("el campo rechaza un email inválido con su mensaje", !bad.success && bad.error.issues[0].message === "Email invalido");
assert("la búsqueda no distingue mayúsculas", JSON.stringify(emailEquals(" Ana@Example.test ")) === JSON.stringify({ equals: "ana@example.test", mode: "insensitive" }));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
